import { describe, expect, it, vi } from 'vitest';
import { AppError, Permission } from '@grims/shared';
import { ColonyService } from './colony.service.js';
import type { MarketStore } from './market.store.js';

/**
 * Closing, reopening and deleting a project.
 *
 * ★ WHAT IS ACTUALLY BEING GUARDED ★
 *
 * Not the happy paths — those are three Prisma updates. The two rules worth pinning are:
 *
 *   1. Whose build it is decides who may change it. A squadron project is the squadron's effort, so
 *      an officer directs it. A personal one belongs to whoever posted it, and an officer does NOT
 *      get to close somebody else's build just because they outrank them.
 *   2. Delete refuses once anybody has hauled. The ledger cascades, so a member tidying a board
 *      would silently erase a fortnight of other people's deliveries.
 */

/*
 * Read from the contract, never written as a literal here. I wrote `1n << 73n` first — that is
 * COLONY_SHARE_PUBLIC, and the test failed by refusing an officer who genuinely had the permission.
 * A hand-copied bit is a second source of truth that agrees right up until somebody renumbers.
 */
const MANAGE = Permission.COLONY_MANAGE;
const NONE = 0n;

function serviceFor(project: { owner: string; postedById: string }, ledgerRows: number) {
  const update = vi.fn().mockResolvedValue({});
  const del = vi.fn().mockResolvedValue({});

  const bound = {
    colonyProject: {
      findFirst: vi.fn().mockResolvedValue(project),
      update,
      delete: del,
    },
  };

  const db = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ n: BigInt(ledgerRows) }]),
  } as unknown as ConstructorParameters<typeof ColonyService>[0];

  const acl = {
    forSystem: () => bound,
    forCaller: async () => bound,
  } as unknown as ConstructorParameters<typeof ColonyService>[2];

  const market = {} as MarketStore;

  // (db, market, acl) — the order the service declares.
  return { service: new ColonyService(db, market, acl), update, del };
}

const SQUADRON = { owner: 'squadron', postedById: 'someone-else' };
const PERSONAL = { owner: 'personal', postedById: 'the-poster' };

describe('closing a project', () => {
  it('lets an officer close the squadron’s build', async () => {
    const { service, update } = serviceFor(SQUADRON, 0);
    await service.close('p1', 'an-officer', MANAGE);

    // Priority is cleared with it: a finished build must not keep pointing the squadron at itself.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPriority: false }) }),
    );
  });

  it('refuses a member without COLONY_MANAGE on a squadron build', async () => {
    const { service, update } = serviceFor(SQUADRON, 0);
    await expect(service.close('p1', 'a-member', NONE)).rejects.toBeInstanceOf(AppError);
    expect(update).not.toHaveBeenCalled();
  });

  it('lets the poster close their own build with no permission at all', async () => {
    const { service, update } = serviceFor(PERSONAL, 0);
    await service.close('p1', 'the-poster', NONE);
    expect(update).toHaveBeenCalled();
  });

  it('refuses an OFFICER on somebody else’s personal build', async () => {
    /*
     * The one that is easy to get wrong. Rank does not make a member's own construction site the
     * squadron's business — and an officer who could close it would be able to end somebody's
     * project from a board they were only tidying.
     */
    const { service, update } = serviceFor(PERSONAL, 0);
    await expect(service.close('p1', 'an-officer', MANAGE)).rejects.toBeInstanceOf(AppError);
    expect(update).not.toHaveBeenCalled();
  });

  it('reopens one closed by mistake', async () => {
    const { service, update } = serviceFor(PERSONAL, 0);
    await service.reopen('p1', 'the-poster', NONE);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completedAt: null } }),
    );
  });
});

describe('deleting a project', () => {
  it('deletes one nobody has hauled to', async () => {
    // The case delete exists for: a project posted against a mistyped market id, which will never
    // receive a depot reading and can only be fixed in SQL today.
    const { service, del } = serviceFor(PERSONAL, 0);
    await service.remove('p1', 'the-poster', NONE);
    expect(del).toHaveBeenCalled();
  });

  it('REFUSES once anybody has hauled, and says to close it instead', async () => {
    const { service, del } = serviceFor(PERSONAL, 6);

    await expect(service.remove('p1', 'the-poster', NONE)).rejects.toThrow(/close it instead/i);
    // The ledger cascades on delete. Somebody tidying a board must not be able to erase a
    // fortnight of other members' deliveries by pressing one button.
    expect(del).not.toHaveBeenCalled();
  });

  it('still refuses an officer on somebody else’s build before it even counts the ledger', async () => {
    const { service, del } = serviceFor(PERSONAL, 0);
    await expect(service.remove('p1', 'an-officer', MANAGE)).rejects.toBeInstanceOf(AppError);
    expect(del).not.toHaveBeenCalled();
  });
});
