/**
 * When a six-digit code box should submit itself.
 *
 * ★ SEPARATED FROM THE COMPONENT BECAUSE THE BUG IS INVISIBLE ★
 *
 * Auto-submit misbehaving does not look wrong. The boxes render correctly, the digits are right,
 * and the entire defect is in how many requests went out — which no amount of looking at the page
 * will show. Kept as a plain function so the one rule that matters can be tested directly, the same
 * way `update-banner-rules` and `user-multi-select-rules` are.
 */

/** Digits only, never longer than the code. Typing and pasting both come through here. */
export function normaliseCode(raw: string, length: number): string {
  return raw.replace(/\D/g, '').slice(0, length);
}

export interface SubmitDecision {
  /** Fire the completion callback now. */
  readonly submit: boolean;
  /** What to remember as sent. Null re-arms the box for the next complete code. */
  readonly remember: string | null;
}

/**
 * Decides whether a change should trigger submission.
 *
 * ★ THE LOOP THIS PREVENTS ★
 *
 * The naive rule is "submit when the value is six digits long". It fires on every render while
 * those six digits are present — so a code the server REJECTS, left sitting in the box, is sent
 * again, and again, against the endpoint that is rate-limiting it. The member sees an error
 * flickering and has no way to stop it except clearing the field.
 *
 * Remembering what was already sent makes it one submission per distinct code. Changing any digit
 * re-arms it, so correcting a typo still works.
 */
export function decideSubmit(
  value: string,
  length: number,
  alreadySent: string | null,
  disabled: boolean,
): SubmitDecision {
  if (value.length !== length) {
    /*
     * Incomplete. Re-arm if this is not simply the code we just sent — deleting a digit from a
     * rejected code has to make the box live again, or a corrected code would never be sent.
     */
    return { submit: false, remember: alreadySent === null || value === alreadySent ? alreadySent : null };
  }

  // Complete, but already sent, or the form is mid-flight. Either way, not again.
  if (disabled || alreadySent === value) return { submit: false, remember: alreadySent };

  return { submit: true, remember: value };
}
