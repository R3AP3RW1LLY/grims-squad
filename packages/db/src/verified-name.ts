import { AppError, ErrorCode } from '@grims/shared';
import type { PrismaClient } from './index.js';

/**
 * Recording the commander name Inara gave us — the ONE write path, for two processes.
 *
 * ★ WHY THIS MOVED HERE, 2026-08-05 ★
 *
 * It used to live only in the API, inside `PrismaInaraLinkStore.upsertVerification`, because only
 * the API ever learned a commander's name: a member pasted their key and Inara answered.
 *
 * Then the squadron owner reported members renaming themselves on Inara and the site never
 * noticing. Fixing that means the WORKER learns names too — the nightly sweep asks Inara for each
 * member's current identity — and the worker cannot import from the API.
 *
 * The alternative was a second copy of the transaction below. That transaction revokes a member's
 * previous claim before creating the new one, and it exists to hold a partial unique index that is
 * the only thing stopping two members from both being verified as the same commander (INV-005). A
 * second copy of THAT is not a wording drift; it is a race nobody would find until two people were
 * wearing one name.
 *
 * So it lives in `@grims/db`, which both processes already reach, and which is where the other
 * "one job, two callers" writes live — `colony-sync`, `notify`, `announce`. This is database code
 * by any reading: it is a transaction over two tables and an index it exists to respect.
 */

/** Inara's trust tier. cAPI would be 3; an officer vouching is 1. */
export const TIER_INARA = 2;

/**
 * Makes `cmdrName` the member's one active verified claim.
 *
 * Revokes their previous claim first: one active verified claim per member, or an old name keeps
 * holding a lock nobody is using (INV-005).
 *
 * ★ A CASE-ONLY DIFFERENCE IS NOT A NEW NAME ★
 *
 * Returns without writing when the member already holds this name in any casing. Elite treats
 * commander names case-insensitively and so does the partial unique index, so re-inserting would
 * violate it — and a nightly sweep that rewrote `PEBBLE` to `Pebble` and back would revoke and
 * recreate a verification row every night for the life of the squadron.
 *
 * Throws `CMDR_ALREADY_CLAIMED` when somebody else holds the name. Both callers need to know that
 * and neither may proceed: the API turns it into a 409 the member can act on, and the sweep counts
 * it and leaves the member's stored name alone rather than half-applying a rename.
 */
export async function upsertCmdrVerification(
  db: PrismaClient,
  userId: string,
  cmdrName: string,
  trustTier: number,
): Promise<void> {
  const now = new Date();
  await db.$transaction(async (tx) => {
    const existing = await tx.cmdrVerification.findFirst({
      where: { userId, isVerified: true, revokedAt: null },
      select: { id: true, cmdrName: true },
    });

    // Same name already verified — nothing to do, and re-inserting would
    // violate the partial unique index.
    if (existing !== null && existing.cmdrName.toLowerCase() === cmdrName.toLowerCase()) return;
    if (existing !== null) {
      await tx.cmdrVerification.update({ where: { id: existing.id }, data: { revokedAt: now } });
    }

    /*
     * @DATA-ADV FINDING, 2026-07-27 — this could raise a raw constraint error.
     *
     * The partial unique index on (cmdr_name) WHERE is_verified AND NOT
     * revoked is the real enforcement, and it fires when two members link
     * keys for the SAME commander — which sounds impossible until you
     * remember that two people can share one Inara account, and that the
     * application-level check runs before the write rather than inside it.
     *
     * Unhandled, that surfaced as a 500 with a Postgres constraint name in
     * it. Caught here it becomes the same clean CMDR_ALREADY_CLAIMED the
     * pre-check produces, so the member is told something they can act on
     * rather than being shown a database error.
     */
    try {
      await tx.cmdrVerification.create({
        data: {
          userId,
          cmdrName,
          method: 'inara_nonce',
          trustTier,
          isVerified: true,
          verifiedAt: now,
        },
      });
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      // P2002 is Prisma's unique-constraint violation. Anything else is a
      // genuine fault and must keep propagating.
      if (code !== 'P2002') throw cause;
      throw new AppError(
        ErrorCode.CMDR_ALREADY_CLAIMED,
        `CMDR ${cmdrName} was verified by another member a moment ago. Speak to an officer if that is wrong.`,
      );
    }
  });
}

/**
 * Whether Inara is telling us a member is now called something else.
 *
 * ★ CASE-INSENSITIVE, AND THAT IS NOT A DETAIL ★
 *
 * Elite is case-insensitive about commander names, the citext column is, the partial unique index
 * is, `upsertCmdrVerification` above is, and `composeNickname` humanizes whatever it is given — so
 * `PEBBLE` and `Pebble` produce the same nickname and the same roster entry. Treating them as a
 * rename would spend an Inara-shaped write, a Discord rename and an audit row every night, on every
 * member whose stored capitalisation differs from Inara's, forever, and change nothing anybody can
 * see.
 *
 * Blank is never a rename. Inara returning an empty name is a failed lookup wearing a string, and
 * "renamed to nothing" is not a fact about any commander.
 */
export function isRename(stored: string, reported: string): boolean {
  const fresh = reported.trim();
  if (fresh === '') return false;
  return fresh.toLowerCase() !== stored.trim().toLowerCase();
}
