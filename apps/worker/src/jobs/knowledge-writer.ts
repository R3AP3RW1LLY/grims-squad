import type { PrismaClient } from '@grims/db';

/**
 * Writing ingested knowledge into Postgres.
 *
 * ★ RAW SQL, BECAUSE OF cube AND vector ★
 *
 * Prisma has native types for neither, so both columns are invisible to the generated client. Every
 * write that touches them has to be raw, and confining that to this one file keeps it out of the
 * ingest jobs — which should be about SHAPE, not about SQL.
 *
 * ★ UPSERT, ALWAYS ★
 *
 * Spansh rebuilds nightly and Coriolis changes with every game update, so ingestion is repeated by
 * design. Insert-only would double the galaxy every night; delete-then-insert would leave the
 * assistant with an empty knowledge base for the length of the import. `ON CONFLICT DO UPDATE`
 * against the unique key means a re-run refreshes in place and the data is never absent.
 */

export interface WritableRow {
  readonly source: string;
  readonly kind: string;
  readonly extKey: string;
  readonly name: string;
  readonly data: unknown;
  readonly text?: string | null;
  readonly coords?: { x: number; y: number; z: number } | null;
}

/**
 * Writes one batch.
 *
 * ★ ONE STATEMENT PER BATCH, PARAMETERISED ★
 *
 * A statement per row would be tens of millions of round trips for the galaxy. Building one big
 * string with the values inlined would be faster still and is exactly how an injection gets in —
 * these rows carry names written by Frontier and by players, and `$n` placeholders mean none of it
 * is ever parsed as SQL.
 *
 * `cube(...)` is built from three separately-bound numbers rather than a formatted string, for the
 * same reason.
 */
/**
 * What one batch actually did.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "how many new / updated / removed records there were in that run."
 *
 * The writer returned one number — rows touched — which cannot answer that. An import of 448,676
 * rows reads identically whether it added a thousand stations or changed nothing at all, and those
 * are very different pieces of news: the first is a game update landing, the second is a nightly
 * dump that has not moved.
 */
export interface BatchResult {
  /** Rows the statement created. */
  readonly inserted: number;
  /** Rows that already existed and were refreshed. */
  readonly updated: number;
}

