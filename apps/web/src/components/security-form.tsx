'use client';

import { useCallback, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { apiPost } from '../lib/api-client';
import { CodeInput } from './code-input';

type Stage = 'idle' | 'showing-secret' | 'showing-codes' | 'removing';

/**
 * What removal is for.
 *
 * `replace` goes straight into enrolment afterwards, because somebody moving to a new phone wants
 * one flow, not two visits to the same page. `remove` stops.
 */
type RemoveIntent = 'replace' | 'remove';

/**
 * TOTP enrolment.
 *
 * Two things on this page are shown exactly once and never again: the secret,
 * and the recovery codes. Both are handled as one-way steps — there is no
 * "show it to me again" button, because there is nothing to show. The server
 * keeps only a hash of the codes and never returns the secret after enrolment.
 *
 * ★ THE QR CODE IS DRAWN HERE, IN THE BROWSER ★
 *
 * `qrcode.react` renders an SVG from the otpauth URI locally. No image is
 * fetched, and that is the entire point.
 *
 * The obvious shortcut is an <img> pointing at a QR generator — Google Charts,
 * api.qrserver.com, any of a dozen others. Doing that would put the TOTP SECRET
 * in a URL and send it to a third party, in plaintext, from every member's
 * browser, at the exact moment they are setting up their second factor. It
 * would hand that service the ability to generate valid codes for every admin
 * account on the platform, and nothing about the page would look wrong.
 *
 * A test in this directory fails if such a URL ever appears in the codebase.
 */
export function SecurityForm({
  enrolled,
  /**
   * Whether this account can open the admin console.
   *
   * Only changes what removal WARNS about, never whether it is allowed. A member who has taken on
   * an officer role and wants their authenticator off their old phone is entitled to do that; they
   * are not entitled to be surprised by the admin console closing behind them.
   */
  privileged = false,
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
  privileged?: boolean;
  onDone?: string;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<RemoveIntent>('remove');
  const [removeCode, setRemoveCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recovery, setRecovery] = useState('');
  /*
   * Tracked here rather than re-fetched, so the panel updates the instant removal succeeds. The
   * server is still the authority — `enrolled` arrives from it on the next load — but a page that
   * kept claiming "two-factor is on" until a refresh would be lying about the thing it exists to
   * report.
   */
  const [isEnrolled, setIsEnrolled] = useState(enrolled);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ secret: string; otpauthUri: string }>('/v1/auth/totp/enrol');
      setSecret(r.secret);
      setUri(r.otpauthUri);
      setStage('showing-secret');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const confirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ recoveryCodes: string[] }>('/v1/auth/totp/confirm', { code });
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
      /*
       * Cleared on failure, like the step-up gate. A rejected TOTP code is expired by definition,
       * so leaving the digits in place only invites confirming the same dead code twice — and empty
       * boxes say "look at your phone again" more plainly than any error text.
       */
      setCode('');
    } finally {
      setBusy(false);
    }
    // Rebuilt whenever the code changes, because it sends the code it closed over. That is what
    // makes auto-submit send the digits that just completed rather than the previous render's.
  }, [code]);

  /** Adapts the async submit to CodeInput's void callback, without changing identity gratuitously. */
  const onConfirmComplete = useCallback(() => {
    void confirm();
  }, [confirm]);

  /**
   * Removes the authenticator, proving possession first.
   *
   * ★ A CURRENT CODE, NOT THE STEP-UP COOKIE ★
   *
   * The server insists on one and this asks for it plainly. Removal is the most useful thing an
   * attacker can do with a hijacked session — it turns a stolen tab into a permanent hold, because
   * everything afterwards needs only Discord. A step-up is a decision made up to eight hours ago;
   * this asks the person at the keyboard to prove possession now.
   */
  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/v1/auth/totp/remove', useRecovery ? { recoveryCode: recovery } : { code: removeCode });

      setIsEnrolled(false);
      setRemoveCode('');
      setRecovery('');
      setUseRecovery(false);

      if (intent === 'replace') {
        // Straight on to setting the new one up. Somebody moving to a new phone asked for one
        // errand, not two.
        await begin();
      } else {
        setStage('idle');
      }
    } catch (e) {
      setError((e as Error).message);
      // Same reasoning as confirm(): a rejected code is expired by definition.
      setRemoveCode('');
    } finally {
      setBusy(false);
    }
    /*
     * `begin` is deliberately not a dependency. It is a plain function redeclared every render, so
     * listing it would rebuild this callback on every keystroke; what it closes over (nothing but
     * setters) does not change. The repo does not run `react-hooks/exhaustive-deps`, so this is a
     * note rather than a suppression — a disable comment for a rule that is not configured is an
     * eslint error in its own right, which is how this first failed.
     */
  }, [intent, removeCode, recovery, useRecovery]);

  const onRemoveComplete = useCallback(() => {
    void remove();
  }, [remove]);

  if (isEnrolled && stage === 'idle') {
    return (
      <div className="mt-8">
        <p className="text-[var(--color-text-primary)]">
          <span className="text-[var(--color-brand-cyan-bright)]">Two-factor is on.</span> You will
          be asked for a code when you open the admin console.
        </p>

        {/*
          ★ SQUADRON OWNER ★

          "we need a way for our users to either add the authenticator to their profile and manage
          the authenticator, remove and re add etc."

          This panel used to end at the sentence above, and then told people to "set it up again
          from a device you still have" — advice with no control anywhere on the page to follow it.
        */}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setIntent('replace');
              setError(null);
              setStage('removing');
            }}
            className="rounded border border-[var(--color-border-active)] px-4 py-2 text-sm text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[var(--color-surface-panel-hover)]"
          >
            Move to a new authenticator
          </button>
          <button
            type="button"
            onClick={() => {
              setIntent('remove');
              setError(null);
              setStage('removing');
            }}
            className="rounded border border-[var(--color-border-hairline)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
          >
            Remove it
          </button>
        </div>

        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          Changing phones? Use <em>Move to a new authenticator</em> — it removes the old one and
          sets the new one up in a single step, and gives you fresh recovery codes.
        </p>

        {privileged && (
          /*
            Said BEFORE they click, not after. The owner's rule is that an officer who removes it
            "can not be able to access the admin area at all" until it is back — which is enforced
            by the guard whatever this panel says. What the panel owes them is knowing that in
            advance rather than discovering it at a locked door.
          */
          <p className="mt-3 rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_8%,transparent)] px-4 py-3 text-sm text-[var(--color-brand-orange)]">
            Your account can open the admin console, so removing your authenticator closes it until
            you set one up again. Everything else on the site keeps working.
          </p>
        )}
      </div>
    );
  }

  if (stage === 'removing') {
    return (
      <div className="mt-8">
        <h2 className="m-0 text-lg text-[var(--color-text-primary)]">
          {intent === 'replace' ? 'Move to a new authenticator' : 'Remove your authenticator'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {intent === 'replace'
            ? 'Enter a code from the authenticator you are leaving. We will remove it and set the new one up straight away.'
            : 'Enter a code from your authenticator to confirm this is you.'}
        </p>

        {error !== null && (
          <p
            role="alert"
            className="mt-4 rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
          >
            {error}
          </p>
        )}

        {useRecovery ? (
          <div className="mt-6">
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
                Recovery code
              </span>
              <input
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
                autoComplete="one-time-code"
                className="w-full max-w-xs rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
              />
            </label>
            <button
              type="button"
              disabled={busy || recovery.trim() === ''}
              onClick={() => void remove()}
              className="mt-3 rounded border border-[var(--color-border-active)] px-4 py-2 text-sm text-[var(--color-brand-orange-bright)] disabled:opacity-40"
            >
              {busy ? 'Working…' : 'Confirm'}
            </button>
          </div>
        ) : (
          <div className="mt-6">
            {/* Auto-submits on the sixth digit, like every other code box on this site. */}
            <CodeInput
              value={removeCode}
              onChange={setRemoveCode}
              onComplete={onRemoveComplete}
              label={
                intent === 'replace'
                  ? 'Code from the authenticator you are leaving'
                  : 'Code from your authenticator'
              }
              disabled={busy}
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => {
              setStage('idle');
              setError(null);
              setRemoveCode('');
              setRecovery('');
              setUseRecovery(false);
            }}
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setError(null);
            }}
            className="text-sm text-[var(--color-brand-cyan-bright)]"
          >
            {useRecovery
              ? 'Use a code from my authenticator'
              : 'I have lost my authenticator — use a recovery code'}
          </button>
        </div>
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
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            Step 1
          </p>
          <p className="mt-2 text-[var(--color-text-primary)]">
            Scan this with your authenticator app.
          </p>

          {/*
            ★ A WHITE PLATE UNDER THE CODE, DELIBERATELY ★

            The site is near-black, and a QR rendered dark-on-dark is
            unscannable — phone cameras look for a light field with dark
            modules. This is the one place on the site that breaks the theme,
            and it breaks it because the alternative is a control that does not
            work.

            Quiet zone included via `includeMargin`: readers need clear space
            around the pattern, and without it scanning fails on exactly the
            cheap cameras most likely to be pointed at it.
          */}
          <div className="mt-5 inline-block rounded-lg bg-white p-4">
            <QRCodeSVG
              value={uri}
              size={192}
              level="M"
              marginSize={2}
              // Described rather than decorative: a screen-reader user needs to
              // know this is the enrolment code and that the manual key below
              // does the same job.
              title="Two-factor enrolment QR code"
            />
          </div>

          <details className="mt-5">
            <summary className="cursor-pointer text-sm text-[var(--color-brand-cyan-bright)]">
              Can&rsquo;t scan it?
            </summary>
            {/*
              Kept, not replaced. Somebody setting this up on the same device
              they are reading it on has no second camera to point at the
              screen, and a desktop authenticator needs the key typed in.
            */}
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              Enter this key into your authenticator by hand:
            </p>
            <p className="mt-2 break-all rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] p-4 font-mono text-sm text-[var(--color-brand-cyan-bright)]">
              {secret}
            </p>
            <p className="mt-3 text-sm">
              <a href={uri} className="text-[var(--color-brand-cyan-bright)]">
                Or open it in an authenticator on this device
              </a>
            </p>
          </details>

          {/*
            ★ THE CODE STEP, SET APART FROM THE QR STEP ★

            These are two different actions — point a camera, then type what it shows — and they
            used to run together as one column of text with a 160px field and a button floating to
            its right on a `ml-4`. The rule and the step number say where one ends and the other
            begins, and the button now sits UNDER the field it belongs to rather than beside it,
            which is also the only arrangement that survives a narrow screen.
          */}
          <div className="mt-8 border-t border-[var(--color-border-hairline)] pt-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
              Step 2
            </p>
            <p className="mt-2 text-[var(--color-text-primary)]">
              Enter the six-digit code your authenticator is showing.
            </p>

            <div className="mt-5">
              <CodeInput
                value={code}
                onChange={setCode}
                onComplete={onConfirmComplete}
                label="Six-digit code"
                disabled={busy}
              />
            </div>
            <p className="mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
              {busy ? 'Checking…' : 'Confirmed as soon as the sixth digit lands.'}
            </p>

            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || code.length !== 6}
              className="mt-5 rounded border border-[var(--color-brand-cyan-bright)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              {busy ? 'Checking…' : 'Confirm'}
            </button>
          </div>
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
