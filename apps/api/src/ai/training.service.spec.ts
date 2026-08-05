import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { KNOWLEDGE_SOURCES, REFRESH_HOURS } from '@grims/shared';
import { TrainingStatusService } from './training.service.js';

/**
 * The training page's data.
 *
 * ★ WHAT THESE GUARD ★
 *
 * Three jobs on this platform were written, tested, merged — and had never once executed. No cron,
 * no timer, no container. The symptom was a source with no rows, which is indistinguishable from a
 * source that is simply new, and neither raised anything. This page exists to tell those apart, so
 * the tests are about the DISTINCTIONS rather than about the numbers.
 */

/** Answers the two queries the service makes, in order. */
function fakeDb(counts: unknown[], runs: unknown[]): PrismaClient {
  let call = 0;
  return {
    $queryRawUnsafe: async () => {
      call += 1;
      return call === 1 ? counts : runs;
    },
  } as unknown as PrismaClient;
}

const NOW = new Date('2026-08-01T12:00:00Z');

describe('every source is accounted for', () => {
  it('lists sources that have never run, rather than omitting them', async () => {
    /*
     * ★ THE FAILURE THIS EXISTS FOR ★
     *
     * Returning only sources present in the tables would render a tidy page that silently omitted
     * the one nobody had wired up — which is exactly the state that went unnoticed for weeks.
     */
    const svc = new TrainingStatusService(fakeDb([], []));

    const rows = await svc.status(NOW);

    expect(rows.map((r) => r.source)).toEqual([...KNOWLEDGE_SOURCES]);
    for (const r of rows) {
      expect(r.rows).toBe(0);
      expect(r.lastIngestedAt).toBeNull();
      expect(r.ingesting).toBe(false);
      // Null, not zero. "Never run" has no next cycle to report, and a 0 would render as due now.
      expect(r.nextInHours).toBeNull();
    }
  });

  it('separates never-run from failed', async () => {
    // Both leave a source empty and they need opposite reactions: one is unset up, one is broken.
    const svc = new TrainingStatusService(
      fakeDb(
        [],
        [{ source: 'inara', last_at: new Date('2026-08-01T05:00:00Z'), error: 'HTTP 401', started_at: null }],
      ),
    );

    const rows = await svc.status(NOW);
    const inara = rows.find((r) => r.source === 'inara');
    const forum = rows.find((r) => r.source === 'forum');

    expect(inara?.lastError).toBe('HTTP 401');
    expect(inara?.lastIngestedAt).not.toBeNull();
    expect(forum?.lastError).toBeNull();
    expect(forum?.lastIngestedAt).toBeNull();
  });
});

describe('the next cycle', () => {
  it('reports hours remaining from the last finish', async () => {
    /*
     * ★ DERIVED FROM THE CONTRACT, NOT WRITTEN DOWN ★
     *
     * This used to say "galaxy refreshes every 24h; it finished 5h ago, so 19h remain" with a
     * hard-coded 19. On 2026-08-01 the squadron owner moved galaxy to hourly and the test failed on
     * a change that was entirely correct — the arithmetic was right and the constant had moved.
     *
     * A test that has to be edited every time a cadence changes teaches people to edit it without
     * reading it. Taking the cadence from `REFRESH_HOURS` tests the CALCULATION, which is the part
     * that could actually be wrong.
     */
    const finishedHoursAgo = 0.5;
    const finishedAt = new Date(NOW.getTime() - finishedHoursAgo * 3_600_000);

    const svc = new TrainingStatusService(
      fakeDb(
        [{ source: 'galaxy', n: 448_893n }],
        [{ source: 'galaxy', last_at: finishedAt, error: null, started_at: null }],
      ),
    );

    const galaxy = (await svc.status(NOW)).find((r) => r.source === 'galaxy');

    expect(galaxy?.rows).toBe(448_893);
    // Not rounded: the service reports the real remainder, and the page formats it.
    expect(galaxy?.nextInHours).toBe(REFRESH_HOURS.galaxy - finishedHoursAgo);
  });

  it('reports overdue as NEGATIVE rather than clamping it to zero', async () => {
    /*
     * "4 hours overdue" and "due now" need different reactions from an officer, and a clamp hides
     * the first behind the second.
     */
    const svc = new TrainingStatusService(
      fakeDb([], [{ source: 'galaxy', last_at: new Date('2026-07-31T08:00:00Z'), error: null, started_at: null }]),
    );

    const galaxy = (await svc.status(NOW)).find((r) => r.source === 'galaxy');

    expect(galaxy?.nextInHours).toBeLessThan(0);
  });
});

