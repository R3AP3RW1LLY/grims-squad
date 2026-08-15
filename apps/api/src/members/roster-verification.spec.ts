import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { PrismaMembersStore } from './members.store.js';

/**
 * Which commander name the roster is allowed to print, and what "verified"
 * means on a card.
 *
 * ★ THE BUG THIS LOCKS DOWN ★
 *
 * The roster read `cmdrVerifications` filtered on `revokedAt: null` ALONE, so
 * an unproven claim supplied the commander name shown to the whole squadron.
 *
 * That was not cosmetic. Three facts combined into an impersonation route:
 *
 *   1. `createPending` stores the claimed name with `verifiedAt` set to NOW.
 *   2. This query orders by `verifiedAt desc` and takes one — so a claim opened
 *      seconds ago sorted ABOVE a genuinely verified row and replaced it.
 *   3. INV-005's uniqueness lock applies only where `isVerified = true`, so a
 *      pending claim may name a commander somebody else has already proven.
 *
 * Together: type another member's verified CMDR name into the claim form, and
 * the roster attributes it to you. No verification step, nothing revoked, and
 * the real owner's own card loses the name at the same time.
 */

interface Captured {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  orderBy?: unknown;
}

/** A row shaped exactly as `#SELECT` asks for it. */
function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'u1',
    handle: 'someone',
    displayName: 'Someone',
    avatarUrl: null,
    avatarStoredHash: null,
    bio: null,
    timezone: 'UTC',
    lastPlayingAt: null,
    joinedAt: new Date('2026-01-01T00:00:00Z'),
    status: 'active',
    privacySettings: null,
    cmdrVerifications: [],
    discordIdentity: null,
    userRoles: [],
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Real elapsed time, because the store reads the wall clock rather than an injected one. */
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

/**
 * A cAPI grant, shaped exactly as the Frontier read selects it.
 *
 * `isStale` false and a recent `verifiedAt` is the ordinary live state — every
 * case below is this row with one thing wrong with it.
 */
function capiRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { userId: 'u1', isStale: false, verifiedAt: daysAgo(1), ...overrides };
}

function storeReturning(
  rows: Array<Record<string, unknown>>,
  capi: Array<Record<string, unknown>> = [],
): {
  store: PrismaMembersStore;
  captured: Captured;
  frontier: Captured;
} {
  const captured: Captured = {};
  const frontier: Captured = {};
  const db = {
    user: {
      findMany: async (args: Captured) => {
        Object.assign(captured, args);
        return rows;
      },
    },
    /*
     * The Frontier grant is a SECOND read rather than a second nested select,
     * and this fake is why the difference is visible here at all. Prisma cannot
     * select one relation twice with two different filters, and the existing
     * `cmdrVerifications` filter is `isVerified: true` — which no cAPI row ever
     * satisfies. See the Frontier describe block below.
     */
    cmdrVerification: {
      findMany: async (args: Captured) => {
        Object.assign(frontier, args);
        return capi;
      },
    },
  } as unknown as PrismaClient;

  return { store: new PrismaMembersStore(db), captured, frontier };
}

describe('the commander name the roster prints', () => {
  it('MANDATORY: asks the database for VERIFIED rows only', async () => {
    /*
     * Asserted on the query rather than on the result, deliberately. Filtering
     * in JavaScript afterwards would still have pulled every pending claim into
     * the process, and the next person to add a field would have had to know to
     * re-apply the filter.
     */
    const { store, captured } = storeReturning([]);
    await store.roster();

    const verifications = (captured.select as Record<string, { where?: Record<string, unknown> }>)[
      'cmdrVerifications'
    ];

    expect(verifications?.where).toEqual({ revokedAt: null, isVerified: true });
  });

  it('MANDATORY: a pending claim contributes no name', async () => {
    // Prisma applies the where clause, so a correct query returns nothing here.
    // This is the shape the card must cope with: verified rows absent entirely.
    const { store } = storeReturning([userRow({ cmdrVerifications: [] })]);
    const [row] = await store.roster();

    expect(row?.source.cmdrName).toBeNull();
    expect(row?.source.squadronVerified).toBe(false);
  });
});

