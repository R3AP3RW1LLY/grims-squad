import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCode } from '@grims/shared';
import type { IDiscordIdentityProvider } from '@grims/ed-clients';

/**
 * Join-the-server onboarding for visitors who are NOT yet in the Discord guild.
 *
 * The visitor chooses an intent on the website, authorises with `guilds.join`,
 * and is added to the guild with the matching role already applied in a single
 * call. The alternative — send an invite, then race a gateway event to apply the
 * role — loses the intent entirely if the process restarts at the wrong moment.
 *
 * ★ THE SECURITY BOUNDARY ★
 * The role is resolved from the ALLOWLIST below, and the chosen intent travels
 * inside the HMAC-signed state. Nothing in the request carries a role id, so
 * there is no parameter to edit. The allowlist is re-checked on the way out as
 * well as on the way in, so a signing bug alone is not enough to escalate.
 *
 * Mirrors `ssot/02-domain/discord-roles.yaml` § onboardingIntents.
 */

export interface OnboardingOption {
  readonly intent: 'squadron' | 'ally';
  readonly label: string;
  readonly description: string;
  readonly roleName: string;
}

export type OnboardingIntent = OnboardingOption['intent'];

/**
 * The intents themselves. Note what is NOT here: the Discord role ids.
 *
 * They are configuration, injected through `OnboardingConfig.roleIds`, because
 * a snowflake in source is exactly what INV-008 forbids — renaming or
 * recreating a role would then require a code change and a deploy. My own lint
 * rule caught this file doing it, which is the rule working as intended.
 */
export const ONBOARDING_INTENTS: readonly OnboardingOption[] = Object.freeze([
  Object.freeze({
    intent: 'squadron' as const,
    label: 'Join the squadron',
    description: "I want to fly with Grim's Squad.",
    roleName: "Grim's Squad members",
  }),
  Object.freeze({
    intent: 'ally' as const,
    label: 'Ally or observer',
    description: 'I am from an allied squadron, or I just want to watch.',
    roleName: 'Allies',
  }),
]);

/** Intent -> Discord role id, supplied by configuration. */
export interface IntentRoleBinding {
  readonly intent: OnboardingIntent;
  readonly roleId: string;
}

/**
 * Resolves an intent, or `undefined`.
 *
 * Implemented as a `find` over a frozen array rather than a lookup on an object
 * literal. `MAP[intent]` answers `constructor`, `__proto__` and `toString` with
 * something truthy, and a truthy answer is all a privilege escalation needs.
 */
export function resolveIntent(intent: string): OnboardingOption | undefined {
  return ONBOARDING_INTENTS.find((o) => o.intent === intent);
}

const SCOPES = 'identify guilds.join';
const STATE_TTL_MS = 10 * 60_000;

interface JoinState {
  /** intent */
  readonly i: string;
  /** SHA-256 of the nonce cookie */
  readonly n: string;
  readonly e: number;
  readonly j: string;
}

export interface OnboardingConfig {
  /**
   * The ONLY roles this flow may ever grant. An array searched with `find`,
   * not an object indexed by key: `MAP[intent]` answers `constructor` and
   * `__proto__` with something truthy, and truthy is all an escalation needs.
   */
  readonly roleIds: readonly IntentRoleBinding[];
  readonly guildId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly stateSecret: string;
}

export interface JoinResult {
  readonly discordUserId: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly joined: boolean;
  readonly alreadyMember: boolean;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('base64url');

export class OnboardingService {
  #consumed = new Map<string, number>();

  constructor(
    private readonly discord: IDiscordIdentityProvider,
    private readonly config: OnboardingConfig,
  ) {}

