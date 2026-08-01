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
