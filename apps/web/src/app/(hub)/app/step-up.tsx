'use client';

import { useState } from 'react';
import { apiPost } from '../../../lib/api-client';

/**
 * The step-up challenge.
 *
 * Shown whenever the admin API refuses a read. It does not try to work out WHY
 * it was refused — not enrolled, not stepped up, or permission denied all land
 * here, and the page offers both routes forward. Guessing wrong would mean
 * showing an officer a code box they cannot satisfy, or an enrolment link to
 * someone already enrolled.
 */
export function StepUp() {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      /*
       * Through the shared client, which fixes a second bug on the way: this
       * read `j.message` off the TOP LEVEL of the response, but the API answers
       * with an envelope — { error: { message } }. So the real reason was always
       * undefined, and every failure read "That code was not accepted." —
       * including the ones that were about something else entirely.
       */
      await apiPost(
        '/v1/auth/totp/verify',
        recovery.trim() === '' ? { code } : { recoveryCode: recovery },
        'That code was not accepted.',
      );
      // Full reload rather than a client-side refresh: the step-up cookie has
      // just been set and the page is server-rendered, so the server has to
      // fetch again with it.
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[52ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Restricted
        </p>
        <h1
          className="mt-3 text-[clamp(1.75rem,4vw,2.5rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          CONFIRM IT IS YOU
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        <p className="mt-6 text-[var(--color-text-primary)]">
          The admin console needs a code from your authenticator, even though you are already signed
          in. A session cookie on its own is not enough to open it.
        </p>

        {error !== null && (
          <p
            role="alert"
            className="mt-6 rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
          >
            {error}
          </p>
        )}

        <label htmlFor="stepup-code" className="mt-8 block text-[var(--color-text-primary)]">
          Six-digit code
        </label>
        <input
          id="stepup-code"
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="mt-2 w-44 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-4 py-2.5 font-mono text-lg tracking-[0.3em] text-[var(--color-text-primary)]"
        />

        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-[var(--color-text-secondary)]">
            Lost your authenticator?
          </summary>
          <label htmlFor="stepup-recovery" className="mt-4 block text-sm text-[var(--color-text-primary)]">
            Recovery code
          </label>
          <input
            id="stepup-recovery"
            value={recovery}
            onChange={(e) => setRecovery(e.currentTarget.value)}
            className="mt-2 w-full max-w-sm rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-4 py-2.5 font-mono text-sm text-[var(--color-text-primary)]"
          />
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            Each code works once. Set up a new authenticator afterwards.
          </p>
        </details>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || (code.length !== 6 && recovery.trim() === '')}
          className="mt-8 rounded border border-[var(--color-brand-cyan-bright)] px-6 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
        >
          Continue
        </button>

        <p className="mt-10 text-sm text-[var(--color-text-secondary)]">
          Not set up yet?{' '}
          <a href="/settings/security" className="text-[var(--color-brand-cyan-bright)]">
            Enrol an authenticator
          </a>
          .
        </p>
      </div>
    </main>
  );
}
