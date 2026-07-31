import type { PrismaClient } from '@grims/db';
import { EMBED_DIMS, EMBED_MODEL, STORAGE_KIND, type KnowledgeSource } from '@grims/shared';

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
 * ★ WHY THE GALAXY IMPORT LEAVES THE GPU IDLE, AND SHOULD ★
 *
 * `STORAGE_KIND` splits the sources: structured data is LOOKED UP, prose is EMBEDDED. Importing
 * 448,676 systems is a database write and nothing else, so a silent GPU during it is correct.
 *
 * Embedding them would take roughly three weeks on this hardware and produce a WORSE assistant.
 * Asked about "Deciat" a vector search returns systems whose names sit near it in embedding space —
 * Deciat, Deciak, Decius — rather than facts about Deciat. "Which stations in Deciat have a large
 * pad" has one correct answer, and an index built for similarity cannot give it.
 *
 * ★ WHAT IS WORTH EMBEDDING ★
 *
 * Text where the QUESTION is about meaning rather than about a name: a forum answer, a guide, an
 * explanation of how engineering works. Nobody looks those up by exact title — they ask "how do I
 * get more jump range", and the answer is a post that never uses those words.
 *
 * That is a few thousand rows at most, and it is where the card earns its keep.
 */

/** Sources whose text is meant to be searched by meaning. Derived, never a second list. */
const VECTOR_SOURCES: KnowledgeSource[] = (
  Object.keys(STORAGE_KIND) as KnowledgeSource[]
).filter((s) => STORAGE_KIND[s] === 'vector');

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
 * Small on purpose. Each row is a round trip to a model on somebody's desktop, over an SSH tunnel
 * that may not be up — so a pass should be short enough that killing it loses very little, and the
 * work is resumable because progress is the `embedding` column itself.
 */
const BATCH = 32;

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
  limit = 2_000,
): Promise<EmbedReport> {
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

    for (const row of rows) {
      const vector = await embedder.embed(row.text);

      /*
       * ★ A REFUSAL MARKS THE ROW, IT DOES NOT RETRY FOREVER ★
       *
       * Without this the loop re-selects the same failing row every pass and never advances — the
       * classic queue livelock. A zero vector is written so the row leaves the pending set, and it
       * is distinguishable from a real one (nothing else is all zeros) if anybody wants to find and
       * re-embed them later.
       */
      if (vector === null || vector.length !== EMBED_DIMS) {
        failed += 1;
        await db.$executeRawUnsafe(
          `UPDATE knowledge_items SET embedding = $2::vector WHERE id = $1::uuid`,
          row.id,
          `[${new Array(EMBED_DIMS).fill(0).join(',')}]`,
        );
        continue;
      }

      /*
       * pgvector's literal format is `[1,2,3]`, bound as a parameter and cast. Prisma has no vector
       * type, so this is raw — and it is a PARAMETER rather than interpolation even though the
       * content is numbers we generated, because the day somebody passes text through here is the
       * day interpolation becomes an injection.
       */
      await db.$executeRawUnsafe(
        `UPDATE knowledge_items SET embedding = $2::vector WHERE id = $1::uuid`,
        row.id,
        `[${vector.join(',')}]`,
      );
      embedded += 1;
    }
  }

  return { pending, embedded, failed };
}

/** What the job prints. Named so the entrypoint and the tests agree on the wording. */
export function describeEmbedRun(r: EmbedReport): string {
  if (r.pending === 0) return `embed: nothing to do — every prose row already has a vector`;
  return `embed: ${r.embedded} embedded, ${r.failed} failed, ${r.pending} were pending (${EMBED_MODEL})`;
}
