import type { HubCall } from './hub-colony.js';

/**
 * The operations board, read from the hub.
 *
 * ★ COMMITTING FROM THE COCKPIT IS THE POINT ★
 *
 * An op is announced while people are already flying. A member who has to alt-tab to a website to
 * say they are coming is a member who says nothing — and the seat count is the whole mechanism, so
 * a board nobody commits to is indistinguishable from a board with nothing on it.
 */

export type SignupState = 'yes' | 'maybe' | 'no' | 'standby';

export interface OpRow {
  readonly id: string;
  readonly title: string;
  readonly opType: string;
  readonly startsAt: string;
  readonly status: string;
  readonly capacity: number | null;
  readonly going: number;
  readonly standby: number;
  readonly createdBy: string;
  /** What THIS member said, so the app never invites somebody to a thing they are on. */
  readonly mine: SignupState | null;
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(hub: HubCall, path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown): Promise<Answer<T>> {
  if (hub.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = hub.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), hub.timeoutMs ?? 15_000);

  try {
    const headers: Record<string, string> = { authorization: `Bearer ${hub.deviceToken}` };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const init: RequestInit = { method, headers, signal: ac.signal };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await doFetch(`${hub.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/ops${path}`, init);

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
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

export function opsBoard(hub: HubCall): Promise<Answer<{ ops: OpRow[] }>> {
  return call<{ ops: OpRow[] }>(hub, '');
}

/** Say whether you are coming. Capacity decides whether "yes" seats you or queues you. */
export function opsSignUp(hub: HubCall, id: string, state: 'yes' | 'maybe' | 'no'): Promise<Answer<{ ok: true }>> {
  return call<{ ok: true }>(hub, `/${encodeURIComponent(id)}/signup`, 'POST', { state });
}

export function opsWithdraw(hub: HubCall, id: string): Promise<Answer<{ ok: true }>> {
  return call<{ ok: true }>(hub, `/${encodeURIComponent(id)}/signup`, 'DELETE');
}
