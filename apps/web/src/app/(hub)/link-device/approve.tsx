'use client';

import { useState } from 'react';
import { apiPost } from '../../../lib/api-client';
import { CodeInput } from '../../../components/code-input';

/**
 * Approving a companion app.
 *
 * ★ THE MEMBER NEVER HANDLES A CREDENTIAL ★
 *
 * The old flow minted a token on the website, showed it once, and asked the member to copy it into
 * the app. This is the same decision — "let this app upload my journals" — with the credential
 * removed from the member's hands entirely: they confirm a code, and the app collects its own
 * token over a channel only it can read.
 *
 * ★ THE LABEL IS SHOWN BEFORE THE BUTTON ★
 *
 * "Approve this?" with nothing to look at is a prompt people click through. Naming the machine that
 * asked is what makes a request the member did NOT start visibly wrong — which is the only case
 * where this screen has any work to do.
 */
export function ApproveDevice({ code: initialCode, label }: { code: string; label: string | null }) {
  const [code, setCode] = useState(initialCode);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function approve(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ label: string }>(
        `/v1/telemetry/links/${encodeURIComponent(code)}/approve`,
        {},
        'That code could not be approved.',
      );
      setDone(r.label);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6 sm:p-8">
        <p className="text-lg text-[var(--color-brand-cyan-bright)]">{done} is connected.</p>
        <p className="mt-4 text-[var(--color-text-primary)]">
          Go back to the app — it has already picked this up. You can close this page.
        </p>
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          You can disconnect it at any time from{' '}
          <a href="/settings/devices" className="text-[var(--color-brand-cyan-bright)] underline underline-offset-4">
            your devices
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6 sm:p-8">
      {label === null ? (
        <>
          {/*
            No label means the code did not resolve — wrong, already used, or expired. The three are
            deliberately indistinguishable: telling them apart is only useful to somebody working
            through codes, and the member's remedy is the same in all three cases.
          */}
          <p className="text-[var(--color-text-primary)]">
            Enter the code your companion app is showing.
          </p>
          <div className="mt-6">
            <CodeInput
              value={code.replace(/-/g, '')}
              onChange={(v) => setCode(v)}
              onComplete={() => void approve()}
              label="Code from the app"
              disabled={busy}
              length={8}
              autoFocus
            />
          </div>
        </>
      ) : (
        <>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Asking to connect
          </p>
          <p className="mt-2 text-xl text-[var(--color-brand-orange)]" style={{ fontFamily: 'var(--font-display)' }}>
            {label}
          </p>
          <p className="mt-5 text-[var(--color-text-primary)]">
            Connecting lets this app upload your Elite Dangerous journals to your account. It cannot
            read anything else, post as you, or change your settings.
          </p>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            If you did not just start this in the companion app, close this page and do not approve
            it.
          </p>
        </>
      )}

      {error !== null && (
        <p
          role="alert"
          className="mt-6 rounded border border-[var(--color-brand-orange)] bg-[var(--color-brand-orange)]/5 px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void approve()}
        disabled={busy || code.replace(/-/g, '').length !== 8}
        className="mt-7 w-full rounded border border-[var(--color-brand-cyan-bright)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80 disabled:opacity-40"
      >
        {busy ? 'Connecting…' : 'Connect this app'}
      </button>
    </div>
  );
}
