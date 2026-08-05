import type { FitResult, OutfitPayload } from '@grims/ed-clients/builds';
import type { HubCall } from './hub-colony.js';

/**
 * The Shipyard, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "we need to add the Shipyard and Logistics and Trade categories to the companion app, and they
 * must work in full mirror with the website please!"
 *
 * Same endpoints as the website behind the device door, and — more importantly — the same maths:
 * the outfitter recomputes every figure client-side with @grims/ed-clients/builds, the identical
 * engine the website and the API run, over the identical catalogue adapter. The app cannot quote
 * a different jump range than the site because there is no second implementation to disagree.
 */

export interface ShipListEntry {
  readonly id: string;
  readonly name: string;
  readonly hullCost: number;
  /** 1 small, 2 medium, 3 large — the server's own encoding, verified against the live route. */
  readonly pad: number;
}

/** One row on the squadron or public board — the server's SharedBuildRow, verbatim. */
export interface BoardRow {
  readonly shipName: string;
  readonly buildName: string | null;
  readonly role: string | null;
  readonly stats: Record<string, unknown> | null;
  readonly visibility: 'private' | 'squadron' | 'public';
  readonly shareToken: string;
  readonly author: string | null;
  readonly updatedAt: string;
}

/** One row on the member's own shelf — the server's SavedBuildRow, verbatim. */
export interface ShelfRow {
  readonly id: string;
  readonly shipName: string;
  readonly buildName: string | null;
  readonly role: string | null;
  readonly stats: Record<string, unknown> | null;
  readonly visibility: 'private' | 'squadron' | 'public';
  readonly shareToken: string | null;
  readonly updatedAt: string;
}

/** One opened build — the server's SharedBuild, verbatim. The reader recomputes its figures. */
export interface OpenedBuild {
  readonly shipId: string;
  readonly shipName: string;
  readonly buildName: string | null;
  readonly build: Record<string, unknown>;
  readonly stats: Record<string, unknown> | null;
  readonly role: string | null;
  readonly author: string | null;
  readonly visibility: 'private' | 'squadron' | 'public';
  readonly updatedAt: string;
}



type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One request to the shipyard door. GET and POST share the core because the failure sentences
 * must not drift between them — same contract as every other hub reader in this app.
 */
async function shipyardCall<T>(
  call: HubCall,
  path: string,
  body?: unknown,
): Promise<Answer<T>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  // The outfit payload is a few hundred KB of catalogue; give it room on a slow line.
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 30_000);

  try {
    const res = await doFetch(
      `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/shipyard${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${call.deviceToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: ac.signal,
      },
    );

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

export const shipyardShips = (call: HubCall): Promise<Answer<{ ships: ShipListEntry[] }>> =>
  shipyardCall(call, '/ships');

export const shipyardOutfit = (
  call: HubCall,
  shipId: string,
): Promise<Answer<OutfitPayload>> =>
  shipyardCall(call, `/outfit/${encodeURIComponent(shipId)}`);

export const shipyardFit = (
  call: HubCall,
  body: { role: string; budget?: number; shipId?: string },
): Promise<Answer<FitResult>> => shipyardCall(call, '/fit', body);

export const shipyardBuilds = (
  call: HubCall,
  scope: 'mine' | 'squadron' | 'public',
): Promise<Answer<{ builds: (BoardRow | ShelfRow)[] }>> =>
  shipyardCall(call, `/builds?scope=${scope}`);

export const shipyardBuild = (
  call: HubCall,
  token: string,
): Promise<Answer<OpenedBuild>> => shipyardCall(call, `/builds/shared/${encodeURIComponent(token)}`);

export const shipyardSave = (
  call: HubCall,
  body: { build: unknown; buildName: string | null; visibility: string },
): Promise<Answer<{ id: string; shareToken: string | null; visibility: string }>> =>
  shipyardCall(call, '/builds', body);
