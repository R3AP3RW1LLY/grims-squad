import type { HubCall } from './hub-colony.js';

/**
 * Data Bounties, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * The board and the Data Runner leaderboard, mirrored into the app — the same full-parity rule
 * colonisation set: "must be a mirror!". Same shapes the website reads, off the companion's own
 * device-token door, so the two surfaces cannot disagree.
 *
 * The app is where bounties actually get PAID — the upload it sends when a member opens a market
 * screen is the claim — so the app is also where a runner most wants to see the board while
 * flying.
 */

export interface BountyRow {
  readonly stationKey: string;
  readonly stationName: string;
  readonly systemName: string;
  readonly stationType: string | null;
  readonly largePads: number | null;
  readonly lastSeenAt: string | null;
  /** Null means never seen at all — the biggest bounty there is. */
  readonly daysStale: number | null;
  readonly points: number;
  readonly jackpot: boolean;
  readonly distanceLy: number | null;
}

export interface RunnerTotals {
  readonly monthPoints: number;
  readonly monthClaims: number;
  readonly allTimePoints: number;
  readonly allTimeClaims: number;
}

export interface BountyBoard {
  readonly computedAt: string | null;
  readonly ops: BountyRow[];
  readonly galaxy: BountyRow[];
  readonly me: RunnerTotals;
}

export interface BountyLeaderboardEntry {
  readonly handle: string;
  readonly displayName: string;
  readonly points: number;
  readonly claims: number;
  readonly jackpots: number;
}

export interface BountyLeaderboard {
  readonly month: string;
  readonly season: BountyLeaderboardEntry[];
  readonly allTime: BountyLeaderboardEntry[];
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One GET to the companion's bounty surface. Same failure-becomes-a-sentence contract as
 * `hubColony`, and the same reasons: the renderer draws whatever this returns, and a member
 * needs "not paired" told apart from "no connection".
 */
async function hubBounties<T>(call: HubCall, path: string): Promise<Answer<T>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 15_000);

  try {
    const res = await doFetch(
      `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/bounties${path}`,
      {
        headers: { authorization: `Bearer ${call.deviceToken}` },
        signal: ac.signal,
      },
    );

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: body?.error?.message ?? `The hub answered ${res.status}.` };
    }

    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null) return { ok: false, error: 'The hub sent something we could not read.' };
    return { ok: true, data };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'The hub did not answer in time.'
        : 'Could not reach the hub. Check your connection.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export const bountyBoard = (call: HubCall): Promise<Answer<BountyBoard>> =>
  hubBounties<BountyBoard>(call, '');

export const bountyLeaderboard = (
  call: HubCall,
  month?: string,
): Promise<Answer<BountyLeaderboard>> =>
  hubBounties<BountyLeaderboard>(
    call,
    month === undefined ? '/leaderboard' : `/leaderboard?month=${encodeURIComponent(month)}`,
  );
