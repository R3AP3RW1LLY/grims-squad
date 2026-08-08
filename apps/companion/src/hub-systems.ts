import type { SystemChoice } from '@grims/shared/system-picker';

/**
 * A member's saved systems, for the app.
 *
 * ★ THE SAME LIST AS THE WEBSITE, DELIBERATELY ★
 *
 * The squadron owner asked for saved systems "any where that asks to enter a system", and there are
 * fourteen such boxes — seven on the site, seven here. If the app kept its own store the feature
 * would be worse than the plain text fields it replaces: somebody would pin a system in the browser,
 * not find it on the second monitor, and stop trusting the star.
 *
 * So this talks to the same table and the same service. Only the door differs: a paired device
 * rather than a browser session.
 */

export interface HubCall {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One call to the companion's systems surface.
 *
 * The same failure-becomes-a-sentence contract as every other hub client: the renderer draws
 * whatever comes back, and a member needs "not paired" told apart from "no connection".
 */
async function call<T>(
  hub: HubCall,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Answer<T>> {
  if (hub.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = hub.fetchImpl ?? fetch;
  const ac = new AbortController();
  // Short: this feeds a dropdown, and a dropdown that hangs is worse than one that is empty.
  const timer = setTimeout(() => ac.abort(), hub.timeoutMs ?? 10_000);

  try {
    const headers: Record<string, string> = { authorization: `Bearer ${hub.deviceToken}` };
    if (init?.body !== undefined) headers['content-type'] = 'application/json';

    const res = await doFetch(`${hub.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/systems${path}`, {
      method: init?.method ?? 'GET',
      headers,
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: ac.signal,
    });

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (!res.ok) {
      const parsed = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: parsed?.error?.message ?? `The hub answered ${res.status}.` };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: aborted ? 'The hub took too long to answer.' : 'Could not reach the hub.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Pins and recents together — the renderer ranks them with the shared `rankSystemChoices`. */
export async function fetchSavedSystems(hub: HubCall): Promise<Answer<SystemChoice[]>> {
  const r = await call<{ systems: SystemChoice[] }>(hub, '');
  return r.ok ? { ok: true, data: r.data.systems ?? [] } : r;
}

/**
 * Record a system a member actually searched with.
 *
 * The renderer ignores the answer on purpose: remembering a system must never be able to fail a
 * search that otherwise worked.
 */
export async function recordSystemUsed(
  hub: HubCall,
  system: string,
  systemId64?: string | null,
): Promise<void> {
  await call(hub, '/use', {
    method: 'POST',
    body: { system, ...(systemId64 == null ? {} : { systemId64 }) },
  });
}

export async function pinSystem(hub: HubCall, system: string, label?: string | null): Promise<void> {
  await call(hub, '/pin', { method: 'POST', body: { system, ...(label == null ? {} : { label }) } });
}

export async function unpinSystem(hub: HubCall, system: string): Promise<void> {
  await call(hub, `/pin?system=${encodeURIComponent(system)}`, { method: 'DELETE' });
}
