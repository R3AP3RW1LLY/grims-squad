'use client';

import { useState } from 'react';
import { errorFromResponse } from '../../../lib/api-error';

export interface InaraStatus {
  linked: boolean;
  cmdrName: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  source: string | null;
}

function readCsrf(): string {
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': readCsrf() },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(path, init);
  if (!res.ok) {
    // The API answers with an ENVELOPE. Reading json.message off the top level
    // always yielded undefined and threw away the real reason.
    throw new Error((await errorFromResponse(res)).message);
  }
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * Linking an Inara API key.
 *
 * ★ THERE IS NO COMMANDER-NAME FIELD, AND THERE MUST NEVER BE ONE ★
 *
 * The name comes back from Inara. That is the whole difference between proving
 * a commander is yours and telling us it is — a text box here would turn this
 * into self-declaration while still displaying "verified".
 *
 * The key is write-only from the browser's point of view: it goes up, and the
 * server only ever tells us whether one EXISTS. Nothing re-populates the input.
 */
export function InaraForm({ initial }: { initial: InaraStatus }) {
  const [status, setStatus] = useState(initial);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function link() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await send<{ cmdrName: string; verified: boolean }>('/v1/me/inara', 'POST', {
        apiKey: key,
        source: 'web',
      });
      // Cleared immediately. There is no reason for a credential to sit in a
      // form field after it has been accepted.
      setKey('');
      setStatus({ ...status, linked: true, cmdrName: r.cmdrName, verifiedAt: new Date().toISOString(), lastError: null });
      setNotice(`Verified as CMDR ${r.cmdrName}. Your Discord nickname now matches.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await send<{ cmdrName: string; error: string | null }>(
        '/v1/me/inara/refresh',
        'POST',
      );
      setStatus({ ...status, cmdrName: r.cmdrName, lastError: r.error });
      setNotice(r.error ?? `Still CMDR ${r.cmdrName}. Nickname checked.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await send('/v1/me/inara', 'DELETE');
      setStatus({ ...status, linked: false, lastError: null, source: null });
      setNotice('Key removed. Your commander name stays verified.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      {error !== null && (
        <p
          role="alert"
          className="mb-6 rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="mb-6 rounded border border-[var(--color-brand-cyan-bright)] px-4 py-3 text-sm text-[var(--color-brand-cyan-bright)]">
          {notice}
        </p>
      )}

      {status.cmdrName !== null && (
        <div className="mb-8 rounded border border-[var(--color-border-hairline)] p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            Verified commander
          </p>
          <p
            className="mt-2 text-2xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            CMDR {status.cmdrName}
          </p>
          {status.lastError !== null && (
            <p className="mt-3 text-sm text-[var(--color-brand-orange)]">{status.lastError}</p>
          )}
        </div>
      )}

      {status.linked ? (
        <>
          <p className="text-[var(--color-text-primary)]">
            An Inara key is on file{status.source === 'app' ? ', added from the companion app' : ''}.
            We never show it back — not even to you.
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
            >
              Re-check now
            </button>
            <button
              type="button"
              onClick={() => void unlink()}
              disabled={busy}
              className="rounded border border-[var(--color-border-hairline)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-text-muted)] hover:border-[var(--color-brand-orange)] hover:text-[var(--color-brand-orange)] disabled:opacity-50"
            >
              Remove key
            </button>
          </div>
        </>
      ) : (
        <>
          <label htmlFor="inara-key" className="block text-[var(--color-text-primary)]">
            Inara API key
          </label>
          <p id="inara-help" className="mt-2 max-w-[70ch] text-sm text-[var(--color-text-muted)]">
            On Inara, open your profile menu &rarr; <strong>API keys</strong>, generate one, and
            paste it here. We use it only to ask Inara which commander the key belongs to.
          </p>
          <input
            id="inara-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
            autoComplete="off"
            aria-describedby="inara-help"
            className="mt-4 w-full max-w-md rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-4 py-2.5 font-mono text-sm text-[var(--color-text-primary)]"
          />
          <button
            type="button"
            onClick={() => void link()}
            disabled={busy || key.trim() === ''}
            className="mt-6 block rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-40"
          >
            Verify my commander
          </button>
        </>
      )}
    </div>
  );
}
