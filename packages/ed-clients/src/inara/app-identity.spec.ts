import { describe, it, expect } from 'vitest';
import { INARA_APP_NAME, INARA_APP_VERSION } from './inara.adapter.js';

/**
 * The identity Inara whitelists us by.
 *
 * ★ WHY THIS IS PINNED ★
 *
 * Inara asks for "your application name, exactly as it will be sent in the
 * requests", and whitelists that literal string. A mismatch does not fail
 * loudly — every call comes back:
 *
 *   header.eventStatus 400 "This application has no access allowed."
 *
 * which is byte-identical to never having applied at all. So the failure mode
 * of renaming this constant is: verification silently stops working for
 * everybody, and the error blames Inara.
 */
describe('the Inara application identity', () => {
  it('MANDATORY: is exactly the string registered with Inara', () => {
    // Change this ONLY together with a fresh whitelist request to Inara.
    expect(INARA_APP_NAME).toBe('GrimsSquadHub');
  });

  it('MANDATORY: is plain ASCII with no spaces or punctuation', () => {
    /*
     * The squadron is "Grim's Squad", and the obvious name carries a typographic
     * apostrophe. That string travels through JSON, a whitelist lookup and at
     * least one human copy-paste before it is compared — only one of those has
     * to normalise the apostrophe differently for the match to fail, and the
     * resulting error says nothing about why.
     */
    expect(INARA_APP_NAME).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('carries a version, because Inara asks apps to identify themselves', () => {
    expect(INARA_APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