export async function writeBatch(db: PrismaClient, rows: readonly WritableRow[]): Promise<BatchResult> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  /*
   * ★ DEDUPLICATED WITHIN THE BATCH, AND POSTGRES INSISTS ★
   *
   * `ON CONFLICT DO UPDATE command cannot affect row a second time` — a real error from a real
   * import. One statement may not touch the same key twice, and the galaxy dump genuinely contains
   * them: a system can hold two stations sharing a name, so `<id64>/<name>` collides.
   *
   * Last occurrence wins, which matches what a re-ingest would have done anyway had they arrived in
   * separate batches. Dropping the batch, or letting the error through, would have lost thousands of
   * legitimate rows because of a handful of duplicate names.
   */
  const unique = new Map<string, WritableRow>();
  /*
   * ★ SEPARATED BY A NUL, WRITTEN AS AN ESCAPE ★
   *
   * A NUL cannot occur in any of the three parts, so the key is collision-free. A space could
   * collide: ("galaxy", "station", "1/Foo Bar") and ("galaxy", "station 1", "Foo Bar") produce the
   * same string, and the second row would silently vanish from the batch.
   *
   * Written as an ESCAPE rather than as a literal NUL byte. It was a literal one for a while, which
   * works perfectly at runtime and makes git and grep treat this entire file as BINARY — no diff,
   * no search, and nobody would ever have connected that to a dedup key.
   */
  for (const row of rows) unique.set(`${row.source}\u0000${row.kind}\u0000${row.extKey}`, row);

  const values: string[] = [];
  const params: unknown[] = [];

  for (const row of unique.values()) {
    const i = params.length;
    // source, kind, ext_key, name, data, text, then optionally three coordinate numbers.
    params.push(row.source, row.kind, row.extKey, row.name, JSON.stringify(row.data), row.text ?? null);

    if (row.coords) {
      params.push(row.coords.x, row.coords.y, row.coords.z);
      values.push(
        `($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5}::jsonb,$${i + 6},` +
          `cube(array[$${i + 7}::float8,$${i + 8}::float8,$${i + 9}::float8]))`,
      );
    } else {
      values.push(`($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5}::jsonb,$${i + 6},NULL)`);
    }
  }

  /*
   * `ingested_at = now()` on update as well as insert. Without it a row that stopped changing would
   * keep its original timestamp forever, and the training page would report the source as stale
   * while it was in fact being refreshed nightly.
   *
   * `embedding` is cleared ONLY when the text changed — see the CASE below. Clearing it
   * unconditionally would un-embed everything on every nightly run; never clearing it leaves a
   * vector describing words that no longer exist.
   */
  /*
   * ★ xmax = 0 IS HOW POSTGRES TELLS AN INSERT FROM AN UPDATE ★
   *
   * `ON CONFLICT DO UPDATE` gives no indication of which branch each row took, and there is no
   * count for it either — the command tag reports the total and nothing else.
   *
   * `xmax` is the transaction id that deleted a row version. For a row this statement CREATED it is
   * zero; for one it UPDATED, the update wrote a new version and stamped the old one, so it is
   * non-zero. Reading it in RETURNING is the standard way to separate the two, and it costs one
   * boolean per row rather than a second query.
   *
   * `$queryRawUnsafe` rather than `$executeRawUnsafe`, because only the former returns rows.
   */
  const outcome = await db.$queryRawUnsafe<Array<{ inserted: boolean }>>(
    `INSERT INTO knowledge_items (source, kind, ext_key, name, data, text, coords)
     VALUES ${values.join(',')}
     ON CONFLICT (source, kind, ext_key) DO UPDATE SET
       name        = EXCLUDED.name,
       data        = EXCLUDED.data,
       text        = EXCLUDED.text,
       coords      = EXCLUDED.coords,
       ingested_at = now(),
       /*
        * ★ A CHANGED TEXT INVALIDATES ITS VECTOR ★
        *
        * This column used to be left alone here, with a comment explaining that it belongs to the
        * embedder and that resetting it would silently un-embed everything. That was right while
        * text never changed, and wrong the moment it could.
        *
        * (No backticks in this comment: it sits inside a template literal, and a stray one ends the
        *  SQL mid-statement. That has now cost two debugging rounds in one session.)
        *
        * A vector describes the words it was made from. If the text is rewritten — a station gains
        * a service, a summary is reworded — the old vector keeps answering for content that no
        * longer exists, and nothing anywhere notices: retrieval still returns rows, they are simply
        * the wrong ones.
        *
        * Cleared ONLY when the text actually differs, so a nightly re-ingest of unchanged data does
        * not throw away 448,676 vectors and an hour of GPU time. The embedder then picks the row up
        * on its next sweep, because "needs embedding" is defined as having none.
        */
       embedding   = CASE
                       WHEN knowledge_items.text IS DISTINCT FROM EXCLUDED.text THEN NULL
                       ELSE knowledge_items.embedding
                     END
     RETURNING (xmax = 0) AS inserted`,
    ...params,
  );

  let inserted = 0;
  for (const r of outcome) if (r.inserted) inserted += 1;
  return { inserted, updated: outcome.length - inserted };
}

/**
 * Records an ingestion run, so the training page can say what happened.
 *
 * ★ FAILURES ARE RECORDED, NOT JUST SUCCESSES ★
 *
 * A source that is quietly broken looks identical to one that has never run — both show "no data" —
 * and those need opposite reactions. The run row is written when the job STARTS, so a job that dies
 * half way still leaves evidence that it tried.
 */
export async function beginIngest(db: PrismaClient, source: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    /*
     * `rows` and `progress_at` are set from the start rather than left null.
     *
     * A null row count is indistinguishable from "no progress reported yet", which is why the
     * training page's countdown rendered "estimating…" and never moved. Zero is a real answer, and
     * stamping progress_at immediately means the stall clock starts here rather than at whatever
     * moment the job first happens to write something.
     */
    `INSERT INTO knowledge_ingests (source, rows, progress_at) VALUES ($1, 0, now()) RETURNING id`,
    source,
  );
  return rows[0]?.id ?? '';
}

/**
 * Reports how far a running ingest has got.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "anything that is showing in progress can we show a real time progress bar with a countdown
 * timer ... at least an estimate that adjusts as it goes."
 *
 * A countdown needs two things the run row did not carry: how much has been done, and when it
 * started. The start was always there; this writes the progress.
 *
 * ★ CALLED AT BATCH BOUNDARIES, NOT PER ROW ★
 *
 * The galaxy writes eighteen million rows. An UPDATE per row would double the work of the import
 * to drive a progress bar. At every hundred thousand it is a few hundred extra statements across
 * the whole run, which is free — and a bar that moves in 100k steps is indistinguishable from a
 * smooth one at this duration.
 *
 * Failures are swallowed: a progress report that cannot be written must never take down the import
 * it is reporting on.
 */
export async function progressIngest(db: PrismaClient, id: string, rows: number): Promise<void> {
  if (id === '') return;
  await db
    .$executeRawUnsafe(
      // `progress_at` is what tells a stalled run from a slow one. See the column's own note.
      `UPDATE knowledge_ingests SET rows = $2, progress_at = now() WHERE id = $1::uuid`,
      id,
      rows,
    )
    .catch(() => undefined);
}

