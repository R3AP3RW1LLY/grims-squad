import type { HubCall } from './hub-colony.js';

/**
 * Mining, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "this should be available in our companion app ... this must meet / exceed ED tools as it works
 * currently!"
 *
 * ★ THE TWO ANSWERS THE APP CANNOT WORK OUT FOR ITSELF ★
 *
 * The overlays already do everything a local mining tool does — read the rock, count the tonnes,
 * score the session — from the journal on this machine. These are the two questions that need
 * something bigger than one commander: what a hold is worth (eighteen million market rows) and
 * which rings are paying (every member's limpets). Both are the hub's to answer.
 *
 * Same shapes the website reads, off the same device-token door, so the two surfaces cannot
 * disagree.
 */

/** One ring, measured across everybody who has prospected in it. */
export interface MiningRing {
  readonly system: string;
  readonly body: string;
  readonly rocks: number;
  /** Share of rocks whose best material cleared the squadron-wide bar, as a percentage. */
  readonly hitRate: number;
  readonly bestPercent: number;
  readonly topMaterial: string;
  readonly lastSeen: string;
}

/** One mining evening. */
export interface MiningSession {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly system: string | null;
  readonly ring: string | null;
  readonly rocks: number;
  readonly hits: number;
  readonly tonnes: number;
  readonly points: number;
}

/** Where to take the hold, and what that one landing pays. */
export interface BestSale {
  readonly station: string;
  readonly system: string;
  readonly distanceLy: number | null;
  readonly total: number;
  readonly perTonne: number;
}

export interface HoldValue {
  readonly value: number;
  readonly bestSale: BestSale | null;
  readonly unpriced: string[];
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One call to the companion's mining surface.
 *
 * The same failure-becomes-a-sentence contract as `hubColony` and `hubLeaderboards`, and the same
 * reason: the renderer draws whatever this returns, and a member needs "not paired" told apart from
 * "no connection".
 */
async function hubMining<T>(
  call: HubCall,
  path: string,
  body?: unknown,
): Promise<Answer<T>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 15_000);

  try {
    const headers: Record<string, string> = { authorization: `Bearer ${call.deviceToken}` };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const init: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      signal: ac.signal,
    };
    // Assigned only when there is one: a GET carrying an explicit `body: undefined` is still a
    // GET with a body field, and some fetch implementations object to that.
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await doFetch(`${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/mining${path}`, init);

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (!res.ok) {
      const parsed = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: parsed?.error?.message ?? `The hub answered ${res.status}.` };
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

export const miningRings = (
  call: HubCall,
  material?: string,
  days = 14,
): Promise<Answer<{ rings: MiningRing[] }>> =>
  hubMining(
    call,
    `/rings?days=${days}${material === undefined || material === '' ? '' : `&material=${encodeURIComponent(material)}`}`,
  );

export const miningSessions = (call: HubCall): Promise<Answer<{ sessions: MiningSession[] }>> =>
  hubMining(call, '/sessions');

/**
 * What the hold is worth, and where to take it.
 *
 * The hold travels in the request rather than being read from telemetry, because the overlay knows
 * it FIRST — it is folded from the journal on this machine as the refinery works, seconds before
 * the upload carries it anywhere. Waiting for the round trip would put the refinery panel a batch
 * behind the game.
 */
export const miningValuation = (
  call: HubCall,
  hold: Readonly<Record<string, number>>,
  system: string | null,
  withinLy = 100,
): Promise<Answer<HoldValue>> => hubMining(call, '/valuation', { hold, system, withinLy });
