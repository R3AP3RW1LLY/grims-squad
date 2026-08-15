import { describe, expect, it } from 'vitest';
import {
  ACTIVE_FLOOR_MS,
  IDLE_MS,
  START_MS,
  nextPoll,
  type PollState,
} from './capi-cadence.js';

/**
 * How often to ask Frontier for a commander's journal.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "can we increase the journal polling for active?"
 *
 * Yes — but two ceilings sit above that choice and only one of them is ours.
 *
 * ★ THE RATE LIMIT IS SHARED, AND SCALES WITH MEMBERSHIP ★
 *
 * Polling is per member; Frontier's limit is per CLIENT ID, across everybody. Twenty linked members
 * at five minutes is ~240 requests an hour. At sixty seconds it is ~1,200. Whatever interval is
 * chosen gets multiplied by however many people link, so a number that feels harmless at launch is
 * the number that throttles the squadron at fifty members.
 *
 * ★ AND FRONTIER REWRITES THE FILE ON THEIR SCHEDULE, NOT OURS ★
 *
 * Asking every thirty seconds for something regenerated every few minutes spends the shared limit
 * to receive identical bytes. Their exact cadence is not documented anywhere worth trusting, so it
 * is not guessed at here — it is MEASURED. Each poll reports whether the content changed, and the
 * interval walks toward whatever that turns out to be, per member.
 *
 * That is the whole design: a number nobody had to know in advance, and which stays right if
 * Frontier changes it.
 */

const at = (iso: string): Date => new Date(iso);

const state = (over: Partial<PollState> = {}): PollState => ({
  intervalMs: over.intervalMs ?? START_MS,
  unchangedInARow: over.unchangedInARow ?? 0,
  lastEntryAt: over.lastEntryAt === undefined ? at('2026-08-15T12:00:00Z') : over.lastEntryAt,
});

const NOW = at('2026-08-15T12:01:00Z'); // a minute after the last entry — actively flying

describe('an actively flying commander', () => {
  it('★ MANDATORY: content that changes every poll tightens toward the floor ★', () => {
    /*
     * The case the owner asked for. If Frontier really is producing new entries as fast as we ask,
     * asking faster is the correct response — up to a floor, because below that we are guaranteed
     * to be spending the shared limit on bytes we already have.
     */
    let s = state({ intervalMs: 120_000 });
    for (let i = 0; i < 5; i += 1) s = nextPoll(s, true, NOW);

    expect(s.intervalMs).toBe(ACTIVE_FLOOR_MS);
    expect(s.intervalMs).toBeGreaterThanOrEqual(60_000);
  });

  it('★ MANDATORY: it never goes below the floor, however hot the journal is ★', () => {
    // The shared rate limit is why this floor exists. One enthusiastic member must not spend it.
    let s = state({ intervalMs: ACTIVE_FLOOR_MS });
    for (let i = 0; i < 20; i += 1) s = nextPoll(s, true, NOW);

    expect(s.intervalMs).toBe(ACTIVE_FLOOR_MS);
  });

  it('★ MANDATORY: three unchanged polls in a row widen the interval ★', () => {
    /*
     * Three, not one. A single unchanged poll is ordinary — a commander in supercruise writes
     * nothing for a minute — and widening on it would oscillate forever between two intervals.
     */
    let s = state({ intervalMs: 60_000 });

    s = nextPoll(s, false, NOW);
    expect(s.intervalMs, 'one miss is not evidence').toBe(60_000);

    s = nextPoll(s, false, NOW);
    expect(s.intervalMs, 'nor is two').toBe(60_000);

    s = nextPoll(s, false, NOW);
    expect(s.intervalMs, 'three is a pattern').toBeGreaterThan(60_000);
  });

  it('★ MANDATORY: a change resets the patience counter ★', () => {
    // Otherwise two misses an hour apart would eventually widen a member who is flying constantly.
    let s = state({ intervalMs: 60_000 });
    s = nextPoll(s, false, NOW);
    s = nextPoll(s, false, NOW);
    s = nextPoll(s, true, NOW);

    expect(s.unchangedInARow).toBe(0);
  });

  it('MANDATORY: widening is capped while they are still flying', () => {
    // A commander who is demonstrably playing should not drift out to the idle interval just
    // because Frontier is slow to publish — they are the person most likely to want fresh data.
    let s = state({ intervalMs: 60_000 });
    for (let i = 0; i < 30; i += 1) s = nextPoll(s, false, NOW);

    expect(s.intervalMs).toBeLessThanOrEqual(START_MS);
  });
});

describe('when they stop', () => {
  it('★ MANDATORY: an hour of silence drops to the idle interval ★', () => {
    /*
     * The cost control. Most of a squadron is not playing at any given moment, and polling them
     * every two minutes is the whole rate limit spent on people who are asleep.
     */
    const s = nextPoll(state({ lastEntryAt: at('2026-08-15T10:00:00Z') }), false, NOW);
    expect(s.intervalMs).toBe(IDLE_MS);
  });

  it('MANDATORY: the middle band is neither fast nor asleep', () => {
    // Somebody who stopped twenty minutes ago may be at a station, not gone. Worth checking, not
    // worth checking every minute.
    const s = nextPoll(state({ lastEntryAt: at('2026-08-15T11:40:00Z') }), false, NOW);

    expect(s.intervalMs).toBeGreaterThan(START_MS);
    expect(s.intervalMs).toBeLessThan(IDLE_MS);
  });

  it('★ MANDATORY: a commander who has NEVER been seen is idle, not fast ★', () => {
    /*
     * A member who linked and never flew would otherwise be polled at the fast cadence for ever,
     * because "no entries recently" and "no entries at all" are the same absence.
     */
    const s = nextPoll(state({ lastEntryAt: null }), false, NOW);
    expect(s.intervalMs).toBe(IDLE_MS);
  });

  it('★ MANDATORY: new entries pull them straight back to fast ★', () => {
    // The moment somebody undocks after a day away, the next poll must not be half an hour later.
    const s = nextPoll(state({ lastEntryAt: null, intervalMs: IDLE_MS }), true, NOW);

    expect(s.intervalMs).toBeLessThanOrEqual(START_MS);
    expect(s.lastEntryAt?.toISOString()).toBe(NOW.toISOString());
  });
});

describe('the cost it implies', () => {
  it('MANDATORY: the floor keeps a single member under 60 requests an hour', () => {
    /*
     * Stated as a test because it is the number that matters when membership grows: whatever is
     * chosen here is multiplied by everybody who links.
     */
    const perHour = 3_600_000 / ACTIVE_FLOOR_MS;
    expect(perHour).toBeLessThanOrEqual(60);
  });

  it('MANDATORY: an idle member costs two requests an hour', () => {
    expect(3_600_000 / IDLE_MS).toBeLessThanOrEqual(2);
  });
});