export async function finishIngest(
  db: PrismaClient,
  id: string,
  outcome: ({ rows: number } & Partial<BatchResult> & { source?: string; removed?: number }) | { error: string },
): Promise<void> {
  if (id === '') return;

  await db.$executeRawUnsafe(
    /*
     * `$1::uuid`, not `$1`. Postgres refused this with `operator does not exist: uuid = text` — the
     * driver binds the id as text and there is no implicit cast. Found by running it, not by
     * reading it.
     */
    `UPDATE knowledge_ingests
        SET finished_at = now(), rows = $2, error = $3
      WHERE id = $1::uuid`,
    id,
    'rows' in outcome ? outcome.rows : null,
    // Bounded: a stack trace in a status column is unreadable on the page that shows it.
    'error' in outcome ? outcome.error.slice(0, 500) : null,
  );

  /*
   * ★ AND INTO THE AUDIT LOG — squadron owner, 2026-08-01 ★
   *
   * "add all of this to the audit logs too please so we can see when training on various ingestion
   * sources were run and complete, and how many new / updated / removed records there were."
   *
   * The training page shows the CURRENT state — what each source holds right now. It cannot answer
   * "when did the ships change" or "was last Tuesday's run normal", because it keeps one row per
   * source and overwrites it. The audit log is the history, and it is append-only, so this is the
   * only place those questions can ever be answered from.
   *
   * ★ actor_type = system, actor_id = null ★
   *
   * Nobody did this. A cron job did, and attributing it to a person — even the webmaster — would
   * put their name against work they were asleep for, in a log whose entire value is that it says
   * who did what.
   *
   * Failures here are swallowed. An audit write that cannot complete must never fail the import it
   * is describing; the import is the thing that matters and it has already happened.
   */
  await db.auditLog
    .create({
      data: {
        actorType: 'system',
        action: 'error' in outcome ? 'knowledge.ingest.failed' : 'knowledge.ingest.completed',
        targetType: 'knowledge_source',
        targetId: 'source' in outcome ? (outcome.source ?? null) : null,
        after:
          'error' in outcome
            ? { error: outcome.error.slice(0, 500) }
            : {
                rows: outcome.rows,
                /*
                 * New versus updated, separated by `xmax` in the writer. The distinction is the
                 * point of the request: 448,676 rows touched reads identically whether a game
                 * update added a thousand stations or nothing moved at all.
                 */
                inserted: outcome.inserted ?? null,
                updated: outcome.updated ?? null,
                /*
                 * REMOVED is reported honestly as zero, because nothing here deletes.
                 *
                 * Every ingest upserts, so a station Spansh drops keeps its row until somebody
                 * removes it deliberately. Reporting a number we do not compute would be worse than
                 * reporting zero — and null would read as "unknown" when it is in fact "none, by
                 * design". If pruning is added, this is where its count belongs.
                 */
                removed: outcome.removed ?? 0,
              },
      },
    })
    .catch(() => undefined);
}

/**
 * What the training page reads.
 *
 * One query rather than one per source: the page shows every source together, and seven round trips
 * to render one panel is the kind of thing that is invisible in development and obvious in
 * production.
 */
export async function sourceStatus(
  db: PrismaClient,
): Promise<Array<{ source: string; rows: number; lastAt: Date | null; running: boolean; error: string | null }>> {
  const rows = await db.$queryRawUnsafe<
    Array<{ source: string; rows: bigint; last_at: Date | null; running: boolean; error: string | null }>
  >(
    `SELECT s.source,
            COALESCE(c.n, 0)                          AS rows,
            l.finished_at                             AS last_at,
            COALESCE(r.running, false)                AS running,
            l.error
       FROM (SELECT DISTINCT source FROM knowledge_ingests
             UNION SELECT DISTINCT source FROM knowledge_items) s
       LEFT JOIN (SELECT source, COUNT(*)::bigint AS n FROM knowledge_items GROUP BY 1) c
              ON c.source = s.source
       -- The most recent FINISHED run, which is what "last ingested" means to a reader.
       LEFT JOIN LATERAL (
              SELECT finished_at, error FROM knowledge_ingests
               WHERE source = s.source AND finished_at IS NOT NULL
               ORDER BY finished_at DESC LIMIT 1) l ON true
       -- Running = started and never finished. Also true for a job that crashed, which is correct:
       -- it IS still unfinished, and saying so is more useful than pretending it completed.
       LEFT JOIN LATERAL (
              SELECT true AS running FROM knowledge_ingests
               WHERE source = s.source AND finished_at IS NULL LIMIT 1) r ON true
      ORDER BY s.source`,
  );

  return rows.map((r) => ({
    source: r.source,
    rows: Number(r.rows),
    lastAt: r.last_at,
    running: r.running,
    error: r.error,
  }));
}
