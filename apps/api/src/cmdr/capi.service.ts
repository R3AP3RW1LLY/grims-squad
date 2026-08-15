import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { TokenCipher } from '@grims/shared/server';
import {
  authorizeUrl,
  exchangeCode,
  makePkce,
  refreshAccess,
  refreshDue,
  tokenState,
  CapiAuthError,
  type CapiTokens,
} from '@grims/ed-clients';
import { randomBytes } from 'node:crypto';

/**
 * Linking a member's Frontier account, and holding the tokens afterwards.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "the primary feature must be so that players that are playing on Geforce Now and cloud platforms
 * can use the companion app like everyone else"
 *
 * A commander on GeForce Now cannot run anything beside the game. cAPI is served by Frontier and
 * does not care where the game runs, so this is the only route by which they exist here at all —
 * no journal, no cargo, no deliveries, no promotion activity without it, and every one of those
 * absences looks exactly like a member who has not played.
 *
 * ★ THE VERIFIER NEVER TOUCHES THE BROWSER ★
 *
 * PKCE only protects anything if the verifier stays server-side between the two legs. It is held in
 * Redis against a random state, for ten minutes, and deleted the moment it is used — a verifier that
 * survives its exchange is one somebody can replay.
 *
 * Redis rather than a cookie: a cookie puts it in the member's browser, which is precisely where an
 * attacker who can read cookies already is. Redis rather than a database row: this is ephemeral by
 * nature, and a table of abandoned half-authorisations is a table somebody has to remember to prune.
 */

/** Ten minutes. Long enough to authorise, short enough that an abandoned attempt costs nothing. */
const STATE_TTL_SECONDS = 600;

const key = (state: string): string => `capi:pkce:${state}`;

export interface CapiConfig {
  readonly authBase: string;
  readonly apiBase: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly clientSecret?: string | undefined;
}

export class CapiService {
  readonly #db: PrismaClient;
  readonly #cache: Redis;
  readonly #cipher: TokenCipher;
  readonly #config: CapiConfig;

  constructor(db: PrismaClient, cache: Redis, cipher: TokenCipher, config: CapiConfig) {
    this.#db = db;
    this.#cache = cache;
    this.#cipher = cipher;
    this.#config = config;
  }

