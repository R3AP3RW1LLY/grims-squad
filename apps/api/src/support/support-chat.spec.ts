import { describe, expect, it } from 'vitest';
import {
  GUEST_NAME_MAX_CHARS,
  MESSAGE_MAX_CHARS,
  SUBJECT_MAX_CHARS,
  cleanGuestName,
  cleanMessageBody,
  cleanSubject,
  hashGuestToken,
  newGuestToken,
  postingProblem,
  systemLineFor,
  transitionProblem,
} from './support-chat.js';

/**
 * The chat's rules, driven directly — the reason they are pure. The token discipline is the
 * guest door's entire security, and the state machine is what "closed" means; both have to be
 * exercisable without a database or they are rules nobody exercises.
 */

describe('the guest token', () => {
  it('is long, prefixed, and unguessable-shaped', () => {
    const token = newGuestToken();
    expect(token.startsWith('gsup_')).toBe(true);
    // 32 bytes of base64url on top of the prefix.
    expect(token.length).toBeGreaterThanOrEqual(45);
  });

  it('does not repeat itself', () => {
    // Not a proof of entropy — but a mint that returned a constant would pass every other test.
    const seen = new Set(Array.from({ length: 500 }, () => newGuestToken()));
    expect(seen.size).toBe(500);
  });

  it('MANDATORY: hashes one way, deterministically, without containing the token', () => {
    const token = newGuestToken();
    const hash = hashGuestToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashGuestToken(token)).toBe(hash);
    expect(hashGuestToken(newGuestToken())).not.toBe(hash);
  });
});

describe('the message cap', () => {
  it('accepts a message of exactly the cap', () => {
    const cleaned = cleanMessageBody('a'.repeat(MESSAGE_MAX_CHARS));
    expect('body' in cleaned).toBe(true);
  });

  it('MANDATORY: refuses one character past it, and says both numbers', () => {
    const cleaned = cleanMessageBody('a'.repeat(MESSAGE_MAX_CHARS + 1));
    expect(cleaned).toMatchObject({ problem: expect.stringContaining('4,000') });
  });

  it('measures what the member sees, not their line endings', () => {
    // \r\n normalised BEFORE the cap, so a Windows paste is not judged longer than it looks.
    const body = 'a\r\n'.repeat(1500); // 4500 raw characters, 3000 once \r\n becomes \n
    const cleaned = cleanMessageBody(body);
    expect('body' in cleaned).toBe(true);
  });

  it('refuses emptiness in all its forms', () => {
    for (const raw of ['', '   ', '\n\n', undefined, null, 42]) {
      expect(cleanMessageBody(raw)).toMatchObject({ problem: 'Write a message first.' });
    }
  });
});

describe('the guest name and the subject', () => {
  it('requires a name — the widget asks what to call them first', () => {
    expect(cleanGuestName('')).toMatchObject({ problem: expect.stringContaining('call you') });
    expect(cleanGuestName(undefined)).toMatchObject({ problem: expect.any(String) });
    expect(cleanGuestName('  CMDR Halsey  ')).toEqual({ name: 'CMDR Halsey' });
  });

  it('bounds both rather than refusing them', () => {
    // A too-long name is somebody typing their question in the wrong box. Keep the head.
    const named = cleanGuestName('x'.repeat(200));
    expect('name' in named && named.name.length).toBe(GUEST_NAME_MAX_CHARS);
    expect(cleanSubject('y'.repeat(500))?.length).toBe(SUBJECT_MAX_CHARS);
    expect(cleanSubject('   ')).toBeNull();
    expect(cleanSubject(undefined)).toBeNull();
  });
});

describe('the state machine', () => {
  it('MANDATORY: posting is legal into open and into nothing else', () => {
    expect(postingProblem('open')).toBeNull();
    expect(postingProblem('closed')).toMatch(/closed/i);
  });

  it('MANDATORY: every close/reopen edge answers, and the illegal ones say why', () => {
    /*
     * Walked as a matrix rather than spot-checked. Two states and two actions is four edges,
     * and the one somebody breaks later is the one a spot-check did not name.
     */
    expect(transitionProblem('open', 'close')).toBeNull();
    expect(transitionProblem('closed', 'reopen')).toBeNull();
    expect(transitionProblem('closed', 'close')).toMatch(/already closed/i);
    expect(transitionProblem('open', 'reopen')).toMatch(/already open/i);
  });

  it('the room announces both transitions in its own voice', () => {
    expect(systemLineFor('close')).toBe('This conversation was closed.');
    expect(systemLineFor('reopen')).toBe('This conversation was reopened.');
  });
});
