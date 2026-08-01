'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeInput } from './code-input';
import { apiPost } from '../lib/api-client';

/**
 * Confirming an action with the authenticator, without leaving the page.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "the 2FA confirmation, should pop up in a modal please and it should auto submit after the 6th
 * digit is entered like the official authenticator does when we first sign in etc"
 *
 * ★ WHY A MODAL AND NOT AN INLINE BOX ★
 *
 * The role editor grew a code field inside the form it was interrupting — a 128px input and a
 * Continue button, wedged between the permission checkboxes and the Save button. It worked, and it
 * read as one more field on a long form rather than as "everything has stopped until you do this".
 *
 * A tier-3 action needs a code from the last two minutes. That IS an interruption, and showing it
 * as one is more honest than hiding it in the layout — an officer who scrolls past a code box while
 * hunting for why Save did nothing has been misled by the design.
 *
 * ★ AND IT SUBMITS ITSELF ★
 *
 * A TOTP code is complete at the sixth digit. There is nothing to review, no chance the seventh
 * character changes the answer, and pressing Continue afterwards is a keystroke the sign-in flow
 * already does not ask for. Doing it differently here would be the site being inconsistent with
 * itself.
 */
export function TwoFactorModal({
  open,
  title,
  explanation,
  onConfirmed,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** Why the code is being asked for, in the caller's own words. */
  explanation: string;
  /** Called after the API accepts the code. The caller retries whatever was refused. */
  onConfirmed: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // A fresh prompt starts empty. Reopening with a rejected code still in the boxes would auto-submit
  // it instantly and fail again, which looks like the modal refusing to work at all.
  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  /*
   * Escape closes it.
   *
   * A modal with no way out but a correct code is a trap: the code may be genuinely unavailable —
   * a phone in another room — and the honest response to that is to let somebody leave and come
   * back, not to hold the page hostage.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const submit = useCallback(
    async (entered: string) => {
      setBusy(true);
      setError(null);
      try {
        await apiPost('/v1/auth/totp/verify', { code: entered }, 'That code was not accepted.');
        setBusy(false);
        await onConfirmed();
      } catch (e) {
        setError((e as Error).message);
        /*
         * The digits are cleared on failure, and that is not tidiness.
         *
         * A TOTP code is dead the moment it is rejected — its window has passed, and the next
         * attempt needs a new one from the app. Leaving the old digits sitting there invites
         * submitting a code that cannot possibly work, and empty boxes are the clearest possible
         * instruction to look at the phone again.
         */
        setCode('');
        setBusy(false);
      }
    },
    [onConfirmed],
  );

  // Stable across renders, so CodeInput's completion effect does not re-fire on every keystroke.
  const onComplete = useCallback(() => {
    setCode((current) => {
      if (current.length === 6) void submit(current);
      return current;
    });
  }, [submit]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-surface-void)_82%,transparent)] p-4 backdrop-blur-sm"
      /*
        Clicking the backdrop closes it, the same as Escape. Clicking INSIDE must not, which is why
        the panel stops the event — otherwise every click on the code boxes would dismiss the thing
        being typed into.
      */
      onClick={(e) => {
        if (!panelRef.current?.contains(e.target as Node)) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] p-6 shadow-2xl"
      >
        <h2 className="text-lg text-[var(--color-text-primary)]">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {explanation}
        </p>

        <div className="mt-5">
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next);
              // Clearing the error as they retype: leaving "that code was not accepted" above a
              // half-typed new code reads as a verdict on the one being entered.
              if (error !== null) setError(null);
            }}
            onComplete={onComplete}
            label="Authenticator code"
            disabled={busy}
            autoFocus
          />
        </div>

        {error !== null && (
          <p className="mt-3 text-sm text-[var(--color-semantic-hostile-bright)]" role="alert">
            {error}
          </p>
        )}

        {busy && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Checking…
          </p>
        )}

        {/*
          No Continue button. The code submits itself at the sixth digit — see the note above — so
          the only control here is the way out, and it says what it does rather than "Cancel".
        */}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--color-border-hairline)] pt-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
            Submits on the sixth digit
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-border-hairline)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
