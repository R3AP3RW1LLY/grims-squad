import type { HubCall } from './hub-colony.js';
import type { LeaderboardKey } from '@grims/shared';

/**
 * The leaderboards, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "make a new category called leaderboards ... make this work like the other ones too" — and the
 * standing rule that the app mirrors the website. Same shapes the website reads, off the
 * companion's own device-token door, so the two surfaces cannot disagree about who is winning.
 *
 * ★ ONE REQUEST CARRIES ALL THREE BOARDS ★
 *
 * The device route answers every board at once — season, all-time and the member's own line — and
 * the caller names the one it wants drawn. Fetching per board would be three requests for one
 * response the hub has already assembled, and three chances for the boards to be from different
 * moments.
 */

export interface LeaderboardEntry {
  readonly handle: string;
  readonly displayName: string;
  readonly points: number;
  readonly claims: number;
}

/** The member's own line, which the tables above may not contain. Null before any points at all. */
export interface LeaderboardMe {
  readonly seasonPoints: number;
  readonly lifetimePoints: number;
  readonly seasonRank: number | null;
}

export interface LeaderboardBoard {
  readonly key: LeaderboardKey;
  readonly name: string;
  /** What the points measure, in the hub's own sentence — printed rather than paraphrased. */
  readonly measures: string;
  readonly season: LeaderboardEntry[];
  readonly allTime: LeaderboardEntry[];
  readonly me: LeaderboardMe | null;
}

export interface Leaderboards {
  readonly month: string;
  readonly boards: LeaderboardBoard[];
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One GET to the companion's leaderboard surface. Same failure-becomes-a-sentence contract as
 * `hubColony`, and the same reasons: the renderer draws whatever this returns, and a member needs
 * "not paired" told apart from "no connection".
 */
async function hubLeaderboards<T>(call: HubCall, path: string): Promise<Answer<T>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 15_000);

  try {
    const res = await doFetch(
      `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/leaderboards${path}`,
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

/**
 * One board, out of the hub's answer for all three.
 *
 * Picked here rather than in the renderer so the page receives exactly what it draws — the same
 * narrowing every other IPC surface does — and the month echo rides along so the season table can
 * say which month it is showing.
 */
export const leaderboardBoard = async (
  call: HubCall,
  board: LeaderboardKey,
  month?: string,
): Promise<Answer<{ month: string; board: LeaderboardBoard }>> => {
  const answer = await hubLeaderboards<Leaderboards>(
    call,
    month === undefined ? '' : `?month=${encodeURIComponent(month)}`,
  );
  if (!answer.ok) return answer;

  const found = (answer.data.boards ?? []).find((b) => b.key === board);
  // A missing board means the app and the hub disagree about what exists — a version gap, said so.
  if (found === undefined) {
    return { ok: false, error: 'The hub does not know that board yet. It may need an update.' };
  }
  return { ok: true, data: { month: answer.data.month, board: found } };
};
