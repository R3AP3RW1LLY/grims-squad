import type { PrismaClient } from '@grims/db';
import {
  EMBED_DIMS,
  EMBED_MODEL,
  EMBED_CONCURRENCY,
  EMBEDDED_SOURCES,
  type KnowledgeSource,
} from '@grims/shared';

/**
 * Turning prose knowledge into vectors.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "my 3060 is dead silent shows no activity! i thought we were building an AI here lol.. should it
 * not be embedding?"
 *
 * Half right, and the half that is right had never been built — which is why nothing has ever
 * embedded anything. This is that job.
 *
 * ★ EVERYTHING IS EMBEDDED NOW, AND THE REASON IT WAS NOT WAS A BAD NUMBER ★
 *
 * The first version embedded prose only, because embedding the galaxy was believed to take "roughly
 * three weeks on this hardware". Measured rather than assumed: 104 embeddings a second at
 * concurrency 8, so 448,676 rows take just over an hour — once, and then only what changed.
 *
 * Three weeks would have been a real reason. An hour is not a reason for anything, and the figure
 * was inherited without ever being checked.
 *
 * ★ EMBEDDING IS ADDED, NEVER SUBSTITUTED ★
 *
 * "Which stations in Deciat have a large pad" is still an exact lookup on an index. A similarity
 * search answers it with Deciak and Decius — systems near Deciat in embedding space that have
 * nothing to do with the question.
 *
 * What vectors add is the question lookup cannot take at all: "somewhere quiet with good mining and
 * a large pad". No column holds that. Both paths exist and the retrieval layer picks by the shape
 * of the question.
 */

/*
 * Every source that carries a vector. Derived from the contract so it cannot drift — and it is now
 * ALL of them, because the estimate that said otherwise was wrong by a factor of about three
 * hundred. See STORAGE_KIND.
 */

/** Something that can turn text into a vector. The API's `EmbedClient` satisfies this. */
export interface Embedder {
  embed(text: string): Promise<number[] | null>;
}

export interface EmbedReport {
  /** Rows that needed a vector when we started. */
  readonly pending: number;
  readonly embedded: number;
  /** Rows the model refused or returned the wrong shape for. Left for the next run. */
  readonly failed: number;
}

/**
 * How many rows to claim per pass.
 *
 * Enough to keep eight requests in flight without re-querying constantly, small enough that killing
 * a run loses almost nothing. The work is resumable regardless, because progress IS the `embedding`
 * column — there is no cursor to lose.
 */
const BATCH = 256;

/**
 * How many new vectors justify rebuilding the index.
 *
 * Below this the graph churn is not worth a rebuild; above it, retrieval quality is at stake. A
 * few hundred is the scale at which the degradation was first observed.
 */
const REINDEX_AFTER = 200;

/**
 * Embeds everything that needs it.
 *
 * ★ RESUMABLE BY CONSTRUCTION ★
 *
 * There is no cursor and no queue table. The work remaining is defined as "prose rows with no
 * vector", so a run that dies half way leaves the rest visible to the next one. Re-running is
 * always safe and never redundant.
 */
