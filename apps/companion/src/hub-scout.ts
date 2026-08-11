import type { HubCall } from './hub-colony.js';

/**
 * Scouting, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool into our web and companion app that literally does what we just did here for
 * this planning and research and system selection?"
 *
 * ★ THE APP IS WHERE THE ANSWER IS NEEDED ★
 *
 * A commander decides where to claim while sitting in the system looking at it. Alt-tabbing to a
 * website to find out whether it can be claimed at all, and from which station, is the friction
 * that stops the tool being used at the moment it matters.
 *
 * Same shapes the website reads, off the same device-token door.
 */

export interface ScoutPermit {
  readonly system: string;
  readonly allegiance: string | null;
  readonly controllingFaction: string | null;
  readonly stationCount: number;
}

export interface ScoutCandidate {
  readonly system: string;
  readonly bodyCount: number;
  readonly landableCount: number;
  readonly nearestLandableLs: number | null;
  readonly surveyed: boolean;
  readonly pristine: boolean;
  readonly permit: ScoutPermit | null;
  readonly permitLy: number | null;
  readonly score: number;
  /** Every term that made the score, heaviest first. Optional: an older hub does not send it. */
  readonly reasons?: ReadonlyArray<{ readonly points: number; readonly text: string }>;
}

export interface ScoutResult {
  readonly anchor: { system: string; allegiance: string | null; controllingFaction: string | null } | null;
  readonly candidates: readonly ScoutCandidate[];
  readonly consideredSystems: number;
  readonly permitSources: number;
  readonly unknownAnchor: string | null;
}

export interface SurveyedBody {
  readonly bodyId: number;
  readonly name: string;
  readonly subType: string | null;
  readonly landable: boolean;
  readonly distanceLs: number | null;
  readonly gravity: number | null;
  readonly hasRings: boolean;
  readonly orbitalSlots: number | null;
  readonly surfaceSlots: number | null;
}

export interface SystemSurvey {
  readonly system: string;
  readonly bodyCount: number | null;
  readonly bodies: readonly SurveyedBody[];
  readonly landableCount: number;
  readonly nearestLandableLs: number | null;
  readonly ringedCount: number;
  readonly hasSlotData: boolean;
  readonly notFound?: string;
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One call to the companion's colonisation surface.
 *
 * The same failure-becomes-a-sentence contract as every other hub client here: the renderer draws
 * whatever comes back, and a member needs "not paired" told apart from "no connection".
 */
async function call<T>(hub: HubCall, path: string): Promise<Answer<T>> {
  if (hub.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = hub.fetchImpl ?? fetch;
  const ac = new AbortController();
  // Longer than the usual fifteen: a scout sweep queries the galaxy and a survey may fetch bodies.
  const timer = setTimeout(() => ac.abort(), hub.timeoutMs ?? 45_000);

  try {
    const res = await doFetch(
      `${hub.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/colonisation${path}`,
      { method: 'GET', headers: { authorization: `Bearer ${hub.deviceToken}` }, signal: ac.signal },
    );

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (res.status === 404) {
      // Cloaked by design (INV-002) — do not translate it into "you are not allowed".
      return { ok: false, error: 'Colonisation is not available on your account.' };
    }
    if (!res.ok) {
      const parsed = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: parsed?.error?.message ?? `The hub answered ${res.status}.` };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: 'Could not reach the hub.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Claimable systems around an anchor. `prefer` extends that power. */
export function scoutSystems(
  hub: HubCall,
  anchor: string,
  opts: { range?: string; prefer?: string } = {},
): Promise<Answer<ScoutResult>> {
  const q = new URLSearchParams({ anchor });
  if (opts.range !== undefined && opts.range !== '') q.set('range', opts.range);
  if (opts.prefer !== undefined && opts.prefer !== '') q.set('prefer', opts.prefer);
  return call<ScoutResult>(hub, `/scout?${q.toString()}`);
}

/** A proper look at one candidate — bodies, landability, arrival distances. */
export function surveySystem(hub: HubCall, system: string): Promise<Answer<SystemSurvey>> {
  return call<SystemSurvey>(hub, `/survey?system=${encodeURIComponent(system)}`);
}
