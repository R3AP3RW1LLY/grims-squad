import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import {
  KNOWLEDGE_SOURCES,
  nextInHours,
  type KnowledgeSource,
  type SourceStatus,
} from '@grims/shared';

/**
 * What GMSD AI has learned, what it is learning, and when it next will.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "show the ingestion categories, if it has been trained, if it is training, and when the next
 * ingestion cycle will be in hours."
 *
 * ★ EVERY SOURCE IS LISTED, INCLUDING THE ONES THAT HAVE NEVER RUN ★
 *
 * Returning only the sources with rows would hide the ones that matter most. A source that has
 * never ingested and a source that is working perfectly both produce no error, and the difference
 * between them is the entire question this page exists to answer — three of the jobs on this
 * platform were fully written, fully tested, and had never once executed, and nothing anywhere
 * said so.
 */
@Injectable()
export class TrainingStatusService {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  async status(now: Date = new Date()): Promise<SourceStatus[]> {
    /*
     * One query for the row counts, one for the run history. Not one per source: the page renders
     * all seven together, and fourteen round trips to draw one panel is the sort of thing that is
     * invisible on localhost and obvious over a transatlantic link.
     */
    const [counts, runs] = await Promise.all([
      this.db.$queryRawUnsafe<Array<{ source: string; n: bigint }>>(
        `SELECT source, COUNT(*)::bigint AS n FROM knowledge_items GROUP BY source`,
      ),
      this.db.$queryRawUnsafe<
        Array<{ source: string; last_at: Date | null; error: string | null; running: boolean }>
      >(
        `SELECT s.source,
                l.finished_at              AS last_at,
                l.error,
                COALESCE(r.running, false) AS running
           FROM (SELECT DISTINCT source FROM knowledge_ingests) s
           -- The most recent FINISHED run, which is what "last trained" means to a reader.
           LEFT JOIN LATERAL (
                  SELECT finished_at, error FROM knowledge_ingests
                   WHERE source = s.source AND finished_at IS NOT NULL
                   ORDER BY finished_at DESC LIMIT 1) l ON true
           -- Running = started and never finished. Also true of a job that CRASHED, which is
           -- correct and deliberate: it is still unfinished, and saying so beats reporting a
           -- completion that never happened.
           LEFT JOIN LATERAL (
                  SELECT true AS running FROM knowledge_ingests
                   WHERE source = s.source AND finished_at IS NULL LIMIT 1) r ON true`,
      ),
    ]);

    const rowsBySource = new Map(counts.map((c) => [c.source, Number(c.n)]));
    const runBySource = new Map(runs.map((r) => [r.source, r]));

    return KNOWLEDGE_SOURCES.map((source): SourceStatus => {
      const run = runBySource.get(source);
      const lastAt = run?.last_at ?? null;

      return {
        source: source as KnowledgeSource,
        rows: rowsBySource.get(source) ?? 0,
        lastIngestedAt: lastAt,
        ingesting: run?.running ?? false,
        nextInHours: nextInHours(source, lastAt, now),
        /*
         * Bounded, and bounded HERE rather than at render time. A stack trace in a status column
         * is unreadable on the page that shows it, and a page that has to trim its own data is one
         * that will eventually forget to.
         */
        lastError: run?.error === undefined || run.error === null ? null : run.error.slice(0, 300),
      };
    });
  }
}
