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
  /*
   * The CLOSE path runs through `completeColonyProject` on the PLAIN client now — the same
   * guarded transition the sync's auto-close uses, so all four ways a build can end announce it
   * from one place. `updateMany` is that guard; its count reports whether the row moved, and the
   * personal + squadron notices below only fire when it says 1.
   */
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const personal = vi.fn().mockResolvedValue({ count: 1 });
  const feed = vi.fn().mockResolvedValue({});

  const bound = {
    colonyProject: {
      findFirst: vi.fn().mockResolvedValue(project),
      update,
      delete: del,
    },
  };

  const db = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ n: BigInt(ledgerRows) }]),
    colonyProject: {
      updateMany,
      findUnique: vi.fn().mockResolvedValue({
        title: 'Forge at Alrai',
        systemName: 'Alrai',
        stationName: null,
        visibility: 'squadron',
        postedById: 'the-poster',
      }),
    },
    colonyMember: { findMany: vi.fn().mockResolvedValue([]) },
    currentBuild: { findMany: vi.fn().mockResolvedValue([]) },
    notification: { createMany: personal },
    squadronActivity: { create: feed },
  } as unknown as ConstructorParameters<typeof ColonyService>[0];

  const acl = {
    forSystem: () => bound,
    forCaller: async () => bound,
  } as unknown as ConstructorParameters<typeof ColonyService>[2];

  const market = {} as MarketStore;

  // (db, market, acl) — the order the service declares.
  return { service: new ColonyService(db, market, acl), update, updateMany, personal, feed, del };
}

const SQUADRON = { owner: 'squadron', postedById: 'someone-else' };
const PERSONAL = { owner: 'personal', postedById: 'the-poster' };

describe('closing a project', () => {
  it('lets an officer close the squadron’s build', async () => {
    const { service, updateMany } = serviceFor(SQUADRON, 0);
    await service.close('p1', 'an-officer', MANAGE);

    // Priority is cleared with it, and the guard demands a still-open row — the transition
    // happening once is what keeps the completion announced once across all four close paths.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ completedAt: null }),
        data: expect.objectContaining({ isPriority: false }),
      }),
    );
  });

  it('refuses a member without COLONY_MANAGE on a squadron build', async () => {
    const { service, updateMany } = serviceFor(SQUADRON, 0);
    await expect(service.close('p1', 'a-member', NONE)).rejects.toBeInstanceOf(AppError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('lets the poster close their own build with no permission at all', async () => {
    const { service, updateMany } = serviceFor(PERSONAL, 0);
    await service.close('p1', 'the-poster', NONE);
    expect(updateMany).toHaveBeenCalled();
  });

  it('refuses an OFFICER on somebody else’s personal build', async () => {
    /*
     * The one that is easy to get wrong. Rank does not make a member's own construction site the
     * squadron's business — and an officer who could close it would be able to end somebody's
     * project from a board they were only tidying.
     */
    const { service, updateMany } = serviceFor(PERSONAL, 0);
    await expect(service.close('p1', 'an-officer', MANAGE)).rejects.toBeInstanceOf(AppError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('announces a close once — to the people on the build, and to the squadron feed', async () => {
    const { service, personal, feed } = serviceFor(PERSONAL, 0);
    await service.close('p1', 'the-poster', NONE);

    // The poster's personal row lands, and the shared feed carries the completion once.
    expect(personal).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'colony.project-completed' }),
      }),
    );
  });

  it('says nothing when the row was already closed — the guard reported no transition', async () => {
    /*
     * Four paths can end a build (two worker passes, the API's per-upload pass, and this route).
     * The guarded update's count is the whole dedupe story: whichever path loses the race finds
     * zero rows and must stay silent, or the squadron hears one completion four times.
     */
    const { service, updateMany, personal, feed } = serviceFor(PERSONAL, 0);
    updateMany.mockResolvedValue({ count: 0 });

    await service.close('p1', 'the-poster', NONE);

    expect(personal).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
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
