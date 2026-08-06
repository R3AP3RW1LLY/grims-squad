import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { LeaderboardsService } from './leaderboards.service.js';

/**
 * The leaderboards service, against a scripted client.
 *
 * The SQL itself is proven against a real Postgres in `leaderboards.int.spec.ts` — a mocked
 * client cannot reject a grouping mistake. What a mock CAN prove is everything around the
 * queries: the month key being refused rather than guessed at, snake_case rows becoming the
 * wire shape, the rank arithmetic, and unknown badge keys being skipped instead of rendered
 * as holes.
 */

/** A client whose raw reads are scripted per call, in the order the service makes them. */
function scripted(
  raws: Array<Array<Record<string, unknown>>>,
  badges: Array<{ userId?: string; badgeKey: string; earnedAt?: Date }> = [],
): PrismaClient {
  let call = 0;
  return {
    $queryRawUnsafe: async () => raws[call++] ?? [],
    memberBadge: {
      findMany: async () => badges,
    },
  } as unknown as PrismaClient;
}

describe('the month key', () => {
  it('refuses anything that is not YYYY-MM, rather than guessing', async () => {
    const svc = new LeaderboardsService(scripted([]));
    // A wrong leaderboard that looks right is the worst of the options.
    expect(await svc.standings('garbage', null)).toBeNull();
    expect(await svc.standings('2026-13', null)).toBeNull();
    expect(await svc.standings('2026-0', null)).toBeNull();
    expect(await svc.standings('26-08', null)).toBeNull();
  });

  it('echoes the accepted month back, so the page states which season it shows', async () => {
    const svc = new LeaderboardsService(scripted([[], [], [], [], [], []]));
    const out = await svc.standings('2026-08', null);
    expect(out?.month).toBe('2026-08');
  });
});

describe('the standings shape', () => {
  it('carries all four boards, named from the shared catalogue', async () => {
    // Eight reads for a guest: (season, allTime) x four boards. Deep Core joined 2026-08-06.
    const svc = new LeaderboardsService(scripted([[], [], [], [], [], [], [], []]));
    const out = await svc.standings('2026-08', null);

    expect(out?.boards.map((b) => b.key)).toEqual(['bounties', 'colony', 'trade', 'mining']);
    // Name and measures ride with each board so the page never keeps its own copy of either.
    for (const board of out?.boards ?? []) {
      expect(board.name).not.toBe('');
      expect(board.measures).not.toBe('');
    }
  });

  it('shapes snake_case rows into wire entries', async () => {
    const row = { handle: 'grim', display_name: 'Grim', points: 1200, claims: 4 };
    // Eight reads for a guest: (season, allTime) x four boards.
    const svc = new LeaderboardsService(scripted([[row], [], [], [], [], []]));

    const out = await svc.standings('2026-08', null);
    expect(out?.boards[0]?.season).toEqual([
      { handle: 'grim', displayName: 'Grim', points: 1200, claims: 4 },
    ]);
  });

  it('a guest gets me: null on every board — there is nobody to count', async () => {
    const svc = new LeaderboardsService(scripted([[], [], [], [], [], []]));
    const out = await svc.standings('2026-08', null);
    expect(out?.boards.every((b) => b.me === null)).toBe(true);
  });
});

describe('the caller’s own standing', () => {
  /** Nine reads for a member: (season, allTime, mine) per board; `mine` is every third. */
  function withMine(mine: { season: number; lifetime: number; ahead: number }): LeaderboardsService {
    return new LeaderboardsService(
      scripted([[], [], [mine], [], [], [mine], [], [], [mine]]),
    );
  }

  it('ranks as one plus the participants ahead', async () => {
    const svc = withMine({ season: 900, lifetime: 4100, ahead: 6 });
    const out = await svc.standings('2026-08', 'caller-id');
    expect(out?.boards[0]?.me).toEqual({
      seasonPoints: 900,
      lifetimePoints: 4100,
      seasonRank: 7,
    });
  });

  it('reports no rank at zero season points — "ranked 41st with nothing" is not worth sending', async () => {
    const svc = withMine({ season: 0, lifetime: 4100, ahead: 6 });
    const out = await svc.standings('2026-08', 'caller-id');
    expect(out?.boards[0]?.me?.seasonRank).toBeNull();
    // The lifetime figure still arrives: the member scored it, whatever this month looks like.
    expect(out?.boards[0]?.me?.lifetimePoints).toBe(4100);
  });
});

describe('badges', () => {
  it('resolves known keys through the shared catalogue and SKIPS retired ones', async () => {
    const earnedAt = new Date('2026-08-01T00:00:00Z');
    const svc = new LeaderboardsService(
      scripted(
        [],
        [
          { badgeKey: 'colony-bronze', earnedAt },
          // A key no catalogue owns any more. It must vanish, not render as a blank chip.
          { badgeKey: 'retired-nonsense', earnedAt },
        ],
      ),
    );

    const out = await svc.badgesOf('u-1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'colony-bronze', earnedAt: earnedAt.toISOString() });
    // Resolved to something drawable — the whole point of going through badgeDisplay.
    expect(out[0]?.icon).not.toBe('');
    expect(out[0]?.name).not.toBe('');
  });

  it('showcases at most the cap per member, rarest first', async () => {
    const svc = new LeaderboardsService(
      scripted(
        [],
        [
          { userId: 'u-1', badgeKey: 'colony-bronze' },
          { userId: 'u-1', badgeKey: 'colony-silver' },
          { userId: 'u-1', badgeKey: 'trade-bronze' },
          { userId: 'u-1', badgeKey: 'bounties-first-light' },
          { userId: 'u-1', badgeKey: 'colony-season-champion' },
          { userId: 'u-2', badgeKey: 'bounties-bronze' },
        ],
      ),
    );

    const out = await svc.showcaseFor(['u-1', 'u-2'], 3);

    // Highest tier PER BOARD first (silver shadows bronze), then champions — and the cap holds,
    // so the wire never carries a member's full trophy cabinet once per post.
    expect(out.get('u-1')).toEqual(['colony-silver', 'trade-bronze', 'colony-season-champion']);
    expect(out.get('u-2')).toEqual(['bounties-bronze']);
  });

  it('answers an empty author list without a query', async () => {
    // The scripted client would throw on any access; not reaching it is the assertion.
    const svc = new LeaderboardsService({} as unknown as PrismaClient);
    expect(await svc.showcaseFor([], 3)).toEqual(new Map());
  });
});