describe('unfinished means two different things', () => {
  it('reports a run that is still writing as running, however long it has been going', async () => {
    /*
     * Started two hours ago and wrote a batch a minute ago. Judged on START it would look
     * suspicious; judged on PROGRESS it is obviously alive — which is the whole change.
     */
    const svc = new TrainingStatusService(
      fakeDb(
        [],
        [
          {
            source: 'galaxy',
            last_at: null,
            error: null,
            started_at: new Date('2026-08-01T10:00:00Z'),
            progress_at: new Date('2026-08-01T11:59:00Z'),
          },
        ],
      ),
    );

    const galaxy = (await svc.status(NOW)).find((r) => r.source === 'galaxy');

    expect(galaxy?.ingesting).toBe(true);
    expect(galaxy?.lastError).toBeNull();
  });

  it('MANDATORY: reports a SILENT run as stalled, however recently it started', async () => {
    /*
     * ★ THE BUG THIS EXISTS FOR ★
     *
     * The first rule was "started and never finished", which never stopped being true, so the page
     * said "Training now" for ever. The second was "started over six hours ago" — better, and still
     * measured from the wrong end: with no evidence of work, slow and dead read identically, so the
     * threshold had to clear the slowest job imaginable and a crashed import claimed to be training
     * for the rest of the day.
     *
     * Measured from the last BATCH, it takes fifteen minutes to be certain. This run started only
     * twenty minutes ago — recent by any start-based rule — and has written nothing for eighteen.
     * It is dead.
     */
    const svc = new TrainingStatusService(
      fakeDb(
        [],
        [
          {
            source: 'galaxy',
            last_at: null,
            error: null,
            started_at: new Date('2026-08-01T11:40:00Z'),
            progress_at: new Date('2026-08-01T11:42:00Z'),
          },
        ],
      ),
    );

    const galaxy = (await svc.status(NOW)).find((r) => r.source === 'galaxy');

    expect(galaxy?.ingesting).toBe(false);
    expect(galaxy?.lastError).toContain('No progress');
  });

  it('keeps the previous failure alongside a stall', async () => {
    // A source that failed and then stalled has two things wrong with it, and an officer chasing
    // the second needs the first.
    const svc = new TrainingStatusService(
      fakeDb(
        [],
        [
          {
            source: 'inara',
            last_at: new Date('2026-07-29T05:00:00Z'),
            error: 'HTTP 401',
            started_at: new Date('2026-07-30T05:00:00Z'),
            progress_at: new Date('2026-07-30T05:00:00Z'),
          },
        ],
      ),
    );

    const inara = (await svc.status(NOW)).find((r) => r.source === 'inara');

    expect(inara?.lastError).toContain('No progress');
    expect(inara?.lastError).toContain('HTTP 401');
  });
});

describe('an error never arrives unbounded', () => {
  it('trims a stack trace to something a table cell can hold', async () => {
    const svc = new TrainingStatusService(
      fakeDb([], [{ source: 'galaxy', last_at: NOW, error: 'x'.repeat(5_000), started_at: null }]),
    );

    const galaxy = (await svc.status(NOW)).find((r) => r.source === 'galaxy');

    expect(galaxy?.lastError?.length).toBe(300);
  });
});
