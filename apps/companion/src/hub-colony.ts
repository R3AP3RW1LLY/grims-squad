/**
 * Colonisation, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we want the entire colonization module to be visible in the companion app! people should be able
 * to have full interaction with colonization either from the website or from the app."
 *
 * ★ THE HUB IS THE RECORD, ALWAYS ★
 *
 * Nothing here is cached to disk and nothing is computed locally. A project's outstanding needs are
 * assembled from every member's journals, so this machine's view of them is always partial — and a
 * second copy that could disagree with the website is exactly the bug a member would report as "the
 * app says something different" and nobody could reproduce.
 *
 * The app is a window onto the hub. When the hub cannot be reached, it says so rather than showing
 * a stale answer with no date on it.
 */

export interface ColonyProject {
  readonly id: string;
  readonly owner: 'squadron' | 'personal';
  readonly title: string;
  readonly systemName: string;
  readonly stationName: string | null;
  readonly marketId: string;
  readonly notes: string | null;
  readonly isPriority: boolean;
  readonly completedAt: string | null;
  readonly postedBy: string | null;
  readonly remaining: number;
  readonly required: number;
  readonly needCount: number;
}

export interface ColonyNeed {
  readonly commodity: string;
  readonly remaining: number;
  readonly required: number | null;
}

export interface ColonyHauler {
  readonly name: string;
  readonly tonnes: number;
}

export interface ColonyShoppingRow {
  readonly commodity: string;
  readonly remaining: number;
  readonly stationName: string | null;
  readonly systemName: string | null;
  readonly price: number | null;
  readonly supply: number | null;
  readonly cost: number | null;
}

export interface ColonyRights {
  readonly post: boolean;
  readonly manage: boolean;
  readonly publish: boolean;
}

export interface HubCall {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One request to the companion's colonisation surface.
 *
 * ★ EVERY FAILURE BECOMES A SENTENCE, NOT AN EXCEPTION ★
 *
 * The renderer draws whatever this returns. A thrown error there is a blank panel with no
 * explanation — the member sees an empty screen and cannot tell "you are not allowed" from "your
 * internet is down", which are the two things they most need told apart.
 */
export async function hubColony<T>(
  call: HubCall,
  path: string,
  init?: { method: 'POST' | 'PATCH'; body: unknown },
): Promise<Answer<T>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 15_000);

  try {
    const res = await doFetch(`${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/colony${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${call.deviceToken}`,
        ...(init === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: ac.signal,
    });

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (res.status === 403) {
      /*
       * Distinguished from 401 on purpose. "Not paired" is fixed by pairing; "not allowed" is fixed
       * by an officer granting a permission. Telling a member to re-pair when the real answer is
       * that their rank cannot post projects sends them round a loop that cannot help.
       */
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        ok: false,
        error: body?.error?.message ?? 'Your rank does not have access to colonisation.',
      };
    }

    if (!res.ok) {
      // The hub's own message when it sent one — it is written for a member and is better than
      // anything this layer could invent from a status code.
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: body?.error?.message ?? `The hub answered ${res.status}.` };
    }

    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null) return { ok: false, error: 'The hub sent something we could not read.' };

    return { ok: true, data };
  } catch (error) {
    /*
     * Abort is the timeout, and it is worth naming: "the hub did not answer" tells a member to
     * check their connection, where a generic failure tells them nothing at all.
     */
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

export const colonyProjects = (
  call: HubCall,
): Promise<Answer<{ projects: ColonyProject[]; can: ColonyRights }>> =>
  hubColony(call, '/projects');

export const colonyProject = (
  call: HubCall,
  id: string,
): Promise<
  Answer<{
    project: ColonyProject;
    needs: ColonyNeed[];
    haulers: ColonyHauler[];
    shopping: ColonyShoppingRow[];
  }>
> => hubColony(call, `/projects/${encodeURIComponent(id)}`);

/** The project for the site the member is docked at, if the squadron holds one. */
export const colonyAtMarket = (
  call: HubCall,
  marketId: string,
): Promise<Answer<{ project: ColonyProject | null; needs: ColonyNeed[] }>> =>
  hubColony(call, `/at/${encodeURIComponent(marketId)}`);

export const postColonyProject = (
  call: HubCall,
  body: {
    owner: 'squadron' | 'personal';
    marketId: string;
    systemName: string;
    stationName: string;
    title: string;
    notes: string;
  },
): Promise<Answer<{ id: string }>> =>
  hubColony(call, '/projects', { method: 'POST', body });
