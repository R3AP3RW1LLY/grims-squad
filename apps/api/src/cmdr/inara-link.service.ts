import { AppError, ErrorCode } from '@grims/shared';

/**
 * CMDR verification by the member's OWN Inara API key (P1.8b, trust tier 2).
 *
 * ★ THE PROPERTY THAT MAKES THIS VERIFICATION RATHER THAN A CLAIM ★
 *
 * The commander name comes back FROM INARA. There is deliberately no parameter
 * anywhere in this service for a caller to supply one. Holding the key is the
 * proof; the name is a consequence of the key, not an assertion made alongside
 * it.
 *
 * If a name could be passed in, this would degrade to self-declaration while
 * still recording trust tier 2 — worse than having nothing, because an officer
 * would then be trusting a claim that nobody checked.
 *
 * ★ THE KEY IS A CREDENTIAL ★
 *
 * It is the member's own Inara account key. Encrypted at rest, never returned
 * by any endpoint, never in an error message (INV-012). The service reports
 * whether a key EXISTS, which the member needs, and never what it is.
 */

export interface LinkRecord {
  readonly userId: string;
  readonly apiKey: string;
  readonly cmdrName: string | null;
  readonly verifiedAt: Date | null;
  readonly lastCheckedAt: Date | null;
  readonly lastError: string | null;
  readonly source: string;
}

export interface InaraLinkStore {
  get(userId: string): Promise<LinkRecord | null>;
  saveKey(userId: string, apiKey: string, source: string): Promise<void>;
  recordSuccess(userId: string, cmdrName: string, at: Date): Promise<void>;
  recordFailure(userId: string, error: string, at: Date): Promise<void>;
  remove(userId: string): Promise<void>;
  /** The userId who already holds this commander verified, if anyone. */
  verifiedHolderOf(cmdrName: string): Promise<string | null>;
  upsertVerification(userId: string, cmdrName: string, trustTier: number): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Reconciles the member's Discord nickname against their verified name.
 *
 * Injected and OPTIONAL: the link service is useful without Discord wired up
 * (tests, and any deployment where the bot is not configured), and a nickname
 * is cosmetic next to the verification itself.
 */
export interface NicknameReconciler {
  sync(userId: string, discordId: string): Promise<{ changed: boolean; reason: string | null }>;
}

/** The one Inara call this service needs. Narrow on purpose. */
export interface InaraOwnProfile {
  /** The commander bound to THIS key. `null` when Inara does not recognise it. */
  getOwnCommanderName(apiKey: string): Promise<string | null>;
}

export interface LinkResult {
  readonly cmdrName: string | null;
  readonly verified: boolean;
  readonly error: string | null;
}

export interface LinkStatus {
  readonly linked: boolean;
  readonly cmdrName: string | null;
  readonly verifiedAt: string | null;
  readonly lastCheckedAt: string | null;
  readonly lastError: string | null;
  readonly source: string | null;
}

/** Inara's trust tier. cAPI would be 3; an officer vouching is 1. */
const TIER_INARA = 2;

export class InaraLinkService {
  constructor(
    private readonly store: InaraLinkStore,
    private readonly inara: InaraOwnProfile,
    /**
     * Runs after ANY successful Inara call, per the human decision of
     * 2026-07-27: set the nickname when the key is first added, and re-check it
     * whenever we talk to Inara. Not on sign-in — a login tells us nothing new
     * about their commander name.
     *
     * Because it compares current against verified every time, a member who
     * renames themselves in Discord is put back at the next check.
     */
    private readonly nicknames?: NicknameReconciler,
    private readonly discordIdFor?: (userId: string) => Promise<string | null>,
  ) {}

  /**
   * Best-effort nickname reconciliation.
   *
   * Never throws and never blocks the result: the member linked a key and it
   * worked, and a Discord rename that Discord refused is not a reason to tell
   * them otherwise.
   */
  async #reconcileNickname(userId: string): Promise<void> {
    if (this.nicknames === undefined || this.discordIdFor === undefined) return;
    try {
      const discordId = await this.discordIdFor(userId);
      if (discordId !== null) await this.nicknames.sync(userId, discordId);
    } catch {
      /* cosmetic; the verification stands regardless */
    }
  }

  /**
   * Links a key and verifies the commander it belongs to.
   *
   * NOTE THE SIGNATURE: there is no commander name parameter, and there must
   * never be one.
   */
  async link(
    userId: string,
    apiKey: string,
    source: 'web' | 'app' = 'web',
    now: Date = new Date(),
  ): Promise<LinkResult> {
    const key = apiKey.trim();
    if (key === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'An Inara API key is required.');
    }