  /**
   * The AAD context binding a ciphertext to one member.
   *
   * Identical in shape to the Inara link store's (INV-012): a token row lifted from the database
   * cannot be decrypted as somebody else's, because the additional data it was sealed with names
   * whose it is.
   */
  #context(userId: string): string {
    return `capi:${userId}`;
  }

  /** Where to send the member, and the state we expect back. */
  async begin(userId: string): Promise<{ url: string; state: string }> {
    const pkce = await makePkce();
    const state = randomBytes(24).toString('base64url');

    /*
     * The userId travels with the verifier rather than in the state parameter. State is echoed back
     * through the member's browser and through Frontier, so anything in it is something an attacker
     * can choose — including whose account a callback claims to be for.
     */
    await this.#cache.set(
      key(state),
      JSON.stringify({ userId, verifier: pkce.verifier }),
      'EX',
      STATE_TTL_SECONDS,
    );

    return {
      url: authorizeUrl({
        authBase: this.#config.authBase,
        clientId: this.#config.clientId,
        redirectUri: this.#config.redirectUri,
        state,
        challenge: pkce.challenge,
      }),
      state,
    };
  }

  /**
   * The callback: trade the code, store the tokens, and record the verification.
   *
   * Returns the member the flow belonged to, so the caller can redirect them somewhere useful
   * without trusting anything the browser said about who they are.
   */
  async complete(code: string, state: string, now = new Date()): Promise<{ userId: string }> {
    const raw = await this.#cache.get(key(state));
    if (raw === null) {
      /*
       * Unknown or expired state. Deliberately the same answer for both: an attacker probing which
       * states exist learns nothing, and a member who left the tab open for an hour is told the
       * same true thing — start again.
       */
      throw new CapiAuthError('refused', 'That Frontier sign-in has expired. Please start again.');
    }

    // Single use. A verifier that survives its exchange is one somebody can replay.
    await this.#cache.del(key(state));

    const { userId, verifier } = JSON.parse(raw) as { userId: string; verifier: string };

    const tokens = await exchangeCode({
      authBase: this.#config.authBase,
      clientId: this.#config.clientId,
      redirectUri: this.#config.redirectUri,
      clientSecret: this.#config.clientSecret,
      code,
      verifier,
      now,
    });

    await this.#store(userId, tokens, now);
    return { userId };
  }

  /**
   * Writes the tokens and the verification in ONE transaction.
   *
   * A stored token with no verification row is a member who linked and whom nothing considers
   * linked; a verification with no token is one the platform believes it can poll and cannot. Both
   * are silent, and both are avoided by refusing to write either alone.
   */
  async #store(userId: string, tokens: CapiTokens, now: Date): Promise<void> {
    const context = this.#context(userId);

    const access = Buffer.from(this.#cipher.encrypt(tokens.accessToken, context), 'utf8');
    const refresh = Buffer.from(this.#cipher.encrypt(tokens.refreshToken, context), 'utf8');

    /*
     * ★ verifiedAt IS THE CEILING'S CLOCK ★
     *
     * The schema records `expiresAt` as "verifiedAt + 25 days. Frontier refresh tokens have a hard
     * ceiling". That ceiling runs from the AUTHORISATION, not from the last refresh — so re-linking
     * moves it and refreshing does not, which is the whole reason a member has to come back.
     */
    const ceiling = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000);

    await this.#db.$transaction(async (tx) => {
      const existing = await tx.cmdrVerification.findFirst({
        where: { userId, method: 'fdev_capi', revokedAt: null },
        select: { id: true },
      });

      const data = {
        fdevAccessEnc: access,
        fdevRefreshEnc: refresh,
        fdevExpiresAt: tokens.expiresAt,
        verifiedAt: now,
        expiresAt: ceiling,
        isStale: false,
      };

      if (existing === null) {
        await tx.cmdrVerification.create({
          data: {
            userId,
            /*
             * Empty until the profile call names them. NOT a placeholder like "unknown": a
             * cmdrName is unique among live rows, so a shared placeholder would make the second
             * member to link collide with the first.
             */
            cmdrName: '',
            method: 'fdev_capi',
            // 3 = fdev_capi. The schema's own comment: "Recorded, never inferred."
            trustTier: 3,
            ...data,
          },
        });
      } else {
        await tx.cmdrVerification.update({ where: { id: existing.id }, data });
      }
    });
  }

  /**
   * A usable access token, refreshed if it is close to expiry.
   *
   * Returns null when the member has no link or the chain is dead — never throws for that, because
   * "this member cannot be polled" is an ordinary state a poller must handle for most of the
   * squadron, not an exception.
   */
  async accessToken(userId: string, now = new Date()): Promise<string | null> {
    const row = await this.#db.cmdrVerification.findFirst({
      where: { userId, method: 'fdev_capi', revokedAt: null },
      select: {
        id: true,
        fdevAccessEnc: true,
        fdevRefreshEnc: true,
        fdevExpiresAt: true,
        verifiedAt: true,
        isStale: true,
      },
    });

    if (row === null || row.fdevRefreshEnc === null) return null;

    // Past Frontier's ceiling no refresh will ever succeed. Marked once, then left alone.
    const state = tokenState(row.verifiedAt, now);
    if (state.stale) {
      if (!row.isStale) {
        await this.#db.cmdrVerification.update({ where: { id: row.id }, data: { isStale: true } });
      }
      return null;
    }

    const context = this.#context(userId);

    if (
      row.fdevAccessEnc !== null &&
      row.fdevExpiresAt !== null &&
      !refreshDue(row.fdevExpiresAt, now)
    ) {
      return this.#cipher.decrypt(Buffer.from(row.fdevAccessEnc).toString('utf8'), context);
    }

    try {
      const tokens = await refreshAccess({
        authBase: this.#config.authBase,
        clientId: this.#config.clientId,
        redirectUri: this.#config.redirectUri,
        clientSecret: this.#config.clientSecret,
        refreshToken: this.#cipher.decrypt(
          Buffer.from(row.fdevRefreshEnc).toString('utf8'),
          context,
        ),
        now,
      });

      await this.#store(userId, tokens, row.verifiedAt);
      return tokens.accessToken;
    } catch (e) {
      /*
       * ★ ONLY A DEAD GRANT MARKS THE ROW ★
       *
       * A network blip or a rate limit means try again shortly — writing `isStale` for those would
       * disconnect a member because Frontier had a bad minute, and nothing would ever un-write it.
       * The client decides which is which; this only acts on the permanent one.
       */
      if (e instanceof CapiAuthError && !e.retryable) {
        await this.#db.cmdrVerification.update({ where: { id: row.id }, data: { isStale: true } });
      }
      return null;
    }
  }

  /** What to tell the member about their connection, or null when they have never linked. */
  async status(
    userId: string,
    now = new Date(),
  ): Promise<{ linked: boolean; daysLeft: number; warn: boolean; sentence: string } | null> {
    const row = await this.#db.cmdrVerification.findFirst({
      where: { userId, method: 'fdev_capi', revokedAt: null },
      select: { verifiedAt: true },
    });

    if (row === null) return null;

    const state = tokenState(row.verifiedAt, now);
    return {
      linked: !state.stale,
      daysLeft: state.daysLeft,
      warn: state.warn,
      sentence: state.sentence,
    };
  }
}
