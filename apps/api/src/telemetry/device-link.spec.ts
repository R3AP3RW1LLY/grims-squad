import { describe, expect, it } from 'vitest';
import {
  COLLECT_TTL_MS,
  canApprove,
  hashSecret,
  newCode,
  newPollSecret,
  normaliseCode,
  pollState,
} from './device-link.js';

/**
 * The link flow replaces a copied credential, so it has to be at least as safe as the thing it
 * replaced. Every test here is about a way it could quietly stop being that — a token handed out
 * twice, a token handed out after expiry, a code guessable enough to be worth guessing.
 */

const NOW = new Date('2026-08-01T12:00:00Z');
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const ahead = (ms: number): Date => new Date(NOW.getTime() + ms);

describe('the code', () => {
  it('is readable across a room and back', () => {
    const code = newCode();
    expect(code).toMatch(/^[2-46-9A-HJ-KM-NP-RT-Z]{4}-[2-46-9A-HJ-KM-NP-RT-Z]{4}$/);
  });

  it('MANDATORY: contains no character anybody confuses for another', () => {
    /*
     * Read off one screen, typed into another. 0/O, 1/I/L and 5/S are the pairs people get wrong,
     * and the member who mistypes cannot tell a misread from an expired link.
     */
    const sample = Array.from({ length: 300 }, () => newCode()).join('');
    for (const bad of ['0', 'O', '1', 'I', 'L', '5', 'S', 'U']) {
      expect(sample).not.toContain(bad);
    }
  });

  it('does not repeat itself', () => {
    // Not a proof of entropy, but a loop that returned a constant would pass every other test here.
    const seen = new Set(Array.from({ length: 500 }, () => newCode()));
    expect(seen.size).toBeGreaterThan(490);
  });

  it('accepts the code however the member types it back', () => {
    const code = newCode();
    expect(normaliseCode(code.toLowerCase())).toBe(code);
    expect(normaliseCode(code.replace('-', ''))).toBe(code);
    expect(normaliseCode(`  ${code}  `)).toBe(code);
    expect(normaliseCode(code.replace('-', ' '))).toBe(code);
  });

  it('rejects anything of the wrong length rather than guessing', () => {
    expect(normaliseCode('ABC')).toBe('');
    expect(normaliseCode('')).toBe('');
    expect(normaliseCode('AAAA-BBBB-CCCC')).toBe('');
  });
});

describe('the polling secret', () => {
  it('is long, unguessable, and stored only as a hash', () => {
    const secret = newPollSecret();
    expect(secret.length).toBeGreaterThanOrEqual(40);

    const hash = hashSecret(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // The hash must not be reversible to the secret by containing it.
    expect(hash).not.toContain(secret);
    expect(hashSecret(secret)).toBe(hash);
    expect(hashSecret(newPollSecret())).not.toBe(hash);
  });
});

describe('pollState', () => {
  const pending = { approvedAt: null, expiresAt: ahead(60_000), collectedAt: null, tokenOnce: null };

  it('waits while nobody has approved', () => {
    expect(pollState(pending, NOW)).toEqual({ status: 'pending' });
  });

  it('expires an unapproved link', () => {
    expect(pollState({ ...pending, expiresAt: ago(1) }, NOW)).toEqual({ status: 'expired' });
  });

  it('hands over the token once approved', () => {
    const approved = {
      approvedAt: ago(1_000),
      expiresAt: ago(1),
      collectedAt: null,
      tokenOnce: 'gsq_abc',
    };
    // Note the link itself has expired — approval is what matters from here, not the approval
    // window. A member who approved with two seconds to spare must still get a working app.
    expect(pollState(approved, NOW)).toEqual({ status: 'approved', token: 'gsq_abc' });
  });

  it('MANDATORY: never hands the same token over twice', () => {
    /*
     * The failure this exists to stop. A token that can be collected twice is a token that can be
     * collected by whoever polls second — and nothing about the first collection would look wrong.
     */
    const collected = {
      approvedAt: ago(1_000),
      expiresAt: ahead(60_000),
      collectedAt: ago(500),
      tokenOnce: 'gsq_abc',
    };
    expect(pollState(collected, NOW)).toEqual({ status: 'gone' });
  });

  it('MANDATORY: drops an approval nobody collected', () => {
    // Most likely a member who approved something they did not start. The token must not sit there
    // waiting for whoever did.
    const stale = {
      approvedAt: ago(COLLECT_TTL_MS + 1_000),
      expiresAt: ahead(60_000),
      collectedAt: null,
      tokenOnce: 'gsq_abc',
    };
    expect(pollState(stale, NOW)).toEqual({ status: 'gone' });
  });

  it('does not report approved with no token to give', () => {
    const empty = { approvedAt: ago(1_000), expiresAt: ahead(60_000), collectedAt: null, tokenOnce: null };
    expect(pollState(empty, NOW)).toEqual({ status: 'gone' });
  });
});

describe('canApprove', () => {
  it('allows a pending link inside its window', () => {
    expect(canApprove({ approvedAt: null, expiresAt: ahead(60_000) }, NOW)).toBe(true);
  });

  it('refuses an expired one', () => {
    expect(canApprove({ approvedAt: null, expiresAt: ago(1) }, NOW)).toBe(false);
  });

  it('MANDATORY: refuses to approve the same link twice', () => {
    /*
     * A second approval mints a second device for one request. The app can only collect one, so the
     * other exists, counts against the five-device limit, and is never used by anything — a ghost
     * the member cannot explain and would reasonably read as their account being used elsewhere.
     */
    expect(canApprove({ approvedAt: ago(1_000), expiresAt: ahead(60_000) }, NOW)).toBe(false);
  });
});