    let cmdrName: string | null;
    try {
      cmdrName = await this.inara.getOwnCommanderName(key);
    } catch {
      /*
       * The cause is deliberately NOT included in the message.
       *
       * Inara echoes request parameters in some error payloads, and the request
       * contains the key. Interpolating the upstream error would put a live
       * credential into an HTTP response, a log line and an error report at
       * once — the exact back door INV-012 exists to close.
       */
      throw new AppError(
        ErrorCode.UPSTREAM_UNAVAILABLE,
        'Could not reach Inara to check that key. Try again in a few minutes.',
      );
    }

    if (cmdrName === null || cmdrName.trim() === '') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Inara did not recognise that API key. Copy it again from your Inara profile settings.',
      );
    }

    // Nobody else may already hold this commander. The key proves control of an
    // Inara account, not an exclusive right to a name somebody else verified.
    const holder = await this.store.verifiedHolderOf(cmdrName);
    if (holder !== null && holder !== userId) {
      throw new AppError(
        ErrorCode.CMDR_ALREADY_CLAIMED,
        `CMDR ${cmdrName} is already verified by another member. Speak to an officer if that is wrong.`,
      );
    }

    await this.store.saveKey(userId, key, source);
    await this.store.recordSuccess(userId, cmdrName, now);
    await this.store.upsertVerification(userId, cmdrName, TIER_INARA);
    await this.store.writeAudit({
      // The member did this themselves, so they ARE the actor — unlike a poll
      // or a reconciliation, where nobody chose anything.
      actorId: userId,
      action: 'cmdr.verify.inara_key',
      targetType: 'user',
      targetId: userId,
      before: null,
      // The key is not in here, and must never be.
      after: { cmdrName, trustTier: TIER_INARA, source },
    });

    // FIRST ADD — the nickname is set here, which is the moment the human
    // asked for.
    await this.#reconcileNickname(userId);

    return { cmdrName, verified: true, error: null };
  }

  /**
   * Re-checks an existing link.
   *
   * A FAILURE NEVER REVOKES. Inara being unreachable is not evidence that a
   * member is lying, and dropping their verified status over somebody else's
   * outage would demote real people for no reason. The failure is recorded so
   * it is visible, and the previous name stands.
   */
  async refresh(userId: string, now: Date = new Date()): Promise<LinkResult> {
    const link = await this.store.get(userId);
    if (link === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No Inara key on file.');
    }

    let cmdrName: string | null = null;
    try {
      cmdrName = await this.inara.getOwnCommanderName(link.apiKey);
    } catch {
      const message = 'Could not reach Inara at the last check. Your verification is unchanged.';
      await this.store.recordFailure(userId, message, now);
      return { cmdrName: link.cmdrName, verified: link.verifiedAt !== null, error: message };
    }

    if (cmdrName === null || cmdrName.trim() === '') {
      // The key stopped working — regenerated on Inara, most likely. Recorded
      // rather than revoked, for the same reason as above: the member proved
      // this once, and a stale credential is not a retraction.
      const message = 'Inara no longer recognises this key. Add a new one to keep it current.';
      await this.store.recordFailure(userId, message, now);
      return { cmdrName: link.cmdrName, verified: link.verifiedAt !== null, error: message };
    }

    await this.store.recordSuccess(userId, cmdrName, now);
    await this.store.upsertVerification(userId, cmdrName, TIER_INARA);

    // We just called Inara, so the nickname is re-checked — this is what puts
    // back a member who renamed themselves in Discord.
    await this.#reconcileNickname(userId);

    return { cmdrName, verified: true, error: null };
  }

  /** What the member sees. Reports that a key EXISTS, never what it is. */
  async status(userId: string): Promise<LinkStatus> {
    const link = await this.store.get(userId);
    if (link === null) {
      return {
        linked: false,
        cmdrName: null,
        verifiedAt: null,
        lastCheckedAt: null,
        lastError: null,
        source: null,
      };
    }
    return {
      linked: true,
      cmdrName: link.cmdrName,
      verifiedAt: link.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: link.lastCheckedAt?.toISOString() ?? null,
      lastError: link.lastError,
      source: link.source,
    };
  }

  /**
   * Removes the stored key.
   *
   * Does NOT un-verify the commander name. The member proved it; removing the
   * credential is a privacy choice — "stop calling Inara on my behalf" — and
   * silently demoting them for exercising it would be a trap.
   */
  async unlink(userId: string, now: Date = new Date()): Promise<void> {
    await this.store.remove(userId);
    await this.store.writeAudit({
      actorId: userId,
      action: 'cmdr.inara_key.unlink',
      targetType: 'user',
      targetId: userId,
      before: { linked: true },
      after: { linked: false, verificationRetained: true, at: now.toISOString() },
    });
  }
}