describe('what the verified badge means', () => {
  it('MANDATORY: a proven NAME alone is not verified', async () => {
    /*
     * ★ THE WHOLE POINT OF THE SECOND CHECK ★
     *
     * Proving you control a commander name proves you control that Inara
     * account. It says nothing about whether you fly with THIS squadron, which
     * is the only question a squadron roster is asking.
     */
    const { store } = storeReturning([
      userRow({
        cmdrVerifications: [
          { cmdrName: 'PEBBLEMERCAHNT', squadronVerifiedAt: null, inaraSquadron: null },
        ],
      }),
    ]);
    const [row] = await store.roster();

    expect(row?.source.cmdrName).toBe('PEBBLEMERCAHNT');
    expect(row?.source.squadronVerified).toBe(false);
  });

  it('MANDATORY: a name in a DIFFERENT squadron is not verified', async () => {
    // Recorded verbatim so a member can be told which squadron Inara found,
    // rather than a bare "no" — but it is emphatically not a pass.
    const { store } = storeReturning([
      userRow({
        cmdrVerifications: [
          { cmdrName: 'PEBBLEMERCAHNT', squadronVerifiedAt: null, inaraSquadron: 'Some Other Squad' },
        ],
      }),
    ]);
    const [row] = await store.roster();

    expect(row?.source.squadronVerified).toBe(false);
  });

  it('verified once Inara confirms both halves', async () => {
    const { store } = storeReturning([
      userRow({
        cmdrVerifications: [
          {
            cmdrName: 'PEBBLEMERCAHNT',
            squadronVerifiedAt: new Date('2026-07-29T00:15:00Z'),
            inaraSquadron: "Grim's Squad",
          },
        ],
      }),
    ]);
    const [row] = await store.roster();

    expect(row?.source.squadronVerified).toBe(true);
  });

  it('MANDATORY: somebody who left the squadron loses the badge', async () => {
    /*
     * `squadronVerifiedAt` is CLEARED when the nightly sweep finds they are no
     * longer in the squadron, so this is the state a former member lands in.
     * Reading the name alone would leave them permanently verified.
     */
    const { store } = storeReturning([
      userRow({
        cmdrVerifications: [
          { cmdrName: 'PEBBLEMERCAHNT', squadronVerifiedAt: null, inaraSquadron: "Grim's Squad" },
        ],
      }),
    ]);
    const [row] = await store.roster();

    expect(row?.source.squadronVerified).toBe(false);
  });
});

/**
 * The SECOND badge: what Frontier says.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "add a badge to the Roster page per user that shows Frontier Verified too
 * please like we have for Inara verified"
 *
 * ★ IT IS A DIFFERENT CLAIM FROM THE ONE ABOVE, AND SMALLER ★
 *
 * Inara's badge asserts two things: this commander name, and this squadron.
 * Frontier's asserts ONE — the member signed in to Frontier and Frontier told us
 * which commander they are. That is the strongest identity proof on the platform
 * (trust tier 3, cryptographic, no third party in the middle) and it says
 * NOTHING about squadron membership. Squadron verification via cAPI was dropped,
 * so nothing here may imply it.
 *
 * ★ WHY IT CANNOT RIDE ALONG ON THE RELATION ABOVE ★
 *
 * Two reasons, and each alone is enough.
 *
 *   1. `isVerified` IS NEVER SET ON A cAPI ROW. Grep the tree: every writer of
 *      `isVerified: true` is on the Inara or officer-manual path. `CapiService`
 *      creates its row with `method: 'fdev_capi'`, `trustTier: 3` and the column
 *      at its default of FALSE, and `identify()` only ever writes `cmdrName`
 *      afterwards. So the roster's `cmdrVerifications` select — which filters
 *      `isVerified: true`, deliberately and load-bearingly — matches no cAPI row
 *      that has ever existed. Reusing it would have produced a badge that is
 *      dark for the entire squadron with nothing to explain why.
 *
 *   2. Even if it did, that select takes ONE row ordered by `verifiedAt desc`.
 *      A member can hold an Inara row AND a Frontier row, and whichever was
 *      touched last would decide both badges — so linking Frontier would put out
 *      the Inara badge, and an Inara re-check would put out the Frontier one.
 *
 * So it is its own query, with its own predicate, filtered in SQL for the same
 * reason the block above is: a filter applied in JavaScript still drags every
 * row into the process, and the next person to add a field has to know to
 * re-apply it.
 */