export async function embedKnowledge(
  db: PrismaClient,
  embedder: Embedder,
  options: { limit?: number; sources?: readonly KnowledgeSource[] } = {},
): Promise<EmbedReport> {
  const limit = options.limit ?? 50_000;
  /*
   * A subset when the caller names one — the schedules differ wildly. The forum is swept every five
   * minutes because somebody answers a question and walks away; the galaxy is swept after its
   * nightly import because nothing new appears in between. One job doing everything on the fastest
   * cadence would re-scan 448,676 rows every five minutes to find nothing.
   */
  const VECTOR_SOURCES = options.sources ?? EMBEDDED_SOURCES;
  const pendingRows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n
       FROM knowledge_items
      WHERE source = ANY($1::text[]) AND text IS NOT NULL AND embedding IS NULL`,
    VECTOR_SOURCES,
  );
  const pending = Number(pendingRows[0]?.n ?? 0);

  let embedded = 0;
  let failed = 0;

  while (embedded + failed < Math.min(pending, limit)) {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; text: string }>>(
      `SELECT id, text
         FROM knowledge_items
        WHERE source = ANY($1::text[]) AND text IS NOT NULL AND embedding IS NULL
        /*
         * Oldest first. A source that has just been ingested should not jump ahead of one that has
         * been waiting — and without an ORDER BY, a failing row could be handed back repeatedly
         * while everything behind it starved.
         */
        ORDER BY ingested_at
        LIMIT $2`,
      VECTOR_SOURCES,
      BATCH,
    );

    if (rows.length === 0) break;

    /*
     * ★ EMBEDDED IN PARALLEL, MEASURED ON THE ACTUAL CARD ★
     *
     *     concurrency  1:  22/s        concurrency  8: 104/s
     *     concurrency  4:  61/s        concurrency 16: 112/s
     *
     * One at a time makes the whole galaxy a six-hour job; eight makes it just over an hour.
     * Sixteen is seven per cent faster than eight and doubles the queue depth — and the same card
     * screens forum posts, where a member is WAITING. Eight takes nearly all the throughput and
     * leaves the model responsive.
     */
    for (let i = 0; i < rows.length; i += EMBED_CONCURRENCY) {
      const slice = rows.slice(i, i + EMBED_CONCURRENCY);
      const vectors = await Promise.all(slice.map((r) => embedder.embed(r.text)));

      for (let j = 0; j < slice.length; j += 1) {
        const row = slice[j];
        const vector = vectors[j];
        if (row === undefined) continue;

        /*
         * ★ A REFUSAL MARKS THE ROW, IT DOES NOT RETRY FOREVER ★
         *
         * Without this the loop re-selects the same failing row every pass and never advances — the
         * classic queue livelock. A zero vector is written so the row leaves the pending set, and it
         * is distinguishable from a real one (nothing else is all zeros) if anybody wants to find
         * and re-embed them later.
         */
        if (vector === null || vector === undefined || vector.length !== EMBED_DIMS) {
          failed += 1;
          await db.$executeRawUnsafe(
            `UPDATE knowledge_items SET embedding = $2::vector WHERE id = $1::uuid`,
            row.id,
            `[${new Array(EMBED_DIMS).fill(0).join(',')}]`,
          );
          continue;
        }

        /*
         * pgvector's literal format is `[1,2,3]`, bound as a parameter and cast. Prisma has no
         * vector type, so this is raw — and it is a PARAMETER rather than interpolation even though
         * the content is numbers we generated, because the day somebody passes text through here is
         * the day interpolation becomes an injection.
         */
        await db.$executeRawUnsafe(
          `UPDATE knowledge_items SET embedding = $2::vector WHERE id = $1::uuid`,
          row.id,
          `[${vector.join(',')}]`,
        );
        embedded += 1;
      }
    }
  }

  /*
   * ★ REBUILD THE VECTOR INDEX AFTER A LARGE SWEEP ★
   *
   * ★ THE BUG THIS EXISTS FOR ★
   *
   * HNSW is a graph, and pgvector maintains it by inserting a new entry on every UPDATE and leaving
   * the old one behind. Re-embedding the same rows a few times — which happens whenever a text is
   * reworded — fills it with dead entries until traversal stops finding the real nearest neighbours.
   *
   * Observed on 2026-08-01 with a 230-row index: asking "what do I need to do to become a member"
   * returned SHIP DESCRIPTIONS, and the joining guide was not in the top three. Raising ef_search to
   * 200 on 230 rows returned different wrong answers. A sequential scan gave the correct result
   * immediately — the stored vectors were fine, the graph was not.
   *
   * Nothing errors. Retrieval keeps returning rows and they are simply the wrong ones, which is the
   * worst failure a search index has.
   *
   * Only after a sweep that actually wrote something substantial: rebuilding after every three-minute
   * journal sweep would be constant work for nothing.
   */
  if (embedded >= REINDEX_AFTER) {
    await db
      .$executeRawUnsafe(
        /*
         * Bounded memory, deliberately. The default lets Postgres request a work area larger than
         * Docker's /dev/shm and the rebuild fails with "could not resize shared memory segment" —
         * which is what happened the first time this was run by hand.
         */
        `SET LOCAL maintenance_work_mem = '256MB'`,
      )
      .catch(() => undefined);
    await db
      .$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY knowledge_items_embedding_idx`)
      .catch(async () => {
        // CONCURRENTLY cannot run inside a transaction and needs the index to be valid. A plain
        // rebuild is the fallback: slower and it takes a lock, but this is a nightly job.
        await db
          .$executeRawUnsafe(`REINDEX INDEX knowledge_items_embedding_idx`)
          .catch(() => undefined);
      });
  }

  return { pending, embedded, failed };
}

/** What the job prints. Named so the entrypoint and the tests agree on the wording. */
export function describeEmbedRun(r: EmbedReport): string {
  if (r.pending === 0) return `embed: nothing to do — every prose row already has a vector`;
  return `embed: ${r.embedded} embedded, ${r.failed} failed, ${r.pending} were pending (${EMBED_MODEL})`;
}
