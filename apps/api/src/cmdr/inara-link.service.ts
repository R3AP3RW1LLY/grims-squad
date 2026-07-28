import {
  evaluateSquadron,
  expectedSquadronName,
  sameSquadron,
  statusOf,
} from './squadron-verification.service.js';
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
  /**
   * Records what Inara said about their squadron.
   *
   * ★ PART OF THE FIRST CHECK, NOT A LATER STEP ★
   *
   * A member who links a key finds out immediately whether we can see them in
   * the squadron. Making them link, wait, and then discover a second hurdle
   * would be two disappointments where one honest answer will do.
   */
  recordSquadron(
    userId: string,
    reported: string | null,
    matched: boolean,
    at: Date,
  ): Promise<void>;
  /** Records that the member says they have applied. Their claim, never proof. */
  claimSquadron(userId: string, at: Date): Promise<void>;
  /** The squadron half of their verification, for the settings page. */
  squadronState(userId: string): Promise<{
    cmdrName: string | null;
    isVerified: boolean;
    inaraSquadron: string | null;
    squadronVerifiedAt: Date | null;
    squadronClaimedAt: Date | null;
    squadronCheckedAt: Date | null;
  } | null>;
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
  /**
   * Name AND squadron, which is the whole of what we ask Inara for.
   *
   * Optional so existing fakes keep working; the service falls back to the
   * name-only call when it is absent.
   */
  getOwnIdentity?(apiKey: string): Promise<{
    cmdrName: string;
    squadronName: string | null;
    squadronRank: string | null;
  } | null>;
}

/**
 * Does Inara say this commander is in our squadron?
 *
 * Delegates to `sameSquadron`, which is the ONE comparison rule. This file used
 * to carry its own normaliser and its own hardcoded name; two rules for the
 * same question drift, and the drift here would mark real members as outsiders
 * with a failure that looks like Inara being wrong.
 */
export function isInSquadron(squadronName: string | null): boolean {
  return sameSquadron(squadronName, expectedSquadronName());
}

export interface LinkResult {
  readonly cmdrName: string | null;
  readonly verified: boolean;
  readonly error: string | null;
  /** What Inara says their squadron is. Null when they have not set one. */
  readonly squadronName?: string | null;
  /**
   * Whether Inara agrees they are in Grim's Squad.
   *
   * INFORMATIONAL, never a gate. Plenty of real members never set a squadron
   * on Inara, and refusing them would punish people for not using a third-party
   * site we do not run. Officers see the flag and decide.
   */
  readonly inSquadron?: boolean;
}

