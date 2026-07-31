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
/**
 * How long an unfinished run may sit before it is called dead rather than busy.
 *
 * The galaxy import is the longest job here and finishes well inside an hour on the full dump.
 * Six hours is generous enough that a slow night is never mistaken for a corpse, and short enough
 * that a job killed overnight is flagged by morning.
 */
const STALL_AFTER_MS = 6 * 60 * 60 * 1000;

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
        Array<{
          source: string;
          last_at: Date | null;
          error: string | null;
          started_at: Date | null;
          rows_so_far: bigint | null;
          expected_rows: bigint | null;
        }>
      >(
        `SELECT s.source,
                l.finished_at              AS last_at,
                l.error,
                r.started_at,
                -- What the run in progress has written. Updated at batch boundaries by the job.
                r.rows      AS rows_so_far,
                -- Last SUCCESSFUL total: the only honest basis for "how much longer".
                l.rows      AS expected_rows
           FROM (SELECT DISTINCT source FROM knowledge_ingests) s
           -- The most recent FINISHED run, which is what "last trained" means to a reader.
           LEFT JOIN LATERAL (
                  SELECT finished_at, error, rows FROM knowledge_ingests
                   WHERE source = s.source AND finished_at IS NOT NULL AND error IS NULL
                   ORDER BY finished_at DESC LIMIT 1) l ON true
           /*
            * ★ RUNNING MEANS RECENTLY STARTED AND STILL UNFINISHED ★
            *
            * This was "started and never finished", full stop, on the reasoning that a crashed job
            * IS still unfinished and saying so beats reporting a completion that never happened.
            *
            * That reasoning was right about the ambiguity and wrong about the remedy. A job killed
            * three days ago leaves its row forever, and the page then says "Training now" forever —
            * which is a WORSE lie than the one it replaced, because it is reassuring. Reported by
            * the owner: two sources reading "Training now" with nothing running anywhere.
            *
            * A window instead. Inside it, unfinished means running. Outside it, unfinished means
            * the job died — reported as a stall below, which is the state that actually needs
            * somebody. The galaxy import is the longest job here and takes well under an hour even
            * on the full dump; six hours is generous enough that a slow night is never mistaken
            * for a corpse.
            */
           LEFT JOIN LATERAL (
                  SELECT started_at, rows FROM knowledge_ingests
                   WHERE source = s.source AND finished_at IS NULL
                   ORDER BY started_at DESC LIMIT 1) r ON true`,
      ),
    ]);

    const rowsBySource = new Map(counts.map((c) => [c.source, Number(c.n)]));
    const runBySource = new Map(runs.map((r) => [r.source, r]));

    return KNOWLEDGE_SOURCES.map((source): SourceStatus => {
      const run = runBySource.get(source);
      const lastAt = run?.last_at ?? null;

      /*
       * ★ THREE STATES OUT OF ONE UNFINISHED ROW ★
       *
       * Started recently and unfinished -> running.
       * Started long ago and unfinished -> STALLED. The job died without recording why, and that
       *                                    is the state most in need of a human — it is invisible
       *                                    in every log because nothing errored.
       */
      const startedAt = run?.started_at ?? null;
      const age = startedAt === null ? null : now.getTime() - startedAt.getTime();
      const ingesting = age !== null && age < STALL_AFTER_MS;
      const stalled = age !== null && age >= STALL_AFTER_MS;

      return {
        source: source as KnowledgeSource,
        rows: rowsBySource.get(source) ?? 0,
        lastIngestedAt: lastAt,
        ingesting,
        nextInHours: nextInHours(source, lastAt, now),
        /*
         * Only meaningful while something is running. Reported as null otherwise rather than as
         * zero — the page distinguishes "nothing to show" from "no progress yet", and a zero would
         * draw an empty bar for an idle source.
         */
        startedAt: ingesting ? startedAt : null,
        rowsSoFar: ingesting && run?.rows_so_far != null ? Number(run.rows_so_far) : null,
        expectedRows: run?.expected_rows == null ? null : Number(run.expected_rows),
        /*
         * Bounded, and bounded HERE rather than at render time. A stack trace in a status column
         * is unreadable on the page that shows it, and a page that has to trim its own data is one
         * that will eventually forget to.
         */
        /*
         * A stall is REPORTED AS THE ERROR, because to a reader it is one — and because the run
         * that died left no message of its own. Anything the previous run said is kept alongside:
         * a source that failed and then stalled has two things wrong with it.
         */
        lastError: stalled
          ? `Started ${Math.round((age ?? 0) / 3_600_000)}h ago and never finished — the job was ` +
            `killed or crashed.${run?.error === undefined || run.error === null ? '' : ` Previously: ${run.error.slice(0, 200)}`}`
          : run?.error === undefined || run.error === null
            ? null
            : run.error.slice(0, 300),
      };
    });
  }
}
