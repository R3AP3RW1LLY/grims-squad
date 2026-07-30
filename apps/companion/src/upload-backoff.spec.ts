import { describe, it, expect } from 'vitest';
import {
  BACKOFF_MAX_MS,
  BACKOFF_START_MS,
  FRESH,
  UNAUTHORISED_BEFORE_BACKOFF,
  onProofOfLife,
  onSuccess,
  onUnauthorised,
  shouldSkip,
  statusLine,
} from './upload-backoff.js';

/**
 * The rules that replaced "give up on the first 401".
 *
 * ★ WHAT ACTUALLY HAPPENED ★
 *
 * On 2026-07-30 the companion app stopped uploading telemetry at 07:00 UTC and never resumed. The
 * process stayed alive; the settings poll went on authenticating with THE SAME TOKEN every five
 * minutes and returning 200 for thirteen hours. `device_tokens` has no expiry column, so the token
 * was never dead — one transient refusal hit `stopPolling()` and cleared the interval forever.
 *
 * These tests exist to make that specific mistake impossible to reintroduce quietly.
 */

const NOW = 1_700_000_000_000;

describe('a refused upload', () => {
  it('MANDATORY: one refusal does not stop anything', () => {
    /*
     * THE REGRESSION TEST. A single 401 during a deploy is normal. It used to cost every member
     * their entire session; it should cost one pass.
     */
    const state = onUnauthorised(FRESH, NOW);
    expect(shouldSkip(state, NOW)).toBe(false);
    expect(state.until).toBe(0);
  });

  it('backs off after consecutive refusals', () => {
    let state = FRESH;
    for (let i = 0; i < UNAUTHORISED_BEFORE_BACKOFF; i += 1) state = onUnauthorised(state, NOW);

    expect(shouldSkip(state, NOW)).toBe(true);
    expect(state.until).toBe(NOW + BACKOFF_START_MS);
  });

  it('doubles the delay, and stops doubling at the ceiling', () => {
    let state = FRESH;
    for (let i = 0; i < 40; i += 1) state = onUnauthorised(state, NOW);
    expect(state.delayMs).toBe(BACKOFF_MAX_MS);
  });

  it('MANDATORY: never stops trying, however long it has failed', () => {
    /*
     * The heart of it. However bad things get, there is always a time after which the next pass
     * uploads again — because a cleared interval is a state nothing can recover from without the
     * member noticing and restarting the app, and they did not notice for thirteen hours.
     */
    let state = FRESH;
    for (let i = 0; i < 100; i += 1) state = onUnauthorised(state, NOW);

    expect(state.until).toBeGreaterThan(NOW);
    expect(shouldSkip(state, state.until + 1)).toBe(false);
    expect(state.delayMs).toBeLessThanOrEqual(BACKOFF_MAX_MS);
  });
});

describe('recovering', () => {
  it('a successful pass clears everything', () => {
    let state = FRESH;
    for (let i = 0; i < 5; i += 1) state = onUnauthorised(state, NOW);
    expect(onSuccess()).toEqual(FRESH);
  });

  it('MANDATORY: proof of life from the settings poll clears the backoff', () => {
    /*
     * The settings poll authenticates with the same token against the same API. If it succeeds,
     * the credential is provably alive and the backoff rests on a conclusion already disproved.
     *
     * This is the single behaviour that would have self-healed the outage within five minutes,
     * which is why it is asserted rather than left as a comment in the main process.
     */
    let state = FRESH;
    for (let i = 0; i < 10; i += 1) state = onUnauthorised(state, NOW);
    expect(shouldSkip(state, NOW)).toBe(true);

    state = onProofOfLife();
    expect(shouldSkip(state, NOW)).toBe(false);
    expect(state.delayMs).toBe(0);
  });

  it('the next blip after recovery starts from the shortest delay again', () => {
    // Otherwise a member who has had one bad week is punished for it during the next good one.
    let state = onProofOfLife();
    for (let i = 0; i < UNAUTHORISED_BEFORE_BACKOFF; i += 1) state = onUnauthorised(state, NOW);
    expect(state.delayMs).toBe(BACKOFF_START_MS);
  });
});

describe('what the member is told', () => {
  it('MANDATORY: says it is not sending, rather than looking fine', () => {
    /*
     * Silence was the failure mode that hurt. The app looked connected and healthy for thirteen
     * hours while sending nothing, and the first anyone knew was the roster showing members
     * offline while they were in game.
     */
    let state = FRESH;
    for (let i = 0; i < UNAUTHORISED_BEFORE_BACKOFF; i += 1) state = onUnauthorised(state, NOW);

    const line = statusLine(state, NOW);
    expect(line).toContain('Not sending');
    expect(line).toMatch(/Trying again in/);
  });

  it('says nothing when everything is working', () => {
    // A permanent warning is a warning nobody reads.
    expect(statusLine(FRESH, NOW)).toBeNull();
  });

  it('counts down in minutes once the wait is long', () => {
    let state = FRESH;
    for (let i = 0; i < 8; i += 1) state = onUnauthorised(state, NOW);
    expect(statusLine(state, NOW)).toMatch(/min/);
  });
});
