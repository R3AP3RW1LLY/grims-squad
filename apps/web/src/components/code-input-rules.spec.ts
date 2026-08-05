import { describe, expect, it } from 'vitest';
import { decideSubmit, normaliseCode } from './code-input-rules';

describe('normaliseCode', () => {
  it('keeps digits and nothing else', () => {
    // Authenticators and password managers both hand over "123 456" often enough to matter.
    expect(normaliseCode('123 456', 6)).toBe('123456');
    expect(normaliseCode('12ab34cd56', 6)).toBe('123456');
    expect(normaliseCode('123-456', 6)).toBe('123456');
  });

  it('never holds more than the code length', () => {
    expect(normaliseCode('1234567890', 6)).toBe('123456');
  });
});

describe('decideSubmit', () => {
  it('does not fire before the code is complete', () => {
    expect(decideSubmit('12345', 6, null, false).submit).toBe(false);
  });

  it('fires the moment the last digit lands', () => {
    expect(decideSubmit('123456', 6, null, false)).toEqual({ submit: true, remember: '123456' });
  });

  it('MANDATORY: never fires twice for the same code', () => {
    /*
     * The loop this exists to prevent: a rejected code stays in the box, the value is still six
     * digits on the next render, and it is sent again — forever, at the endpoint that is rate
     * limiting it, with no way for the member to stop it.
     */
    const first = decideSubmit('123456', 6, null, false);
    expect(first.submit).toBe(true);

    const second = decideSubmit('123456', 6, first.remember, false);
    expect(second.submit).toBe(false);

    const third = decideSubmit('123456', 6, second.remember, false);
    expect(third.submit).toBe(false);
  });

  it('re-arms when a digit is corrected, so a fixed typo still sends', () => {
    const sent = decideSubmit('123456', 6, null, false).remember;

    // Backspace: still the same code, minus one. Stays disarmed — nothing new has been entered.
    const backspaced = decideSubmit('12345', 6, sent, false);
    expect(backspaced.submit).toBe(false);

    // A genuinely different sixth digit must go.
    const corrected = decideSubmit('123457', 6, backspaced.remember, false);
    expect(corrected.submit).toBe(true);
  });

  it('re-arms after the box is cleared, which is what a rejection does', () => {
    const sent = decideSubmit('123456', 6, null, false).remember;
    const cleared = decideSubmit('', 6, sent, false);
    expect(cleared.remember).toBeNull();

    // The same code can be sent again once it has genuinely been re-entered — a TOTP code can be
    // valid on a second attempt if the first failed for a reason other than the code.
    expect(decideSubmit('123456', 6, cleared.remember, false).submit).toBe(true);
  });

  it('does not fire while a request is already in flight', () => {
    expect(decideSubmit('123456', 6, null, true).submit).toBe(false);
  });
});

describe('alphanumeric codes', () => {
  /*
   * ★ THE REGRESSION THIS EXISTS TO STOP ★
   *
   * This component was written for six-digit TOTP and reused for the companion's device code, which
   * is alphanumeric. Stripping non-digits meant typing the real code "K7M2-QP4X" produced "724" —
   * the approval page could not be completed by hand at all, and nothing errored. The field simply
   * ate what was typed and left the button disabled.
   */
  it('MANDATORY: keeps the letters', () => {
    expect(normaliseCode('K7M2-QP4X', 8, 'alnum')).toBe('K7M2QP4X');
  });

  it('accepts it in lower case, because that is the same code', () => {
    expect(normaliseCode('k7m2-qp4x', 8, 'alnum')).toBe('K7M2QP4X');
  });

  it('still drops punctuation and spacing', () => {
    expect(normaliseCode(' K7M2 QP4X ', 8, 'alnum')).toBe('K7M2QP4X');
  });

  it('leaves digit codes exactly as they were', () => {
    // The default must not change: every existing caller is a TOTP field.
    expect(normaliseCode('12ab34cd56', 6)).toBe('123456');
    expect(normaliseCode('123 456', 6)).toBe('123456');
  });
});

describe('a fleet carrier callsign in the boxes', () => {
  /*
   * ★ SQUADRON OWNER, 2026-08-04 ★
   *
   * "can we do this in a box that looks like our 2FA input box? but put a dash between the first
   * and 2nd set of 3 digits? auto search on completion please!"
   *
   * A callsign is six alphanumerics written `W8K-W1Y`. The dash is drawn BETWEEN boxes and is never
   * a character in the value, so every way it arrives has to reduce to the same six.
   */
  it('★ reduces every way a person enters W8K-W1Y to the same six characters ★', () => {
    expect(normaliseCode('W8K-W1Y', 6, 'alnum')).toBe('W8KW1Y');
    expect(normaliseCode('w8k-w1y', 6, 'alnum')).toBe('W8KW1Y');
    expect(normaliseCode('W8KW1Y', 6, 'alnum')).toBe('W8KW1Y');
    expect(normaliseCode(' w8k w1y ', 6, 'alnum')).toBe('W8KW1Y');
  });

  it('★ a PASTE of the dashed callsign still completes ★', () => {
    /*
     * The bug this catches is in the component, not here: `maxLength` applies to the raw text
     * before `normaliseCode` sees it, so a `maxLength={6}` field truncates a pasted `W8K-W1Y` to
     * `W8K-W1` — five characters after normalising, and the box never auto-submits. The control now
     * sizes `maxLength` as `length + separators`. This pins what has to come out the far end.
     */
    expect(normaliseCode('W8K-W1Y', 6, 'alnum')).toHaveLength(6);
    expect(decideSubmit(normaliseCode('W8K-W1Y', 6, 'alnum'), 6, null, false).submit).toBe(true);

    // And the truncated form is exactly what must NOT complete, so the failure stays visible
    // rather than searching for a carrier nobody typed.
    expect(decideSubmit(normaliseCode('W8K-W1', 6, 'alnum'), 6, null, false).submit).toBe(false);
  });

  it('fires the search once per distinct callsign, not once per render', () => {
    // A callsign the hub has no carrier for sits in the boxes while the refusal is read. Without
    // the guard that is a request per render against the search endpoint.
    const first = decideSubmit('W8KW1Y', 6, null, false);
    expect(first.submit).toBe(true);
    expect(decideSubmit('W8KW1Y', 6, first.remember, false).submit).toBe(false);

    // Correcting one character re-arms it.
    const corrected = decideSubmit('W8KW1', 6, first.remember, false);
    expect(decideSubmit('W8KW1X', 6, corrected.remember, false).submit).toBe(true);
  });
});
