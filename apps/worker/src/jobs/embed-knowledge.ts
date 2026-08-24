import type { PrismaClient } from '@grims/db';
import {
  EMBED_DIMS,
  EMBED_MODEL,
  EMBED_CONCURRENCY,
  EMBEDDED_SOURCES,
  VECTOR_INDEXES,
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

  /*
   * ★ PER SOURCE, SMALLEST QUEUE FIRST — THE STARVATION BUG, 2026-08-24 ★
   *
   * This counted and selected across EVERY source at once, `ORDER BY ingested_at`, defending it
   * with: "a source that has just been ingested should not jump ahead of one that has been
   * waiting". That is right between rows of comparable sources and catastrophically wrong the
   * moment one source is a bulk import.
   *
   * What it did in production: the EDDN galaxy backfill left 884,910 rows pending from 9 August.
   * Members' own visited systems arrived on 22 August — 73 of them — and sorted BEHIND all
   * 884,910. At roughly 45,000 embedded a night they were about twenty nights from being reached,
   * so "Systems our members have flown to" sat at "73 awaiting embedding" and never moved. The
   * squadron owner noticed before any alarm did, because nothing was failing: the job ran, embedded
   * tens of thousands of rows, and reported success every time.
   *
   * Counting per source and taking the SMALLEST queue first fixes the class of problem rather than
   * this instance. A source with 73 pending drains in one pass; a source with 900,000 gets whatever
   * budget is left, which is what it had anyway. Oldest-first is preserved WITHIN each source,
   * which is the part of the original reasoning that was actually load-bearing.
   */
  const backlogs = await db.$queryRawUnsafe<Array<{ source: string; n: bigint }>>(
    `SELECT source, COUNT(*)::bigint AS n
       FROM knowledge_items
      WHERE source = ANY($1::text[]) AND text IS NOT NULL AND embedding IS NULL
      GROUP BY source`,
    VECTOR_SOURCES,
  );
  const pending = backlogs.reduce((sum, r) => sum + Number(r.n), 0);

  /*
   * Ordered HERE rather than in the SQL, deliberately.
   *
   * This is the whole fix, and a rule that lives in an ORDER BY cannot be tested without a real
   * Postgres — a fake returning rows in whatever order it likes will pass whichever direction the
   * query asks for. Written the first time with `ORDER BY n ASC`, and reversing it to DESC did not
   * fail a single test, because the fake was doing the sorting. Seven sources is nothing to sort.
   */
  const smallestFirst = [...backlogs].sort((a, b) => Number(a.n) - Number(b.n));

  let embedded = 0;
  let failed = 0;

  for (const backlog of smallestFirst) {
    if (embedded + failed >= limit) break;

    /*
     * Scoped to ONE source. A failing row still cannot livelock the loop — see the zero-vector
     * write below, which takes the row out of the pending set rather than handing it back.
     */
    while (embedded + failed < limit) {
      const rows = await db.$queryRawUnsafe<Array<{ id: string; text: string }>>(
        `SELECT id, text
           FROM knowledge_items
          WHERE source = $1 AND text IS NOT NULL AND embedding IS NULL
          -- Oldest first within the source, which is where that rule genuinely applies.
          ORDER BY ingested_at
          LIMIT $2`,
        backlog.source,
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
    /*
     * ★ THIS HAS NEVER ONCE SUCCEEDED — FOUND 2026-08-09 ★
     *
     * The memory cap was issued as `SET LOCAL` on the pooled client, outside any transaction.
     * Postgres discards that and says so — "WARNING: SET LOCAL can only be used in transaction
     * blocks" — so the server's 2 GB value stood, every rebuild asked for a work area larger than
     * the container's /dev/shm, and both the CONCURRENTLY attempt and the plain fallback died with
     * "could not resize shared memory segment ... No space left on device".
     *
     * Both failures were swallowed by `.catch(() => undefined)`, so the job printed nothing and
     * reported success. The consequence is the one this reindex exists to prevent and it has been
     * live the whole time: the HNSW index is stale, retrieval keeps returning rows, and they are
     * simply the wrong ones — which is how "what do I need to do to become a member" came back with
     * ship descriptions.
     *
     * ★ WHY THE TWO PATHS ARE SET UP DIFFERENTLY ★
     *
     * `SET LOCAL` needs a transaction and REINDEX CONCURRENTLY cannot run in one, so the cap and
     * the concurrent rebuild are mutually exclusive. The plain rebuild CAN run in a transaction, so
     * the fallback gets the cap it always needed.
     *
     * The concurrent attempt gets nothing from here, and does not need to: `shm_size` in
     * `compose.prod.yml` was raised from 1 GB to 3 GB in the same change, which is what actually
     * makes the server's own 2 GB `maintenance_work_mem` allocatable. Measured on the box: /dev/shm
     * was 1.0G and the rebuild asked for 2,144,375,744 bytes. A session-level `SET` was rejected as
     * the alternative — on a pooled client it would leak the value onto whichever connection served
     * it, for every later caller.
     */
    /*
     * ★ THE INDEXES RETRIEVAL USES — NOT THE ONE IT USED TO — 2026-08-23 ★
     *
     * This rebuilt `knowledge_items_embedding_idx` by name: the single shared index that the
     * prose/place split replaced. So every sweep spent a long CONCURRENT rebuild on an index no
     * query plans against, and never rebuilt the two that every query now does.
     *
     * The prose index would not have suffered — 302 rows barely have a graph to degrade. The PLACE
     * index absolutely would, as the nightly EDDN sweep works through a million rows, and the
     * symptom would be the one this whole reindex exists to prevent: retrieval still returning
     * rows, and them simply being the wrong ones.
     *
     * Names come from VECTOR_INDEXES rather than being typed here, because a hardcoded name is
     * precisely how this went wrong the first time.
     */
    const results = await Promise.all(
      VECTOR_INDEXES.map(async (index) =>
        db
          .$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY ${index}`)
          .then(() => true)
          .catch(async (concurrentError: unknown) => {
            /*
             * CONCURRENTLY cannot run inside a transaction and needs the index to be valid. A plain
             * rebuild is the fallback: it takes an ACCESS EXCLUSIVE lock on the index, which blocks
             * planning for every SELECT on knowledge_items, so it is bounded and it is reported.
             */
            return db
              .$transaction(async (tx) => {
                await tx.$executeRawUnsafe(`SET LOCAL maintenance_work_mem = '256MB'`);
                await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '30s'`);
                await tx.$executeRawUnsafe(`REINDEX INDEX ${index}`);
                return true;
              })
              .catch((plainError: unknown) => {
                /*
                 * Reported, not swallowed. A silent failure here degrades every answer the assistant
                 * gives and changes nothing a person can see — which is exactly how it survived
                 * unnoticed from the day it was written.
                 */
                console.error(
                  `embed: ${index} was NOT rebuilt — retrieval will keep returning the ` +
                    `wrong rows until it is. concurrent: ${String(concurrentError)}; plain: ` +
                    String(plainError),
                );
                return false;
              });
          }),
      ),
    );

    const reindexed = results.every((ok) => ok);
    if (reindexed) console.log(`embed: vector indexes rebuilt (${VECTOR_INDEXES.join(', ')})`);
  }

  return { pending, embedded, failed };
}

/** What the job prints. Named so the entrypoint and the tests agree on the wording. */
export function describeEmbedRun(r: EmbedReport): string {
  if (r.pending === 0) return `embed: nothing to do — every prose row already has a vector`;
  return `embed: ${r.embedded} embedded, ${r.failed} failed, ${r.pending} were pending (${EMBED_MODEL})`;
}
