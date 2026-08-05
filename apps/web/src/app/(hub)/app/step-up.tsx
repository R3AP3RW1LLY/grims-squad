'use client';

import { useCallback, useState } from 'react';
import { apiPost } from '../../../lib/api-client';
import { CodeInput } from '../../../components/code-input';

/**
 * The step-up challenge — the admin console's front door.
 *
 * Shown whenever the admin API refuses a read. It does not try to work out WHY it was refused —
 * not enrolled, not stepped up, or permission denied all land here, and the page offers both routes
 * forward. Guessing wrong would mean showing an officer a code box they cannot satisfy, or an
 * enrolment link to someone already enrolled.
 *
 * ★ REDESIGNED — SQUADRON OWNER, 2026-08-01 ★
 *
 * "i want to redesign the admin 2factor login page layout too, the 2 factor pages feel clunky and
 * just not laid out well"
 *
 * They were, and for reasons worth writing down rather than just moving pixels:
 *
 *   - The code went into a 176px text box with wide letter-spacing, which looks like a field
 *     somebody forgot to finish. Six boxes say how many digits are wanted without a sentence
 *     having to.
 *   - "Lost your authenticator?" was a <details> sitting BETWEEN the code box and the Continue
 *     button. The escape hatch was physically in the path of the main action, so everyone read it
 *     and almost nobody needed it.
 *   - Nothing was contained. Text, field and button floated on the page at three different widths,
 *     so the eye had no line to follow down.
 *   - The button was mandatory, and the code was already complete when the sixth digit landed.
 *
 * Now: one bordered card, one column, the code first and everything else after it in the order a
 * person needs it — submit, then "this isn't working", then "I'm not set up at all".
 */
export function StepUp() {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (submittedCode?: string) => {
      const totp = submittedCode ?? code;
      setBusy(true);
      setError(null);
      try {
        /*
         * Through the shared client, which fixes a second bug on the way: this read `j.message` off
         * the TOP LEVEL of the response, but the API answers with an envelope —
         * { error: { message } }. So the real reason was always undefined, and every failure read
         * "That code was not accepted." — including the ones that were about something else.
         */
        await apiPost(
          '/v1/auth/totp/verify',
          useRecovery ? { recoveryCode: recovery } : { code: totp },
          'That code was not accepted.',
        );
        // Full reload rather than a client-side refresh: the step-up cookie has just been set and
        // the page is server-rendered, so the server has to fetch again with it.
        window.location.reload();
      } catch (e) {
        setError((e as Error).message);
        /*
         * The digits are cleared on failure, and that is not tidiness.
         *
         * A TOTP code is dead the moment it is rejected — the window has passed, and the next
         * attempt needs a NEW one from the app. Leaving the old digits sitting there invites
         * pressing the button again on a code that cannot possibly work, and the empty boxes are
         * the clearest possible instruction to look at the phone again.
         */
        if (!useRecovery) setCode('');
        setBusy(false);
      }
    },
    [code, recovery, useRecovery],
  );

  // Stable across renders, so CodeInput's completion effect does not re-fire on every keystroke.
  const onComplete = useCallback(() => {
    void submit();
  }, [submit]);

  return (
    <main id="main" className="mx-auto flex min-h-[70vh] max-w-[1440px] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[30rem]">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
            Restricted
          </p>
          <h1
            className="mt-3 text-[clamp(1.5rem,3.5vw,2rem)] leading-tight text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            CONFIRM IT IS YOU
          </h1>
          <div className="rule-glow mx-auto mt-5 w-24" aria-hidden="true" />
        </div>

        {/* Same card treatment as Panel and StatTile in hub-page, so this reads as part of the app. */}
        <div className="mt-8 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6 sm:p-8">
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
            The admin console needs a code from your authenticator, even though you are already
            signed in. A session cookie on its own is not enough to open it.
          </p>

          {error !== null && (
            <p
              role="alert"
              className="mt-6 rounded border border-[var(--color-brand-orange)] bg-[var(--color-brand-orange)]/5 px-4 py-3 text-sm text-[var(--color-brand-orange)]"
            >
              {error}
            </p>
          )}

          {!useRecovery ? (
            <>
              <div className="mt-7">
                <CodeInput
                  value={code}
                  onChange={setCode}
                  onComplete={onComplete}
                  label="Authenticator code"
                  disabled={busy}
                  autoFocus
                />
              </div>
              <p className="mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
                {busy ? 'Checking…' : 'Checked as soon as the sixth digit lands.'}
              </p>
            </>
          ) : (
            <div className="mt-7">
              <label
                htmlFor="stepup-recovery"
                className="block font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]"
              >
                Recovery code
              </label>
              <input
                id="stepup-recovery"
                value={recovery}
                onChange={(e) => setRecovery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // Enter submits. A recovery code has no fixed length, so nothing else can know
                  // when it is finished — this is the case the button exists for.
                  if (e.key === 'Enter' && recovery.trim() !== '' && !busy) void submit();
                }}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="mt-3 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-4 py-3 font-mono text-base tracking-wider text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-cyan-bright)]"
              />
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                Each code works once. Set up a new authenticator afterwards.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || (useRecovery ? recovery.trim() === '' : code.length !== 6)}
            className="mt-7 w-full rounded border border-[var(--color-brand-cyan-bright)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Continue'}
          </button>

          {/*
            ★ BELOW THE ACTION, NOT BESIDE IT ★

            This was a <details> between the code box and the button, so the way OUT of the normal
            flow sat in the middle of the normal flow. A plain toggle underneath is out of the way
            for the ninety-nine per cent and one click for the rest.
          */}
          <div className="mt-6 border-t border-[var(--color-border-hairline)] pt-5 text-center">
            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v);
                setError(null);
                setCode('');
                setRecovery('');
              }}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] underline underline-offset-4 hover:text-[var(--color-brand-cyan-bright)]"
            >
              {useRecovery ? 'Use my authenticator instead' : 'Lost your authenticator?'}
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
          Not set up yet?{' '}
          <a href="/settings/security" className="text-[var(--color-brand-cyan-bright)] underline underline-offset-4">
            Enrol an authenticator
          </a>
          .
        </p>
      </div>
    </main>
  );
}
