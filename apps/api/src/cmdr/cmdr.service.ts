import { AppError, ErrorCode } from '@grims/shared';

/**
 * CMDR verification by officer approval (P1.8b).
 *
 * The member declares a name; an officer approves it. This is the MANUAL path,
 * built first because the automatic one — Frontier's cAPI — is blocked on an
 * application that takes weeks and may never be granted. It records trust tier
 * 1 honestly rather than dressing a human vouching up as cryptographic proof.
 *
 * ★ THE UNIQUENESS RULE, AND WHY IT IS SHAPED THIS WAY (INV-005) ★
 *
 * The lock applies ONLY to rows where `isVerified = true`. An earlier version
 * keyed the partial unique index on `revokedAt IS NULL` alone, which meant that
 * merely STARTING a claim locked a CMDR name permanently — any member could
 * deny any name, including every officer's, by opening a claim and never
 * completing it (RED-TEAM R7).
 *
 * A pending claim takes no lock at all. The consequence is that two members can
 * both have a pending claim on one name, so the conflict check must run at
 * APPROVAL time as well as at declaration time. Both are here.
 */

export type VerificationMethod = 'fdev_capi' | 'inara_nonce' | 'officer_manual';

export interface ClaimRecord {
  readonly id: string;
  readonly userId: string;
  readonly cmdrName: string;
  readonly isVerified: boolean;
  readonly trustTier: number;
  readonly method: VerificationMethod;
  readonly verifiedAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface QueueEntry extends ClaimRecord {
  /**
   * True when another member already holds this name verified.
   *
   * Surfaced in the queue so the officer sees the conflict BEFORE approving,
   * rather than meeting an error afterwards and wondering what they did wrong.
   */
  readonly conflictsWithVerified: boolean;
}

export interface CmdrStore {
  pendingFor(userId: string): Promise<ClaimRecord | null>;
  verifiedFor(userId: string): Promise<ClaimRecord | null>;
  verifiedHolderOf(cmdrName: string): Promise<ClaimRecord | null>;
  byId(id: string): Promise<ClaimRecord | null>;
  listPending(): Promise<ClaimRecord[]>;
  createPending(userId: string, cmdrName: string, at: Date): Promise<ClaimRecord>;
  markVerified(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

/** Elite caps commander names well below this; the limit is a sanity bound, not a rule. */
const MAX_NAME = 64;

function cleanName(raw: string): string {
  const name = raw.trim();
  if (name === '' || name.length > MAX_NAME) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `A commander name must be between 1 and ${MAX_NAME} characters.`,
    );
  }
  return name;
}

export class CmdrService {
  constructor(private readonly store: CmdrStore) {}

  /** The member's own declaration. Creates a PENDING claim and nothing more. */
  async declare(userId: string, rawName: string, now: Date = new Date()): Promise<ClaimRecord> {
    const cmdrName = cleanName(rawName);

    const holder = await this.store.verifiedHolderOf(cmdrName);
    if (holder !== null && holder.userId !== userId) {
      // Checked here as a courtesy so the member finds out immediately rather
      // than waiting in a queue for a rejection. The check at approval time is
      // the one that actually enforces it.
      throw new AppError(
        ErrorCode.CMDR_ALREADY_CLAIMED,
        'That commander name is already verified by another member. Speak to an officer if it is yours.',
      );
    }

    // One pending claim per member. Someone correcting a typo should not leave
    // two rows in the officer queue, one of which is wrong.
    const existing = await this.store.pendingFor(userId);
    if (existing !== null) await this.store.revoke(existing.id, now);

    return this.store.createPending(userId, cmdrName, now);
  }

  async pendingQueue(): Promise<QueueEntry[]> {
    const pending = await this.store.listPending();
    const out: QueueEntry[] = [];
    for (const c of pending) {
      const holder = await this.store.verifiedHolderOf(c.cmdrName);
      out.push({ ...c, conflictsWithVerified: holder !== null && holder.userId !== c.userId });
    }
    return out;
  }

  /**
   * Returns WHOSE claim this was.
   *
   * Not decoration: an officer approving from the console changes somebody
   * else's page, and the caller has to know which member to notify — otherwise
   * the one person who has been waiting for this is the only one who does not
   * find out until they reload.
   */
  async approve(
    claimId: string,
    officerId: string,
    now: Date = new Date(),
  ): Promise<{ userId: string }> {
    const claim = await this.store.byId(claimId);
    if (claim === null || claim.revokedAt !== null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Claim not found.');
    }

    // Already done. Returning quietly rather than erroring, so a double-click
    // is not an incident — and without a second audit row saying it happened
    // twice, which it did not.
    if (claim.isVerified) return { userId: claim.userId };

    if (claim.userId === officerId) {
      // Self-approval turns a two-party check into a formality. The officer can
      // still be verified; another officer approves them.
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'You cannot approve your own claim. Ask another officer.',
      );
    }

    // THE enforcing check. Two members can both hold a pending claim on one
    // name — pending claims take no lock — so the conflict is only decidable
    // here, at the moment one of them becomes real.
    const holder = await this.store.verifiedHolderOf(claim.cmdrName);
    if (holder !== null && holder.userId !== claim.userId) {
      throw new AppError(
        ErrorCode.CMDR_ALREADY_CLAIMED,
        `CMDR ${claim.cmdrName} is already verified for another member. Revoke that claim first if this one is correct.`,
      );
    }

    // One active verified claim per member. Leaving the old one verified would
    // keep a lock on a name they no longer use.
    const previous = await this.store.verifiedFor(claim.userId);
    if (previous !== null && previous.id !== claim.id) await this.store.revoke(previous.id, now);

    await this.store.markVerified(claim.id, now);
    await this.store.writeAudit({
      // A human chose this, so the officer IS the actor — unlike reconciliation,
      // where no one did.
      actorId: officerId,
      action: 'cmdr.approve',
      targetType: 'cmdr_verification',
      targetId: claim.id,
      before: { cmdrName: claim.cmdrName, isVerified: false },
      after: { cmdrName: claim.cmdrName, isVerified: true, trustTier: 1, method: 'officer_manual' },
    });

    return { userId: claim.userId };
  }

  async reject(
    claimId: string,
    officerId: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<{ userId: string }> {
    const claim = await this.store.byId(claimId);
    if (claim === null || claim.revokedAt !== null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Claim not found.');
    }
    if (reason.trim() === '') {
      // A rejection with no explanation is not reviewable, and the member has
      // no idea what to do differently.
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'A rejection needs a reason.');
    }

    // Revoked, not deleted. The name becomes free again immediately — whoever
    // actually owns it still has to be able to get verified — while the attempt
    // stays in the record.
    await this.store.revoke(claim.id, now);
    await this.store.writeAudit({
      actorId: officerId,
      action: 'cmdr.reject',
      targetType: 'cmdr_verification',
      targetId: claim.id,
      before: { cmdrName: claim.cmdrName, isVerified: false },
      after: { revoked: true, reason: reason.trim() },
    });

    // As with `approve`: the member whose claim this was, so they can be told.
    return { userId: claim.userId };
  }
}
