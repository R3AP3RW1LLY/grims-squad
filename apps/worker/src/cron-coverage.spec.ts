import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWLEDGE_SOURCES, REFRESH_HOURS } from '@grims/shared';

/**
 * Does the crontab actually run what the contract says it runs?
 *
 * ★ THE BUG THIS EXISTS TO STOP, WHICH HAD ALREADY HAPPENED ★
 *
 * On 2026-08-01 the squadron owner reported "a lot of ingestions that are overdue" and they were:
 *
 *   journal, forum, reference   NO ingest line at all. All three had EMBED sweeps — one every
 *                               three minutes — embedding rows that nothing ever created.
 *   coriolis                    scheduled DAILY against a contract cadence of three hours, so the
 *                               training page correctly called it overdue for 21 hours in every 24.
 *
 * Nothing failed. No job errored, no log line appeared, and every test passed. `REFRESH_HOURS` and
 * `infra/cron/grims-worker` are two independent statements of the same schedule, in two languages,
 * and there was nothing whatsoever holding them together.
 *
 * That is what this file is: the join between them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CRON = readFileSync(join(HERE, '../../../infra/cron/grims-worker'), 'utf8');

/** Lines that actually run something, with comments and blanks dropped. */
const LINES = CRON.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

describe('ingest schedule', () => {
  /*
   * ★ THIS FILE USED TO CHECK THE WRONG THING, AND PASSED THE WHOLE TIME ★
   *
   * It asserted that `infra/cron/grims-worker` named every knowledge source at a cadence no slower
   * than `REFRESH_HOURS`. It did. The file was correct and completely inert: a crontab has to be
   * installed on the host by hand, it never was in production, and there is no cron on a
   * developer's machine at all.
   *
   * So every source was overdue for weeks with a green test watching it. The test proved a FILE
   * said the right thing, which had nothing to do with whether anything ran — reported by the
   * squadron owner on 2026-08-01 as "these are clearly not triggering".
   *
   * The schedule now lives in the worker daemon (`scheduler.ts`), driven by the same REFRESH_HOURS
   * the training page reports from. `scheduler.spec.ts` tests the running behaviour.
   *
   * What is left here is the other half of that decision: making sure the crontab does not schedule
   * them TOO. Two schedulers against one advisory lock means half the runs are started only to be
   * declined — noise in the log, and a permanent question about which one is really driving the
   * cadence.
   */
  it('MANDATORY: the crontab does not schedule ingests — the worker does', () => {
    const ingestLines = LINES.filter((l) => l.includes('ingest-knowledge'));

    expect(
      ingestLines,
      'These lines schedule knowledge ingests from cron, which the worker daemon now does itself. ' +
        'Two schedulers against one advisory lock means half the runs are declined:\n' +
        ingestLines.map((l) => `  ${l.slice(0, 90)}`).join('\n'),
    ).toEqual([]);
  });

  it('MANDATORY: every source is scheduled SOMEWHERE, and that somewhere is the daemon', () => {
    /*
     * The rule the old tests were reaching for, pointed at the thing that actually runs. A source
     * absent from `REFRESH_HOURS` would never be scheduled by the daemon and nothing would say so.
     */
    const missing = KNOWLEDGE_SOURCES.filter((s) => typeof REFRESH_HOURS[s] !== 'number');
    expect(missing, `No refresh cadence: ${missing.join(', ')}`).toEqual([]);
  });

  it('the jobs that are NOT ingests are still here', () => {
    /*
     * Embeds, the promotion run, role sync, the audit and the media sweep have no equivalent in the
     * daemon and are genuinely cron's job. If this file were emptied by a future tidy-up they would
     * stop with nothing reporting it — which is precisely how the ingests failed.
     */
    for (const job of ['embed.js', 'promote.js', 'role-sync.js', 'daily-audit.js', 'sweep-orphan-media.js']) {
      expect(LINES.some((l) => l.includes(job)), `${job} is no longer scheduled`).toBe(true);
    }
  });
});
