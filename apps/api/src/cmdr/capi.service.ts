import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { TokenCipher } from '@grims/shared/server';
import {
  authorizeUrl,
  exchangeCode,
  fetchProfile,
  makePkce,
  refreshAccess,
  refreshDue,
  tokenState,
  CapiAuthError,
  type CapiTokens,
} from '@grims/ed-clients';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { shouldRefresh, withCapiRefreshLock, type LockSession } from '@grims/db';
import { resolveClaim, type ClaimMethod } from '@grims/shared';

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
  /**
   * A dedicated connection to hold the refresh lock on.
   *
   * The lock belongs to the SESSION, so it cannot ride on Prisma's pool: the pool would hand the
   * connection back mid-refresh and release the lock inside the window it exists to protect.
   * `withCapiRefreshLock` closes this again however the refresh ends.
   */
  async #lockSession(): Promise<LockSession> {
    const client = new Client({ connectionString: process.env['DATABASE_URL'] });
    await client.connect();
    return {
      query: (sql, values) => client.query(sql, values === undefined ? undefined : [...values]),
      end: () => client.end(),
    };
  }

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

    /*
     * ★ THE NAME IS WHAT MAKES THIS A VERIFICATION ★
     *
     * Until the profile answers, the row holds an empty `cmdrName` and the member is linked but
     * unverified — which is indistinguishable from broken. So it is fetched immediately, in the
     * same request, rather than left to the poller: a member who has just authorised is watching,
     * and this is the moment they expect to be told who we think they are.
     *
     * Failures here do NOT undo the link. The tokens are good and the next poll will fill the name;
     * throwing the authorisation away because Frontier was briefly slow would make the member do it
     * all again for nothing.
     */
    try {
      await this.identify(userId, now);
    } catch {
      // Deliberately swallowed. See above — the link stands, the name arrives later.
    }

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
   * Asks Frontier who this member is, and records it.
   *
   * Separate from `complete` so the poller can call it too: a member whose name never landed at
   * link time must not stay nameless for ever, and a commander who RENAMES should not need to
   * reauthorise for us to notice.
   */
  async identify(userId: string, now = new Date()): Promise<{ cmdrName: string } | null> {
    const token = await this.accessToken(userId, now);
    if (token === null) return null;

    const profile = await fetchProfile({ apiBase: this.#config.apiBase, accessToken: token });

    /*
     * ★ THE UNIQUE INDEX IS WHY THIS IS NOT A PLAIN UPDATE ★
     *
     * `cmdrName` is unique across every live verification (INV-005, a partial unique index). Writing
     * it blind means a constraint error inside an OAuth callback the member is watching, so who
     * holds the name is settled BEFORE the write, by rules that can be read — see resolveClaim.
     */
    const held = await this.#db.cmdrVerification.findFirst({
      where: { cmdrName: profile.commanderName, revokedAt: null },
      select: { userId: true, trustTier: true, method: true },
    });

    const outcome = resolveClaim({
      userId,
      cmdrName: profile.commanderName,
      existing:
        held === null
          ? null
          : {
              userId: held.userId,
              trustTier: held.trustTier,
              method: held.method as ClaimMethod,
            },
    });

    if (outcome.kind === 'refuse') {
      /*
       * Two cryptographic claims on one commander. Left for a human deliberately: superseding here
       * would let whoever linked most recently take a commander from somebody who also proved it,
       * and that is not a decision an automatic path should make quietly.
       */
      await this.#db.auditLog.create({
        data: {
          actorId: null,
          actorType: 'system',
          action: 'cmdr.claim_conflict',
          targetType: 'user',
          targetId: userId,
          before: {},
          after: { cmdrName: profile.commanderName, reason: outcome.reason },
        },
      });
      return null;
    }

    await this.#db.$transaction(async (tx) => {
      if (outcome.kind === 'supersede') {
        // Revoked, never deleted: the row is the record that somebody claimed this in good faith
        // and an officer agreed. Erasing it would erase a decision rather than correct one.
        await tx.cmdrVerification.updateMany({
          where: { userId: outcome.revokeUserId, cmdrName: profile.commanderName, revokedAt: null },
          data: { revokedAt: now },
        });

        await tx.auditLog.create({
          data: {
            actorId: null,
            actorType: 'system',
            action: 'cmdr.claim_superseded',
            targetType: 'user',
            targetId: outcome.revokeUserId,
            before: { cmdrName: profile.commanderName },
            after: { revokedAt: now.toISOString(), note: outcome.note, supersededBy: userId },
          },
        });
      }

      await tx.cmdrVerification.updateMany({
        where: { userId, method: 'fdev_capi', revokedAt: null },
        data: { cmdrName: profile.commanderName },
      });
    });

    return { cmdrName: profile.commanderName };
  }

  /**
   * A usable access token, refreshed if it is close to expiry.
   *
   * Returns null when the member has no link or the chain is dead — never throws for that, because
   * "this member cannot be polled" is an ordinary state a poller must handle for most of the
   * squadron, not an exception.
   */
  /**
   * A usable access token, refreshing through the shared lock when one is needed.
   *
   * ★ THE LOCK IS NOT OPTIONAL — 2026-08-16 ★
   *
   * Frontier ROTATES the refresh token, so a second process refreshing the same member at the same
   * moment sends the same still-valid token, loses the race, and then persists one Frontier has
   * already killed. That member's link dies with no error anywhere: the write succeeded and the row
   * looks healthy, so it reads exactly like the 25-day ceiling expiring early.
   *
   * It was theoretical while this service was the only refresher. The journal poller is a SECOND
   * process refreshing the same rows on a timer, for the members most likely to be active — which
   * is exactly when this method is also being called for them. Both take the lock, or neither is
   * protected.
   *
   * See `capi-token-owner.ts` in @grims/db, which both sides import so the key cannot drift.
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

    const session = await this.#lockSession();

    try {
      return await withCapiRefreshLock(session, userId, async () => {
        /*
         * ★ RE-READ INSIDE THE LOCK ★
         *
         * Whoever waited here was waiting for somebody else's refresh to finish. That refresh has
         * already stored a fresh token — and the refresh token this closure was about to send is
         * the one Frontier killed to issue it. Sending it anyway is the exact failure the lock was
         * taken to prevent, so the first thing inside the lock is to look again.
         */
        const fresh = await this.#db.cmdrVerification.findFirst({
          where: { id: row.id },
          select: { fdevAccessEnc: true, fdevRefreshEnc: true, fdevExpiresAt: true },
        });

        if (fresh === null || fresh.fdevRefreshEnc === null) return null;

        if (
          !shouldRefresh(
            {
              accessEnc: fresh.fdevAccessEnc === null ? null : 'stored',
              expiresAt: fresh.fdevExpiresAt,
            },
            now,
          ) &&
          fresh.fdevAccessEnc !== null
        ) {
          return this.#cipher.decrypt(Buffer.from(fresh.fdevAccessEnc).toString('utf8'), context);
        }

        const tokens = await refreshAccess({
          authBase: this.#config.authBase,
          clientId: this.#config.clientId,
          redirectUri: this.#config.redirectUri,
          clientSecret: this.#config.clientSecret,
          refreshToken: this.#cipher.decrypt(
            Buffer.from(fresh.fdevRefreshEnc).toString('utf8'),
            context,
          ),
          now,
        });

        await this.#store(userId, tokens, row.verifiedAt);
        return tokens.accessToken;
      });
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
