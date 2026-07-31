import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { KNOWLEDGE_SOURCES } from '@grims/shared';
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
    // galaxy refreshes every 24h; it finished 5h ago, so 19h remain.
    const svc = new TrainingStatusService(
      fakeDb(
        [{ source: 'galaxy', n: 448_893n }],
        [{ source: 'galaxy', last_at: new Date('2026-08-01T07:00:00Z'), error: null, started_at: null }],
      ),
    );

    const galaxy = (await svc.status(NOW)).find((r) => r.source === 'galaxy');

    expect(galaxy?.rows).toBe(448_893);
    expect(galaxy?.nextInHours).toBe(19);
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
  it('reports a recent unfinished run as running', async () => {
    // Started twenty minutes ago and still going. The galaxy import legitimately takes a while.
    const svc = new TrainingStatusService(
      fakeDb(
        [],
        [{ source: 'galaxy', last_at: null, error: null, started_at: new Date('2026-08-01T11:40:00Z') }],
      ),
    );

    const galaxy = (await svc.status(NOW)).find((r) => r.source === 'galaxy');

    expect(galaxy?.ingesting).toBe(true);
    expect(galaxy?.lastError).toBeNull();
  });

  it('MANDATORY: reports an OLD unfinished run as stalled, not as running', async () => {
    /*
     * ★ THE BUG THIS EXISTS FOR ★
     *
     * "Running = started and never finished" was the original rule, on the reasoning that a crashed
     * job is still unfinished and saying so beats claiming a completion that never happened. Right
     * about the ambiguity, wrong about the remedy: the row never goes away, so the page said
     * "Training now" forever. Reported by the squadron owner with two sources showing it and
     * nothing running anywhere.
     *
     * A stall is the state most in need of a human — it is invisible in every log, because nothing
     * errored. So it is reported AS an error, with the message the dead job never wrote.
     */
    const svc = new TrainingStatusService(
      fakeDb(
        [],
        [{ source: 'galaxy', last_at: null, error: null, started_at: new Date('2026-07-30T11:00:00Z') }],
      ),
    );

    const galaxy = (await svc.status(NOW)).find((r) => r.source === 'galaxy');

    expect(galaxy?.ingesting).toBe(false);
    expect(galaxy?.lastError).toContain('never finished');
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
          },
        ],
      ),
    );

    const inara = (await svc.status(NOW)).find((r) => r.source === 'inara');

    expect(inara?.lastError).toContain('never finished');
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
