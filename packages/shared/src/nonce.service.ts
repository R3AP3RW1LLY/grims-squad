import { randomInt } from 'node:crypto';
import { AppError, ErrorCode } from './errors.js';

/**
 * CMDR verification by Inara nonce (P1.8b, trust tier 2).
 *
 * The member puts a short code in their Inara profile; the worker reads the
 * profile and confirms it is there. That proves they control the Inara account,
 * which is bound to a CMDR name — weaker than Frontier's cAPI (tier 3), much
 * stronger than an officer taking their word for it (tier 1).
 *
 * ★ NOT-FOUND-YET IS A NORMAL STATE ★
 *
 * Between issuing the nonce and the member actually going to another website to
 * edit their profile, EVERY poll finds nothing. That is the expected case, not
 * a failure. Reporting it as an error fills the log with alarms about the
 * system working correctly and buries the one poll that genuinely broke.
 *
 * ★ AND A PENDING CLAIM TAKES NO LOCK (INV-005, RED-TEAM R7) ★
 *
 * The uniqueness lock applies only to verified rows, and pending claims expire.
 * Otherwise any member could permanently deny any CMDR name — including every
 * officer's — by opening a claim and never completing it.
 */

/** 24 hours. Long enough to notice the message; short enough that abandonment clears. */
export const NONCE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * No O/0, I/1 or L.
 *
 * Somebody is going to read this off one screen and type it into another. An
 * ambiguous glyph turns "the code does not work" into a support conversation
 * where neither party can see what the other typed.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const NONCE_LEN = 6;

export function formatNonce(body: string): string {
  return `GRIMS-${body}`;
}

function randomNonceBody(): string {
  let out = '';
  // randomInt, not Math.random. A predictable nonce would let someone put
  // ANOTHER member's pending nonce into their own Inara bio and be verified as
  // that commander.
  for (let i = 0; i < NONCE_LEN; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export interface NonceClaim {
  readonly id: string;
  readonly userId: string;
  readonly cmdrName: string;
  readonly claimNonce: string;
  readonly nonceExpiresAt: Date;
  readonly isVerified: boolean;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface NonceStore {
  pendingFor(userId: string): Promise<NonceClaim | null>;
  byId(id: string): Promise<NonceClaim | null>;
  listPollable(): Promise<NonceClaim[]>;
  verifiedHolderOf(cmdrName: string): Promise<NonceClaim | null>;
  createPending(
    userId: string,
    cmdrName: string,
    nonce: string,
    expiresAt: Date,
    at: Date,
  ): Promise<NonceClaim>;
  markVerified(id: string, trustTier: number, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

/**
 * `pending` is the COMMON outcome and is not a failure.
 * `conflict` means somebody else verified the name while this claim was open.
 */
export type CheckOutcome = 'verified' | 'pending' | 'expired' | 'conflict' | 'already-verified';

export interface CheckResult {
  readonly outcome: CheckOutcome;
  readonly message: string;
}

export class NonceService {
  constructor(private readonly store: NonceStore) {}

  async issue(userId: string, cmdrName: string, now: Date = new Date()): Promise<NonceClaim> {
    const name = cmdrName.trim();
    if (name === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'A commander name is required.');
    }

    const holder = await this.store.verifiedHolderOf(name);
    if (holder !== null && holder.userId !== userId) {
      throw new AppError(
        ErrorCode.CMDR_ALREADY_CLAIMED,
        'That commander name is already verified by another member.',
      );
    }

    // One open claim per member. Someone correcting a typo should not leave a
    // second nonce that will never be found, quietly consuming poll budget.
    const existing = await this.store.pendingFor(userId);
    if (existing !== null) await this.store.revoke(existing.id, now);

    return this.store.createPending(
      userId,
      name,
      formatNonce(randomNonceBody()),
      new Date(now.getTime() + NONCE_TTL_MS),
      now,
    );
  }

  /** The member's own open claim, so the UI can show them their code again. */
  async pendingFor(userId: string): Promise<NonceClaim | null> {
    return this.store.pendingFor(userId);
  }

  /**
   * Claims worth polling.
   *
   * Expired ones are excluded, and that matters: Inara allows two calls a
   * minute globally (INV-033), so abandoned claims would otherwise consume the
   * budget forever and starve the members who are actually waiting.
   */
  async duePolls(now: Date = new Date()): Promise<NonceClaim[]> {
    const all = await this.store.listPollable();
    return all.filter((c) => c.nonceExpiresAt.getTime() > now.getTime());
  }

  /** Test seam and admin escape hatch: mark a claim found without a live bio. */
  async recordFound(claimId: string, now: Date = new Date()): Promise<void> {
    await this.store.markVerified(claimId, 2, now);
  }

  /**
   * Decides a single claim against the bio text Inara returned.
   *
   * Takes the TEXT rather than calling Inara, so the decision is testable
   * without the network and so this can never be the thing that calls Inara
   * from a request path (INV-031/033).
   */
  async checkBio(claimId: string, bio: string, now: Date = new Date()): Promise<CheckResult> {
    const claim = await this.store.byId(claimId);
    if (claim === null || claim.revokedAt !== null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Claim not found.');
    }

    if (claim.isVerified) {
      return { outcome: 'already-verified', message: 'Already verified.' };
    }

    if (claim.nonceExpiresAt.getTime() <= now.getTime()) {
      // Revoked, so the NAME BECOMES FREE. An abandoned claim must never hold a
      // commander name hostage — that is the whole of RED-TEAM R7.
      await this.store.revoke(claim.id, now);
      return {
        outcome: 'expired',
        message: 'This verification code has expired. Start again to get a new one.',
      };
    }

    // Case-insensitive and anywhere in the text: people paste it into a
    // sentence, and no site normalises case reliably.
    if (!bio.toUpperCase().includes(claim.claimNonce.toUpperCase())) {
      // THE COMMON CASE. Not an error, not logged, not audited.
      return {
        outcome: 'pending',
        message: 'The code is not in the Inara profile yet.',
      };
    }

    // Re-checked HERE, not only at issue time. Two members can both hold a
    // pending claim on one name, so the conflict is only decidable at the
    // moment one of them becomes real.
    const holder = await this.store.verifiedHolderOf(claim.cmdrName);
    if (holder !== null && holder.userId !== claim.userId) {
      return {
        outcome: 'conflict',
        message: `CMDR ${claim.cmdrName} was verified by another member while this claim was open.`,
      };
    }

    await this.store.markVerified(claim.id, 2, now);
    await this.store.writeAudit({
      // No actor. Nobody approved this — a poll observed the member's own proof.
      actorId: null,
      action: 'cmdr.verify.inara',
      targetType: 'cmdr_verification',
      targetId: claim.id,
      before: { cmdrName: claim.cmdrName, isVerified: false },
      after: { cmdrName: claim.cmdrName, isVerified: true, trustTier: 2, method: 'inara_nonce' },
    });

    return { outcome: 'verified', message: `CMDR ${claim.cmdrName} verified via Inara.` };
  }
}
