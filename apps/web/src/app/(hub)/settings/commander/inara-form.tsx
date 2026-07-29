'use client';

import { useState } from 'react';
import { apiCall } from '../../../../lib/api-client';
import { useVerification } from './verification-state';
import type { InaraStatus } from '../../../../lib/api';

export type { InaraStatus };

/*
 * ★ ONE TYPE, RE-EXPORTED — NOT A SECOND COPY ★
 *
 * This file declared its own `InaraStatus` alongside the one in lib/api.ts, and
 * they drifted the moment squadron fields were added to one of them: the form
 * compiled, the page did not, and the page is the file that reads the API. Two
 * descriptions of one response is the bug, not either description.
 */

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
export function InaraForm() {
  // Shared with the status panel above, which is what makes verifying here
  // change the headline up there without a reload. See verification-state.tsx.
  const { status, setStatus } = useVerification();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function link() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiCall<{ cmdrName: string; verified: boolean }>('POST', '/v1/me/inara', {
        body: { apiKey: key, source: 'web' },
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
      const r = await apiCall<{ cmdrName: string; error: string | null }>(
        'POST',
        '/v1/me/inara/refresh',
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
      await apiCall('DELETE', '/v1/me/inara');
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

      {/*
        ★ THE VERIFIED NAME IS NOT SHOWN HERE ★

        This block announced "Verified commander / CMDR X" a second time,
        directly beneath the panel that already says it. Three boxes on one page
        claimed the same fact, and one of them called somebody VERIFIED on the
        strength of the name alone while another said partially verified.

        `SquadronStatus` owns every verification state now, from unverified
        through to verified. This form owns the KEY — adding it, re-checking it,
        removing it — and nothing else.

        The last error stays, because it is about the key rather than about the
        verification, and it is the only place that reports it.
      */}
      {status.lastError !== null && (
        <p className="mb-6 rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]">
          {status.lastError}
        </p>
      )}

      {status.linked ? (
        /*
          ★ ITS OWN PANEL, MATCHING THE STATUS BOX ABOVE ★

          This was a bare sentence with two buttons under it, floating on the
          page directly beneath a bordered panel — so the page read as one
          designed box followed by loose text, and "Remove key" sat in open
          space with nothing to say it belonged to anything.

          Boxed, with the key rendered as a masked field. A key on file is a
          THING a member has, and drawing it as one makes "we never show it
          back" self-evident rather than a promise in prose.
        */
        <section className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
              Inara API key
            </p>
            <span className="inline-flex items-center gap-2 rounded border border-[var(--color-semantic-success)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-semantic-success)]">
              <span aria-hidden="true">✓</span>
              On file
            </span>
          </div>

          {/*
            Dots, not the key. Deliberately a fixed length that is NOT the key's
            length — leaking how many characters it has would be a small gift to
            anybody guessing, for no benefit to the member, who cannot read it
            back either way.
          */}
          <p
            className="mt-4 select-none rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-4 py-2.5 font-mono text-sm tracking-[0.3em] text-[var(--color-text-dim)]"
            aria-label="Your Inara key is stored and hidden"
          >
            ••••••••••••••••••••
          </p>

          <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Encrypted before it was stored, and never shown again — not to you, not to an officer.
            {status.source === 'app' ? ' Added from the companion app.' : ''}
            {status.lastCheckedAt !== null && (
              <>
                {' '}Last checked{' '}
                {new Date(status.lastCheckedAt).toLocaleString('en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                .
              </>
            )}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--color-border-hairline)] pt-4">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)] disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Re-check now'}
            </button>
            {/*
              The destructive action is pushed to the far end and given no
              border until hover. Two buttons of equal weight side by side is
              how somebody removes a key they meant to re-check.
            */}
            <button
              type="button"
              onClick={() => void unlink()}
              disabled={busy}
              className="ml-auto rounded px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-semantic-hostile-bright)] disabled:opacity-50"
            >
              Remove key
            </button>
          </div>
        </section>
      ) : (
        <>
          <label htmlFor="inara-key" className="block text-[var(--color-text-primary)]">
            Inara API key
          </label>
          <p id="inara-help" className="mt-2 max-w-[70ch] text-sm text-[var(--color-text-secondary)]">
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