  beginJoin(intent: OnboardingIntent, nowMs: number = Date.now()) {
    const option = resolveIntent(intent);
    if (option === undefined || this.#roleFor(option.intent) === undefined) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown join option.');
    }

    const nonce = randomBytes(32).toString('base64url');
    const state = this.#sign({
      // The INTENT is stored, never the role id. Even if this token were somehow
      // forged, it can only name one of two words, and both are re-resolved
      // through the allowlist before anything is granted.
      i: option.intent,
      n: sha256(nonce),
      e: nowMs + STATE_TTL_MS,
      j: randomBytes(16).toString('base64url'),
    });

    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', state);
    return { url: url.toString(), state, nonce };
  }

  async completeJoin(input: { code: string; state: string; nonce: string }): Promise<JoinResult> {
    const payload = this.#verify(input.state);

    if (Date.now() > payload.e) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'This link expired. Please start again.');
    }
    if (
      typeof input.nonce !== 'string' ||
      input.nonce === '' ||
      !constantTimeEqual(sha256(input.nonce), payload.n)
    ) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Could not verify this request.');
    }

    this.#prune();
    if (this.#consumed.has(payload.j)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'This link was already used (replay).');
    }
    this.#consumed.set(payload.j, payload.e);

    // Re-resolved through the allowlist AFTER signature verification. Belt and
    // braces: a forged-but-valid signature still cannot name a role, only an
    // intent, and an unknown intent stops here.
    const option = resolveIntent(payload.i);
    const roleId = option === undefined ? undefined : this.#roleFor(option.intent);
    if (option === undefined || roleId === undefined) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown join option.');
    }

    const tokens = await this.discord.exchangeCode(input.code, this.config.redirectUri);
    const user = await this.discord.fetchUser(tokens.accessToken);

    // Is this person already in the guild? `PUT /members` with a `roles` array
    // REPLACES their roles, so applying it to an existing member would silently
    // strip every rank they hold.
    let existing = null;
    try {
      existing = await this.discord.fetchGuildMember(tokens.accessToken, this.config.guildId);
    } catch {
      existing = null; // treated as "not a member"; the add below is idempotent
    }

    try {
      if (existing !== null) {
        await this.discord.addRoleToMember(this.config.guildId, user.id, roleId);
      } else {
        await this.discord.addGuildMember(
          this.config.guildId,
          user.id,
          tokens.accessToken,
          [roleId],
        );
      }
    } catch (cause) {
      throw new AppError(
        ErrorCode.UPSTREAM_UNAVAILABLE,
        'Could not add you to the Discord server right now. An officer has been notified.',
        { cause: cause instanceof Error ? cause : undefined },
      );
    }

    return {
      discordUserId: user.id,
      roleId,
      roleName: option.roleName,
      joined: existing === null,
      alreadyMember: existing !== null,
    };
  }

  /** Test seam only — lets a spec forge a correctly-signed but hostile state. */
  signStateForTest(partial: { i: string; n: string }): string {
    return this.#sign({
      i: partial.i,
      n: sha256(partial.n),
      e: Date.now() + STATE_TTL_MS,
      j: randomBytes(16).toString('base64url'),
    });
  }

  #roleFor(intent: OnboardingIntent): string | undefined {
    return this.config.roleIds.find((b) => b.intent === intent)?.roleId;
  }

  #sign(payload: JoinState): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.#mac(body)}`;
  }

  #mac(body: string): string {
    return createHmac('sha256', this.config.stateSecret).update(body).digest('base64url');
  }

  #verify(state: string): JoinState {
    const bad = () => new AppError(ErrorCode.VALIDATION_FAILED, 'Could not verify this request.');
    if (typeof state !== 'string') throw bad();
    const idx = state.lastIndexOf('.');
    if (idx <= 0) throw bad();
    const body = state.slice(0, idx);
    if (!constantTimeEqual(state.slice(idx + 1), this.#mac(body))) throw bad();

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw bad();
    }
    const p = parsed as JoinState;
    if (
      typeof p?.i !== 'string' ||
      typeof p?.n !== 'string' ||
      typeof p?.e !== 'number' ||
      typeof p?.j !== 'string'
    ) {
      throw bad();
    }
    return p;
  }

  #prune(): void {
    const now = Date.now();
    for (const [j, exp] of this.#consumed) if (exp < now) this.#consumed.delete(j);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
