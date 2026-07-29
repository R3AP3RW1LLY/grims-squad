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

function storeReturning(rows: Array<Record<string, unknown>>): {
  store: PrismaMembersStore;
  captured: Captured;
} {
  const captured: Captured = {};
  const db = {
    user: {
      findMany: async (args: Captured) => {
        Object.assign(captured, args);
        return rows;
      },
    },
  } as unknown as PrismaClient;

  return { store: new PrismaMembersStore(db), captured };
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
