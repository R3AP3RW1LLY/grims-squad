import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWLEDGE_SOURCES, REFRESH_HOURS, type KnowledgeSource } from '@grims/shared';

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

/**
 * How often a five-field cron expression fires, in hours.
 *
 * Only the shapes this file uses are understood: a fixed time, a step interval on the hour or day,
 * and a bare wildcard. Anything more exotic returns null and is reported rather than guessed at,
 * because a schedule this test cannot read is a schedule it cannot vouch for.
 *
 * (No step-interval syntax is written in this comment. The slash-star pair would end it — the same
 * trap as a backtick inside a template literal, which this codebase has hit three times.)
 */
function everyHours(expr: string): number | null {
  const [minute, hour] = expr.trim().split(/\s+/);
  if (minute === undefined || hour === undefined) return null;

  if (hour === '*') return minute.startsWith('*/') ? Number(minute.slice(2)) / 60 : 1;
  if (hour.startsWith('*/')) return Number(hour.slice(2));
  if (/^\d+$/.test(hour)) return 24;
  return null;
}

/** Every source named on an `ingest-knowledge.js` line, with that line's cadence. */
function scheduled(): Map<KnowledgeSource, number> {
  const found = new Map<KnowledgeSource, number>();

  for (const line of LINES) {
    const match = /ingest-knowledge\.js((?:\s+[a-z]+)+)/.exec(line);
    if (match?.[1] === undefined) continue;

    const hours = everyHours(line);
    if (hours === null) continue;

    for (const raw of match[1].trim().split(/\s+/)) {
      const source = raw as KnowledgeSource;
      if (!KNOWLEDGE_SOURCES.includes(source)) continue;
      // The most frequent line wins: a source listed twice runs at the shorter interval.
      const existing = found.get(source);
      if (existing === undefined || hours < existing) found.set(source, hours);
    }
  }

  return found;
}

/**
 * The one source with no cron line, on purpose.
 *
 * EDDN is a resident subscriber in its own container, not a job. It reports by closing a window
 * every fifteen minutes — see the note on `REFRESH_HOURS.eddn`, which is a deadline rather than a
 * schedule.
 */
const RESIDENT: readonly KnowledgeSource[] = ['eddn'];

describe('ingest schedule', () => {
  it('MANDATORY: every knowledge source is actually scheduled', () => {
    const runs = scheduled();
    const missing = KNOWLEDGE_SOURCES.filter(
      (s) => !RESIDENT.includes(s) && !runs.has(s),
    );

    expect(
      missing,
      `These sources have no ingest line in infra/cron/grims-worker, so they never run in ` +
        `production. An embed sweep is not an ingest: it embeds rows something else has to create.\n` +
        missing.map((m) => `  ${m}`).join('\n'),
    ).toEqual([]);
  });

  it('MANDATORY: nothing is scheduled less often than its own contract', () => {
    /*
     * The training page computes "overdue" from REFRESH_HOURS. A job scheduled less frequently than
     * that is overdue BY CONSTRUCTION — permanently, visibly, and with nothing broken to find.
     */
    const runs = scheduled();
    const tooSlow: string[] = [];

    for (const source of KNOWLEDGE_SOURCES) {
      if (RESIDENT.includes(source)) continue;
      const actual = runs.get(source);
      if (actual === undefined) continue; // covered by the test above
      const wanted = REFRESH_HOURS[source];
      if (actual > wanted) tooSlow.push(`${source}: runs every ${actual}h, contract says ${wanted}h`);
    }

    expect(tooSlow, `Scheduled slower than REFRESH_HOURS:\n${tooSlow.map((t) => `  ${t}`).join('\n')}`).toEqual([]);
  });

  it('MANDATORY: every scheduled source is a real one', () => {
    // A typo in the crontab is a job that runs, does nothing, and reports success.
    const named = LINES.flatMap((line) => {
      const m = /ingest-knowledge\.js((?:\s+[a-z]+)+)/.exec(line);
      return m?.[1] === undefined ? [] : m[1].trim().split(/\s+/);
    });

    const unknown = named.filter((n) => !(KNOWLEDGE_SOURCES as readonly string[]).includes(n));
    expect(unknown, `Not knowledge sources: ${unknown.join(', ')}`).toEqual([]);
  });
});