describe('what the Frontier badge means', () => {
  it('MANDATORY: asks the database for a LIVE, NAMED cAPI grant', async () => {
    /*
     * Asserted on the QUERY, exactly as the Inara block does, and for the same
     * reason. Two parts of this are easy to get wrong and impossible to see:
     *
     *   `cmdrName: { not: '' }` — the row is created the moment a member
     *   authorises, with an EMPTY name, and the name arrives from a separate
     *   profile call. Empty means linked-but-not-yet-identified: we hold tokens
     *   for somebody and do not yet know who they are, which is not a
     *   verification of anything.
     *
     *   `revokedAt: null` — a superseded claim is kept as a record, never
     *   deleted, and a revoked row must not vouch for anybody.
     */
    const { store, frontier } = storeReturning([userRow()]);
    await store.roster();

    expect(frontier.where).toEqual({
      userId: { in: ['u1'] },
      method: 'fdev_capi',
      revokedAt: null,
      cmdrName: { not: '' },
    });
  });

  it('MANDATORY: does NOT filter on isVerified, which nothing on this path sets', async () => {
    /*
     * ★ THE TRAP ★
     *
     * `isVerified: true` is the correct filter for the Inara relation and it is
     * pinned by a test above, so copying it here looks like consistency. It
     * would in fact have switched the whole feature off: `CapiService` writes
     * the column at its default of false and never returns to it.
     *
     * Pinned as its own assertion because the failure is silent — every member
     * would simply read "not verified", which is a plausible state.
     */
    const { store, frontier } = storeReturning([userRow()]);
    await store.roster();

    expect(frontier.where).not.toHaveProperty('isVerified');
  });

  it('verified when Frontier has named them and the grant is live', async () => {
    const { store } = storeReturning([userRow()], [capiRow()]);
    const [row] = await store.roster();

    expect(row?.source.frontierVerification).toBe('verified');
  });

  it('MANDATORY: a member with no Frontier link at all is not verified', async () => {
    // The majority, today. `none` rather than `expired`: they have not lapsed,
    // they have not started, and telling them to reconnect something they never
    // connected would send them looking for a button that does not apply.
    const { store } = storeReturning([userRow()], []);
    const [row] = await store.roster();

    expect(row?.source.frontierVerification).toBe('none');
  });

  it('MANDATORY: a dead grant reads as EXPIRED, never as verified', async () => {
    /*
     * `isStale` is written when a refresh fails permanently — the member
     * withdrew consent at Frontier, or the chain broke. Whatever the cause, we
     * can no longer ask Frontier anything about them, and a badge that still
     * said "verified" would be the platform vouching for something it cannot
     * check.
     */
    const { store } = storeReturning([userRow()], [capiRow({ isStale: true })]);
    const [row] = await store.roster();

    expect(row?.source.frontierVerification).toBe('expired');
  });

  it('MANDATORY: past the 25-day ceiling is expired even when NOTHING marked the row', async () => {
    /*
     * ★ THE HOLE THIS CLOSES ★
     *
     * `isStale` is written LAZILY, by whoever next tries to use the token. A
     * member nothing has polled — because the worker was down, because their
     * adaptive poll is on the 30-minute idle cadence, because they have never
     * played — sails past Frontier's hard 25-day ceiling with the column still
     * false. Trusting the column alone would have shown a badge whose proof
     * expired days ago.
     *
     * So the badge reads the SAME CLOCK the token refresher reads —
     * `tokenState`, from `@grims/ed-clients` — rather than owning a second
     * opinion about when 25 days is up. There is exactly one definition of that
     * ceiling and this is not a second one.
     */
    const { store } = storeReturning([userRow()], [capiRow({ verifiedAt: daysAgo(26) })]);
    const [row] = await store.roster();

    expect(row?.source.frontierVerification).toBe('expired');
  });

  it('MANDATORY: the NEWEST grant decides', async () => {
    /*
     * One live row per member is what `CapiService` maintains, but nothing in
     * the schema enforces it and a raced double-authorisation would leave two.
     * The newest is the one the member actually completed, so it wins — the same
     * rule the Inara relation applies with `orderBy: verifiedAt desc, take 1`.
     *
     * Ordered ASCENDING and written into the map in order, so the last write is
     * the newest. Getting this backwards would let an abandoned grant from three
     * weeks ago black out a link made this morning.
     */
    const { store } = storeReturning(
      [userRow()],
      [capiRow({ verifiedAt: daysAgo(26), isStale: true }), capiRow({ verifiedAt: daysAgo(1) })],
    );
    const [row] = await store.roster();

    expect(row?.source.frontierVerification).toBe('verified');
  });
});
