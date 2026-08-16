import { describe, expect, it } from 'vitest';
import {
  IDENTIFY_GRACE_MS,
  announcementDue,
  type PendingAnnouncement,
} from './announce-when-identified.js';

/**
 * When to tell the squadron about a new build.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "we need to fix the discord annoucement that is made when we start a new colonization project, we
 * need this to announce with the type of build it is please. even if there is a short delay in this
 * information please. its very important."
 *
 * ★ WHY EVERY ANNOUNCEMENT SAYS "BUILD TYPE NOT IDENTIFIED YET" TODAY ★
 *
 * The template has carried the build type all along. It has simply never had one to print. The
 * announcement fires from the create path, and `build_type_id` is set later — by the sync, which
 * matches the project's bill of materials against the catalogue. At the instant we post, the column
 * is null, every time, for every project.
 *
 * So the message a hauler reads names a system and nothing about what is being built there. Whether
 * to load a Refinery Hub's 22,000 tonnes or a Satellite Installation's few hundred is the entire
 * decision they are being asked to make, and the message has never once contained it.
 *
 * ★ THE DELAY IS THE FIX, AND THE OWNER ASKED FOR IT ★
 *
 * "even if there is a short delay". So: wait for identification, announce the moment it lands.
 *
 * ★ BUT IT MUST STILL FIRE WHEN NOTHING IS EVER IDENTIFIED ★
 *
 * Some builds never identify — a bill nobody has catalogued, a project posted without an opening
 * snapshot, a member who never opens the depot again. Waiting on identification WITHOUT a deadline
 * turns "a delayed announcement" into "no announcement", silently, for exactly the unusual builds
 * most worth hearing about. So the grace expires and it posts what it knows.
 */

const NOW = new Date('2026-08-15T12:00:00Z');
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

const pending = (over: Partial<PendingAnnouncement> = {}): PendingAnnouncement => ({
  createdAt: over.createdAt ?? ago(60_000),
  buildTypeId: over.buildTypeId === undefined ? null : over.buildTypeId,
  announcedAt: over.announcedAt === undefined ? null : over.announcedAt,
  visibility: over.visibility ?? 'squadron',
});

describe('a project whose build type is known', () => {
  it('★ MANDATORY: announces as soon as the type lands ★', () => {
    const out = announcementDue(pending({ buildTypeId: 'refinery-hub' }), NOW);

    expect(out.announce).toBe(true);
    expect(out.reason).toBe('identified');
  });

  it('★ MANDATORY: does not wait out the grace once it knows ★', () => {
    // The whole point is a SHORT delay. Holding an identified project for the full deadline would
    // be a delay that buys nothing, on the one path where we already have the answer.
    const out = announcementDue(
      pending({ buildTypeId: 'refinery-hub', createdAt: ago(1_000) }),
      NOW,
    );

    expect(out.announce).toBe(true);
  });
});

describe('a project still waiting to be identified', () => {
  it('★ MANDATORY: holds inside the grace ★', () => {
    const out = announcementDue(pending({ createdAt: ago(IDENTIFY_GRACE_MS - 60_000) }), NOW);

    expect(out.announce).toBe(false);
    expect(out.reason).toBe('waiting');
  });

  it('★ MANDATORY: posts anyway once the grace expires ★', () => {
    /*
     * The failure this prevents is the one that looks like success: a project that never identifies
     * would simply never be announced, and nothing anywhere would report a missing message. The
     * squadron would just never hear about it.
     */
    const out = announcementDue(pending({ createdAt: ago(IDENTIFY_GRACE_MS + 1) }), NOW);

    expect(out.announce).toBe(true);
    expect(out.reason).toBe('gave-up-waiting');
  });

  it('MANDATORY: the grace is short enough to still be an announcement', () => {
    /*
     * Stated as a test because it is the number the owner is really choosing. A build announced
     * three hours after it was posted is not news, it is an archive entry — and the haulers who
     * would have helped have logged off.
     */
    expect(IDENTIFY_GRACE_MS).toBeLessThanOrEqual(45 * 60_000);
    expect(IDENTIFY_GRACE_MS, 'and long enough for at least one sync to have run').toBeGreaterThanOrEqual(
      20 * 60_000,
    );
  });
});

describe('what must never be announced', () => {
  it('★ MANDATORY: a project already announced is never announced again ★', () => {
    /*
     * `announce()` has no dedup key — it inserts a row into a queue the bot drains. Exactly-once has
     * always come from the call site being reached once. Moving the call into a SWEEP that runs
     * every few minutes removes that guarantee, so it has to be replaced here: without this the
     * channel gets the same build posted every sweep, for ever.
     */
    const out = announcementDue(
      pending({ buildTypeId: 'refinery-hub', announcedAt: ago(5_000) }),
      NOW,
    );

    expect(out.announce).toBe(false);
    expect(out.reason).toBe('already-announced');
  });

  it('★ MANDATORY: a private build stays private, however long it waits ★', () => {
    /*
     * A member who set their build to private has already said who may see it. The grace expiring
     * is not consent — and a deadline that eventually posts everything would turn the privacy
     * setting into a delay.
     */
    const expired = pending({ visibility: 'private', createdAt: ago(IDENTIFY_GRACE_MS * 10) });

    expect(announcementDue(expired, NOW).announce).toBe(false);
    expect(announcementDue(expired, NOW).reason).toBe('private');
  });

  it('MANDATORY: private is refused even when identified', () => {
    const out = announcementDue(
      pending({ visibility: 'private', buildTypeId: 'refinery-hub' }),
      NOW,
    );

    expect(out.announce).toBe(false);
    expect(out.reason).toBe('private');
  });

  it('a public build is announced like a squadron one', () => {
    // Only `private` is silent. Public is a member choosing MORE visibility, not less.
    const out = announcementDue(
      pending({ visibility: 'public', buildTypeId: 'refinery-hub' }),
      NOW,
    );

    expect(out.announce).toBe(true);
  });
});
