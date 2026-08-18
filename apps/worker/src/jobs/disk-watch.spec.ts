import { describe, expect, it } from 'vitest';
import { judgeDisk, NO_MEMORY, REPEAT_AFTER_HOURS, type DiskMemory } from './disk-watch.js';

/**
 * Saying the disk is low — once.
 *
 * ★ THE FAILURE THIS COMES FROM — 2026-08-18 ★
 *
 * The ingestion box reached zero bytes free. The janitor had run, had cleaned what it could, had
 * noticed it was still tight, and had printed its alarm into a log file on a box with no operator.
 * The first anybody knew was a deploy dying on "no space left on device".
 *
 * ★ AND THE FAILURE THIS MUST NOT BECOME ★
 *
 * A job that posts "the disk is low" every six hours for a week is the same failure wearing a
 * different hat: everybody learns to scroll past it, and the notice that matters arrives in a
 * stream of identical ones nobody reads.
 *
 * So most of these tests assert SILENCE. That is the hard part and the valuable part.
 */

const HOST = 'ingestion';
const READING = (freeGb: number) => ({ freeGb, comfortableGb: 40, host: HOST });

const T0 = new Date('2026-08-18T00:00:00.000Z');
const hoursAfter = (h: number): Date => new Date(T0.getTime() + h * 3_600_000);

describe('deciding whether the squadron hears about the disk', () => {
  it('says nothing at all when there is room', () => {
    const out = judgeDisk(READING(120), NO_MEMORY, T0);
    expect(out.kind).toBe('quiet');
  });

  it('★ MANDATORY: raises it the first time it drops below the line ★', () => {
    const out = judgeDisk(READING(8), NO_MEMORY, T0);

    expect(out.kind).toBe('alarm');
    expect(out.memory.alarming).toBe(true);
    expect(out.memory.announcedAt).toBe(T0.toISOString());
  });

  it('★ MANDATORY: does not say it again the next time it runs ★', () => {
    /*
     * The whole point. The janitor runs nightly and this watcher runs far more often; without this
     * rule a single unresolved problem would post a notice on every pass until somebody fixed it,
     * and the useful first message would be buried under its own copies.
     */
    const first = judgeDisk(READING(8), NO_MEMORY, T0);
    const later = judgeDisk(READING(8), first.memory, hoursAfter(6));

    expect(later.kind).toBe('quiet');
    // And it remembers, so the repeat window is measured from the FIRST notice rather than sliding
    // forward on every silent pass — which would mean it never repeats at all.
    expect(later.memory.announcedAt).toBe(T0.toISOString());
  });

  it(`raises it again after ${REPEAT_AFTER_HOURS}h, because a forgotten one should resurface`, () => {
    const first = judgeDisk(READING(8), NO_MEMORY, T0);
    const again = judgeDisk(READING(8), first.memory, hoursAfter(REPEAT_AFTER_HOURS + 1));

    expect(again.kind).toBe('alarm');
    expect(again.memory.announcedAt).toBe(hoursAfter(REPEAT_AFTER_HOURS + 1).toISOString());
  });

  it('★ MANDATORY: says so once when it recovers, then goes quiet ★', () => {
    /*
     * A squadron told the disk was full deserves to be told it is not. Without it the NEXT alarm
     * reads as the same unresolved one still going, and nobody can tell a new problem from an old
     * one nobody closed.
     */
    const alarmed: DiskMemory = { alarming: true, announcedAt: T0.toISOString() };

    const recovered = judgeDisk(READING(120), alarmed, hoursAfter(2));
    expect(recovered.kind).toBe('recovered');
    expect(recovered.memory.alarming).toBe(false);

    // And not a second time.
    const after = judgeDisk(READING(120), recovered.memory, hoursAfter(3));
    expect(after.kind).toBe('quiet');
  });

  it('the message names the host, the number, and what it is NOT', () => {
    /*
     * "Disk low" with no host is useless when there are two boxes. And the message must say the
     * janitor has already cleared what it can — otherwise the first response is to run the cleanup
     * that has already run, and the real cause goes another day unlooked-at.
     */
    const out = judgeDisk(READING(8), NO_MEMORY, T0);
    if (out.kind !== 'alarm') throw new Error('expected an alarm');

    expect(out.message).toContain(HOST);
    expect(out.message).toContain('8G');
    expect(out.message).toContain('not old Docker images');
  });

  it('treats exactly at the line as fine, and one below as not', () => {
    // An off-by-one here means either a permanent alarm or one that never fires.
    expect(judgeDisk(READING(40), NO_MEMORY, T0).kind).toBe('quiet');
    expect(judgeDisk(READING(39), NO_MEMORY, T0).kind).toBe('alarm');
  });
});