export interface LinkStatus {
  /**
   * Where they stand overall: no verified name, a name but no squadron, or both.
   *
   * A single field rather than two booleans for the page to combine. Three
   * states have three messages, and letting the UI derive them invites two
   * screens to disagree about what "partially verified" means.
   */
  squadronStatus?: 'unverified' | 'partial' | 'verified';
  /** The squadron Inara last reported, verbatim. Null when they have set none. */
  inaraSquadron?: string | null;
  /** The squadron we are looking for, so the page never hardcodes it. */
  expectedSquadron?: string;
  /** They have said they applied. Drives the twenty-minute re-check. */
  squadronClaimed?: boolean;
  squadronCheckedAt?: string | null;
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
    let squadronName: string | null = null;
    try {
      // Prefer the richer call. Inara is used for exactly two things — the
      // commander name and squadron membership — and both come from one
      // request, so there is no reason to make two.
      if (this.inara.getOwnIdentity !== undefined) {
        const identity = await this.inara.getOwnIdentity(key);
        cmdrName = identity?.cmdrName ?? null;
        squadronName = identity?.squadronName ?? null;
      } else {
        cmdrName = await this.inara.getOwnCommanderName(key);
      }
    } catch (cause) {
      /*
       * ★ FOUND IN USE, 2026-07-27 ★
       *
       * This used to collapse EVERY failure into "could not reach Inara", so a
       * member whose key was simply wrong was told the service was down — and
       * would sensibly wait and try the same wrong key again. The three cases
       * need three different answers because they need three different actions.
       *
       * The cause is still never interpolated into any message: Inara echoes
       * request parameters in some error payloads and the request carries the
       * key, so quoting upstream would put a live credential into an HTTP
       * response, a log line and an error report at once (INV-012). The CLASS
       * of error is safe to distinguish; its text is not.
       */
      const name = (cause as { name?: string }).name;

      if (name === 'InaraNotApprovedError') {
        /*
         * ★ CONFIRMED AGAINST THE LIVE API, 2026-07-27 ★
         *
         * Inara answers HTTP 200 with header.eventStatus 400 and the text
         * "This application has no access allowed" until OUR APPLICATION is
         * registered with them. It is an envelope-level rejection of us, not
         * of the member's key — no key of any kind will work until that is
         * done.
         *
         * The first draft of this message told the member to generate a new
         * key. That is worse than saying nothing: they would replace a
         * perfectly good key, fail again, and reasonably conclude the site is
         * broken. A wrong instruction costs more than a vague one.
         *
         * A member's key being WRONG is a different signal entirely — Inara
         * returns event-level 204, which the adapter maps to null and which is
         * handled below as "did not recognise".
         */
        throw new AppError(
          ErrorCode.CAPI_NOT_APPROVED,
          'Inara verification is not available yet — our application is still awaiting access from Inara. Your key is fine; nothing you can do will change this. Ask an officer to verify you in the meantime.',
        );
      }

      if (name === 'LimiterBusyError') {
        // Our own queue, not Inara's fault and not the member's. Inara allows
        // two calls a minute globally (INV-033), so this genuinely does clear.
        throw new AppError(
          ErrorCode.UPSTREAM_UNAVAILABLE,
          'Too many verifications happening at once. Wait a minute and try again — your key is fine.',
        );
      }

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

    /*
     * The squadron check runs HERE, in the same breath as the name. Inara
     * returned both in one call, and asking again later would spend a second
     * request from a budget of two a minute to learn something we already know.
     */
    const squadron = evaluateSquadron(squadronName, expectedSquadronName());
    await this.store.recordSquadron(userId, squadron.reported, squadron.matched, now);

    await this.store.writeAudit({
      // The member did this themselves, so they ARE the actor — unlike a poll
      // or a reconciliation, where nobody chose anything.
      actorId: userId,
      action: 'cmdr.verify.inara_key',
      targetType: 'user',
      targetId: userId,
      before: null,
      // The key is not in here, and must never be.
      after: {
        cmdrName,
        trustTier: TIER_INARA,
        source,
        squadron: squadron.reported,
        inSquadron: squadron.matched,
      },
    });

    // FIRST ADD — the nickname is set here, which is the moment the human
    // asked for.
    await this.#reconcileNickname(userId);

    return {
      cmdrName,
      verified: true,
      error: null,
      squadronName: squadron.reported,
      inSquadron: squadron.matched,
    };
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
    let squadronName: string | null = null;
    try {
      /*
       * ★ THE RICHER CALL, SO A RE-CHECK RE-CHECKS THE SQUADRON TOO ★
       *
       * This used to ask only for the commander name and throw the squadron
       * away — so a member who joined the squadron on Inara could refresh
       * forever and never become verified. It is the same one request either
       * way; discarding half of it bought nothing and broke the feature.
       */
      if (this.inara.getOwnIdentity !== undefined) {
        const identity = await this.inara.getOwnIdentity(link.apiKey);
        cmdrName = identity?.cmdrName ?? null;
        squadronName = identity?.squadronName ?? null;
      } else {
        cmdrName = await this.inara.getOwnCommanderName(link.apiKey);
      }
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

    const squadron = evaluateSquadron(squadronName, expectedSquadronName());
    await this.store.recordSquadron(userId, squadron.reported, squadron.matched, now);

    /*
     * The nickname LAST, after the squadron is recorded.
     *
     * Order matters: the nickname is `RANK - COMMANDER`, and a member who has
     * just been confirmed into the squadron may have gained a rank role with
     * it. Reconciling first would write the old title and leave it until the
     * next check.
     */
    await this.#reconcileNickname(userId);

    return {
      cmdrName,
      verified: true,
      error: null,
      squadronName: squadron.reported,
      inSquadron: squadron.matched,
    };
  }

  /**
   * Records the member's claim to have applied, then re-checks immediately.
   *
   * ★ THE IMMEDIATE RE-CHECK IS THE POINT ★
   *
   * Ticking the box and being told to come back in twenty minutes is a bad
   * experience for the common case, where they joined on Inara a moment before
   * ticking it. So this asks Inara there and then; the scheduled sweep exists
   * for the case where Inara had not caught up yet.
   *
   * A failed check is NOT an error. The claim is recorded either way, so the
   * sweep will keep trying — the member has done their part.
   */
  async claimSquadron(userId: string, now: Date = new Date()): Promise<LinkResult> {
    await this.store.claimSquadron(userId, now);

    try {
      return await this.refresh(userId, now);
    } catch {
      return {
        cmdrName: null,
        verified: false,
        error: 'We could not reach Inara just now. We will keep checking every twenty minutes.',
      };
    }
  }

  /** What the member sees. Reports that a key EXISTS, never what it is. */
  async status(userId: string): Promise<LinkStatus> {
    /*
     * The squadron half is read even when there is no key on file. A member can
     * be verified by an officer without ever linking one, and they still need
     * to be told whether we can see them in the squadron.
     */
    const squadron = await this.store.squadronState(userId).catch(() => null);
    const squadronFields = {
      squadronStatus: statusOf(squadron),
      inaraSquadron: squadron?.inaraSquadron ?? null,
      expectedSquadron: expectedSquadronName(),
      squadronClaimed: squadron?.squadronClaimedAt != null,
      squadronCheckedAt: squadron?.squadronCheckedAt?.toISOString() ?? null,
    };

    const link = await this.store.get(userId);
    if (link === null) {
      // No key on file. The squadron half still travels: a member verified by
      // an officer has no key and still needs to know where they stand.
      return {
        linked: false,
        cmdrName: null,
        verifiedAt: null,
        lastCheckedAt: null,
        lastError: null,
        source: null,
        ...squadronFields,
      };
    }
    return {
      linked: true,
      cmdrName: link.cmdrName,
      verifiedAt: link.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: link.lastCheckedAt?.toISOString() ?? null,
      lastError: link.lastError,
      source: link.source,
      ...squadronFields,
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
