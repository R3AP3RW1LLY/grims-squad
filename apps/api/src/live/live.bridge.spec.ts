import { describe, it, expect } from 'vitest';
import { parseLiveMessage, LIVE_CHANNEL } from './live.bridge.js';

/**
 * The bridge accepts messages from ANOTHER PROCESS.
 *
 * Everything the API's own code puts on the live stream is type-checked at
 * compile time. This is the one entry point where an event arrives as a string
 * written by a different container, so it is the one place where a malformed or
 * unexpected message is a real possibility rather than a theoretical one.
 */
describe('parseLiveMessage', () => {
  it('accepts a well-formed member event', () => {
    expect(parseLiveMessage('{"type":"verification","userId":"u1"}')).toEqual({
      type: 'verification',
      userId: 'u1',
    });
  });

  it('accepts an explicitly squadron-wide event', () => {
    expect(parseLiveMessage('{"type":"roster","userId":null}')).toEqual({
      type: 'roster',
      userId: null,
    });
  });

  /*
   * ★ THE ONE THAT MATTERS ★
   *
   * A job that forgot the field would otherwise be treated as squadron-wide and
   * tell every connected browser that a particular member's verification just
   * changed. "Everybody" and "we did not say" must not be the same message —
   * broadcasting is a choice, never a default that a typo can reach.
   */
  it('REFUSES an event with no userId rather than broadcasting it', () => {
    expect(parseLiveMessage('{"type":"verification"}')).toBeNull();
  });

  it('refuses a userId that is not a string', () => {
    expect(parseLiveMessage('{"type":"verification","userId":42}')).toBeNull();
    expect(parseLiveMessage('{"type":"verification","userId":{"id":"u1"}}')).toBeNull();
  });

  /*
   * An allow-list, not a cast. A typo in a job name would otherwise put an
   * event on the stream that no page listens for — and the job would look like
   * it had worked, which is the failure mode that hides for months.
   */
  it('refuses an event type nothing subscribes to', () => {
    expect(parseLiveMessage('{"type":"promotion","userId":"u1"}')).toBeNull();
    expect(parseLiveMessage('{"type":"","userId":"u1"}')).toBeNull();
  });

  it('survives anything that is not an event', () => {
    for (const junk of ['', 'null', 'not json', '[]', '"verification"', '{}', '123']) {
      expect(parseLiveMessage(junk)).toBeNull();
    }
  });

  /*
   * The worker hard-codes this string, because importing across app boundaries
   * would make the worker depend on the API. A test on both sides is what keeps
   * two copies of one constant honest.
   */
  it('publishes on the channel the worker writes to', () => {
    expect(LIVE_CHANNEL).toBe('grims:live');
  });
});
