'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { decideSubmit, normaliseCode, type Charset } from './code-input-rules';

/**
 * The six-digit code box, everywhere a code is asked for.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "auto submit the 2 factor code when 6 digits are entered so we dont have to always click the
 * continue button ... the 2 factor pages feel clunky and just not laid out well"
 *
 * ★ ONE REAL INPUT, DRAWN AS SIX BOXES ★
 *
 * The obvious build is six separate inputs, one per digit. It looks right and it breaks the things
 * that make this control bearable:
 *
 *   - `autocomplete="one-time-code"` stops working reliably. That attribute is why iOS offers the
 *     code from Messages and why password managers fill it at all. Split across six fields, most
 *     of them put the whole code in the first box.
 *   - Pasting puts all six digits in box one and nothing anywhere else.
 *   - A screen reader announces six unlabelled fields instead of one labelled one.
 *   - Every browser disagrees about what backspace should do at a boundary.
 *
 * So there is exactly ONE input — real, labelled, autofillable, pasteable — sitting invisibly over
 * six boxes that are painted from its value. The boxes are decoration; the input is the control.
 * Everything the platform already does correctly keeps working, and the only thing added is how it
 * looks.
 *
 * ★ AND IT SUBMITS ITSELF ★
 *
 * A six-digit code has exactly one moment when it is complete, and the machine knows when that is
 * better than the person does. Reaching for a button afterwards is pure ceremony — the reason it is
 * there at all is that forms historically had nothing else to trigger on.
 *
 * The button stays for the cases where automation is wrong: a recovery code has no fixed length, an
 * autofill can land a code that is already expiring, and a submit that failed must not re-fire on
 * its own. See `submitted` below.
 */

export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  disabled = false,
  autoFocus = false,
  length = 6,
  /** Digits for a TOTP code; alnum for the companion's device code. See `normaliseCode`. */
  charset = 'digits',
}: {
  value: string;
  onChange: (next: string) => void;
  /** Called once, the moment a complete code is present. */
  onComplete: () => void;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
  charset?: Charset;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  /**
   * The code we have already fired for.
   *
   * ★ WITHOUT THIS, A WRONG CODE RETRIES FOR EVER ★
   *
   * The completion effect runs whenever the value is six digits long. If the server rejects the
   * code and the digits stay in the box, every re-render fires the same request again — a rejected
   * code hammering the endpoint that is rate-limiting it, with the member watching an error flicker
   * and no way to stop it but clearing the field.
   *
   * Remembering what was sent means one submission per distinct code. Typing anything different
   * arms it again.
   */
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    // The rule itself lives in code-input-rules, where it is tested directly. Duplicating it here
    // would mean the tested version and the running version could drift without anything failing.
    const decision = decideSubmit(value, length, submitted.current, disabled);
    submitted.current = decision.remember;
    if (decision.submit) onComplete();
  }, [value, length, disabled, onComplete]);

  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  // Where the caret is, so exactly one box reads as active. Past the end it sits on the last box
  // rather than nowhere, which is what a real caret does.
  const active = Math.min(value.length, length - 1);

  return (
    <div>
      <label htmlFor={id} className="block font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
        {label}
      </label>

      <div
        className="relative mt-3 w-fit"
        // Clicking the boxes focuses the input under them. Without this the control looks
        // interactive and does nothing, which is worse than looking inert.
        onClick={() => inputRef.current?.focus()}
      >
        <div className="flex gap-2 sm:gap-3" aria-hidden="true">
          {digits.map((d, i) => (
            <div
              key={i}
              className={[
                'flex h-14 w-11 items-center justify-center rounded border font-mono text-2xl transition-colors sm:h-16 sm:w-12',
                'bg-[var(--color-surface-void)] text-[var(--color-text-primary)]',
                focused && i === active && !disabled
                  ? 'border-[var(--color-brand-cyan-bright)] shadow-[0_0_0_1px_var(--color-brand-cyan-bright)]'
                  : d !== ''
                    ? 'border-[var(--color-brand-cyan-bright)]/50'
                    : 'border-[var(--color-border-hairline)]',
                disabled ? 'opacity-50' : '',
              ].join(' ')}
            >
              {d === '' ? (
                // A dim placeholder rather than an empty box: six blank outlines do not read as
                // "six digits go here" until at least one is filled.
                <span className="text-[var(--color-text-secondary)] opacity-40">·</span>
              ) : (
                d
              )}
            </div>
          ))}
        </div>

        {/*
          The real control. Transparent rather than `hidden` or zero-width: a hidden input cannot be
          focused, and browsers will not offer autofill to a field they consider invisible.
        */}
        <input
          ref={inputRef}
          id={id}
          value={value}
          onChange={(e) => {
            // Digits only, and trimmed to length. Handles typing and pasting identically, which is
            // why paste needs no special case: a pasted "123 456" arrives here as 123456.
            onChange(normaliseCode(e.currentTarget.value, length, charset));
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          // `numeric` would put a phone keyboard with no letters under an alphanumeric code.
          inputMode={charset === 'alnum' ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          // Off, all of it. A one-time code is not a word, and a phone capitalising or correcting
          // it is a phone silently changing what the member typed.
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={length}
          autoFocus={autoFocus}
          className="absolute inset-0 h-full w-full cursor-pointer rounded bg-transparent text-transparent caret-transparent outline-none"
        />
      </div>
    </div>
  );
}
