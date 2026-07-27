'use client';

import { useState } from 'react';
import { errorFromResponse } from '../../../lib/api-error';

function readCsrf(): string {
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  // The init object is built first so `body` is simply absent when there is
  // none. Passing `body: undefined` inline trips the fetch overload under
  // exactOptionalPropertyTypes.
  const init: RequestInit = {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': readCsrf() },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(path, init);
  if (!res.ok) {
    throw new Error((await errorFromResponse(res, 'That did not work. Try again.')).message);
  }
  return (await res.json().catch(() => ({}))) as T;
}

type Stage = 'idle' | 'showing-secret' | 'showing-codes';

/**
 * TOTP enrolment.
 *
 * Two things on this page are shown exactly once and never again: the secret,
 * and the recovery codes. Both are handled as one-way steps — there is no
 * "show it to me again" button, because there is nothing to show. The server
 * keeps only a hash of the codes and never returns the secret after enrolment.
 */
export function SecurityForm({
  enrolled,
  /**
   * Where to send them once the recovery codes have been acknowledged.
   *
   * Only set by the FORCED onboarding flow. On the ordinary settings page there
   * is nowhere to go — they came here deliberately and can leave the same way —
   * so it stays undefined and no button appears.
   */
  onDone,
}: {
  enrolled: boolean;
  onDone?: string;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ secret: string; otpauthUri: string }>('/v1/auth/totp/enrol');
      setSecret(r.secret);
      setUri(r.otpauthUri);
      setStage('showing-secret');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ recoveryCodes: string[] }>('/v1/auth/totp/confirm', { code });
      setCodes(r.recoveryCodes);
      // The secret is dropped from component state the moment it is no longer
      // needed. It stays in the authenticator, which is the only place it
      // should live from here on.
      setSecret('');
      setUri('');
      setCode('');
      setStage('showing-codes');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (enrolled && stage === 'idle') {
    return (
      <div className="mt-8">
        <p className="text-[var(--color-text-primary)]">
          <span className="text-[var(--color-brand-cyan-bright)]">Two-factor is on.</span> You will
          be asked for a code when you open the admin console.
        </p>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Lost your authenticator? Use a recovery code to get in, then set it up again from a device
          you still have.
        </p>
      </div>
    );
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

      {stage === 'idle' && (
        <>
          <p className="text-[var(--color-text-primary)]">
            The admin console needs a second factor. Set one up with any authenticator app — Aegis,
            Ente Auth, 1Password, Google Authenticator.
          </p>
          <button
            type="button"
            onClick={() => void begin()}
            disabled={busy}
            className="mt-6 rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
          >
            Set up two-factor
          </button>
        </>
      )}

      {stage === 'showing-secret' && (
        <>
          <p className="text-[var(--color-text-primary)]">
            Add this to your authenticator, then enter the six-digit code it shows.
          </p>
          <p className="mt-4 break-all rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] p-4 font-mono text-sm text-[var(--color-brand-cyan-bright)]">
            {secret}
          </p>
          <p className="mt-3 text-sm">
            <a href={uri} className="text-[var(--color-brand-cyan-bright)]">
              Open in your authenticator app
            </a>
          </p>

          <label htmlFor="totp-code" className="mt-8 block text-[var(--color-text-primary)]">
            Six-digit code
          </label>
          <input
            id="totp-code"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="mt-2 w-40 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-4 py-2.5 font-mono text-lg tracking-[0.3em] text-[var(--color-text-primary)]"
          />
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || code.length !== 6}
            className="ml-4 rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
          >
            Confirm
          </button>
        </>
      )}

      {stage === 'showing-codes' && (
        <>
          <p className="text-lg text-[var(--color-brand-cyan-bright)]">Two-factor is on.</p>
          <p className="mt-4 text-[var(--color-text-primary)]">
            Save these recovery codes somewhere safe. Each one works once, and{' '}
            <strong>this is the only time they will be shown</strong> — we store only hashes, so we
            cannot show them again even if you ask.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-2 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] p-5 font-mono text-sm text-[var(--color-text-primary)] sm:grid-cols-3">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(codes.join('\n'));
              }}
              className="rounded border border-[var(--color-border-hairline)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-text-primary)]"
            >
              Copy codes
            </button>
            {onDone !== undefined && (
              /*
                A full navigation, not a client-side push. The destination is
                server-rendered and its access check runs on the server, so it
                has to be asked again now that enrolment has actually happened.
              */
              <a
                href={onDone}
                className="rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]"
              >
                I have saved them — continue
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
