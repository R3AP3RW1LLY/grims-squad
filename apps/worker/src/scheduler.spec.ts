import { describe, expect, it } from 'vitest';
import { dueSources, RESIDENT, TICK_MS, type LastRun } from './scheduler.js';
import { KNOWLEDGE_SOURCES, REFRESH_HOURS, type KnowledgeSource } from '@grims/shared';

/**
 * Whether an ingest runs.
 *
 * ★ THE FAILURE THIS EXISTS TO STOP HAD BEEN RUNNING FOR WEEKS ★
 *
 * Every source was overdue and nothing was wrong with any of them: the schedule lived in a crontab
 * that was never installed, and the worker did nothing on its own. `cron-coverage.spec.ts` asserted
 * that the crontab FILE named every source at a fast enough cadence, and passed throughout — a
 * perfect test of a file that was not being used.
 *
 * These are about the running system, and every case below is one where getting it wrong produces
 * silence rather than an error.
 */

const NOW = new Date('2026-08-01T12:00:00Z').getTime();
const hoursAgo = (h: number): Date => new Date(NOW - h * 3_600_000);

/** Everything finished a moment ago, so nothing is due unless a case says so. */
function fresh(over: Partial<Record<KnowledgeSource, LastRun>> = {}): LastRun[] {
  return KNOWLEDGE_SOURCES.map(
    (source) => over[source] ?? { source, finishedAt: hoursAgo(0), running: false },
  );
}

describe('what the owner asked for', () => {
  it('MANDATORY: roster, guides and forum answers run every 30 minutes', () => {
    // "these need to run automatically every 30 minutes" — 2026-08-01.
    for (const source of ['inara', 'reference', 'forum'] as const) {
      expect(REFRESH_HOURS[source], source).toBe(0.5);
    }
  });

  it('MANDATORY: flight logs, ships/modules and systems run every hour', () => {
    // "these need to run every hour automatically" — 2026-08-01.
    for (const source of ['journal', 'coriolis', 'galaxy'] as const) {
      expect(REFRESH_HOURS[source], source).toBe(1);
    }
  });

  it('the scheduler looks more often than the shortest cadence', () => {
    // A tick slower than a cadence makes every run late by up to the difference, for ever.
    const shortest = Math.min(...KNOWLEDGE_SOURCES.map((s) => REFRESH_HOURS[s])) * 3_600_000;
    expect(TICK_MS).toBeLessThan(shortest);
  });
});

describe('dueSources', () => {
  it('nothing is due right after a run', () => {
    expect(dueSources(fresh(), NOW)).toEqual([]);
  });

  it('a source past its cadence is due', () => {
    const due = dueSources(fresh({ inara: { source: 'inara', finishedAt: hoursAgo(1), running: false } }), NOW);
    expect(due).toEqual(['inara']);
  });

  it('MANDATORY: a source that has NEVER run is due immediately', () => {
    /*
     * A fresh deployment has no completed run for anything. Treating null as "not yet due" measures
     * the schedule from a run that never happened, and the platform sits empty waiting for it.
     */
    const due = dueSources(fresh({ galaxy: { source: 'galaxy', finishedAt: null, running: false } }), NOW);
    expect(due).toEqual(['galaxy']);
  });

  it('MANDATORY: a source already running is not started again', () => {
    /*
     * The galaxy ingest streams a nine-gigabyte dump and takes about two hours — longer than its own
     * cadence. Without this, every tick after the first hour starts another one, and they pile up
     * writing the same rows and slowing each other down.
     */
    const due = dueSources(
      fresh({ galaxy: { source: 'galaxy', finishedAt: hoursAgo(48), running: true } }),
      NOW,
    );
    expect(due).not.toContain('galaxy');
  });

  it('MANDATORY: EDDN is never scheduled', () => {
    /*
     * A resident subscriber in its own container, not a job. It has no run to start — it closes a
     * reporting window every fifteen minutes, and its REFRESH_HOURS is an alarm rather than a
     * schedule. Starting an "eddn ingest" would be starting nothing, once a minute, for ever.
     */
    const due = dueSources(
      fresh({ eddn: { source: 'eddn', finishedAt: null, running: false } }),
      NOW,
    );
    expect(due).not.toContain('eddn');
    expect(RESIDENT).toContain('eddn');
  });

  it('★ MANDATORY: companion is never scheduled either ★', () => {
    /*
     * ★ A SURVIVING MUTATION, 2026-08-22 ★
     *
     * Removing `companion` from RESIDENT failed nothing. The guard existed and no test held it
     * down, so a later edit could have quietly restored the exact behaviour the list prevents:
     * starting a "companion ingest" that starts nothing, for ever.
     *
     * Paired companions PUSH systems as members fly them. There is no run to begin. Its
     * REFRESH_HOURS is a staleness alarm — 24 hours with nothing reported means the pairing path
     * has stopped — and an alarm threshold must never be read as a schedule.
     *
     * `finishedAt: null` is the hard case: a source that has NEVER run is otherwise due
     * immediately, so this is where a missing RESIDENT entry shows up first.
     */
    const due = dueSources(
      fresh({ companion: { source: 'companion', finishedAt: null, running: false } }),
      NOW,
    );
    expect(due, 'nothing pulls companion data — it arrives on its own').not.toContain('companion');
    expect(RESIDENT).toContain('companion');
  });

  it('every non-resident source is schedulable', () => {
    // If a source were absent from the loop it would never run and nothing would report it.
    const everythingStale = KNOWLEDGE_SOURCES.map((source) => ({ source, finishedAt: null, running: false }));
    const due = dueSources(everythingStale, NOW);

    for (const source of KNOWLEDGE_SOURCES) {
      if (RESIDENT.includes(source)) continue;
      expect(due, `${source} is never scheduled`).toContain(source);
    }
  });

  it('a source exactly at its cadence is due, not one tick later', () => {
    // `>=`, not `>`. At a minute per tick, `>` makes every source permanently a minute late.
    const due = dueSources(
      fresh({ forum: { source: 'forum', finishedAt: new Date(NOW - REFRESH_HOURS.forum * 3_600_000), running: false } }),
      NOW,
    );
    expect(due).toContain('forum');
  });
});
