import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { EMBED_DIMS, STORAGE_KIND } from '@grims/shared';
import { embedKnowledge } from './embed-knowledge.js';

/**
 * The embedder.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "my 3060 is dead silent shows no activity! should it not be embedding?"
 *
 * Half right — and the half that was right had never been built, which is why nothing had ever
 * embedded anything. These tests pin the two things that make it safe to run unattended: it must
 * never touch the structured sources, and it must never livelock on a row the model refuses.
 */

function fakeDb(rows: Array<{ id: string; text: string }>) {
  const updates: Array<{ id: string; vector: string }> = [];
  let served = false;

  const db = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('COUNT(*)')) return [{ n: BigInt(rows.length) }];
      // Served once; the second call returns nothing, which is how the loop terminates.
      if (served) return [];
      served = true;
      void params;
      return rows;
    }),
    $executeRawUnsafe: vi.fn(async (_sql: string, id: string, vector: string) => {
      updates.push({ id, vector });
      return 1;
    }),
  } as unknown as PrismaClient;

  return { db, updates };
}

const vector = (fill = 0.5) => new Array(EMBED_DIMS).fill(fill);

describe('what gets embedded', () => {
  it('MANDATORY: asks only for sources the contract marks as vector', async () => {
    /*
     * ★ THE THREE-WEEK MISTAKE THIS PREVENTS ★
     *
     * Embedding 448,676 systems would take roughly three weeks on this hardware and produce a
     * WORSE assistant: asked about "Deciat" a vector search returns Deciak and Decius, because they
     * sit near it in embedding space. "Which stations in Deciat have a large pad" has one correct
     * answer and an index built for similarity cannot give it.
     *
     * The source list is DERIVED from STORAGE_KIND rather than written out, so this cannot drift.
     */
    const { db } = fakeDb([]);
    await embedKnowledge(db, { embed: async () => vector() });

    const call = (db.$queryRawUnsafe as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const sources = call?.[1] as string[];

    expect(sources).toContain('forum');
    expect(sources).toContain('reference');
    expect(sources).not.toContain('galaxy');
    expect(sources).not.toContain('coriolis');

    // And the contract still says so, in case somebody flips one.
    expect(STORAGE_KIND.galaxy).toBe('lookup');
    expect(STORAGE_KIND.forum).toBe('vector');
  });

  it('writes a pgvector literal', async () => {
    const { db, updates } = fakeDb([{ id: 'a', text: 'how to get more jump range' }]);

    const r = await embedKnowledge(db, { embed: async () => vector(0.25) });

    expect(r.embedded).toBe(1);
    expect(updates[0]?.vector.startsWith('[0.25,')).toBe(true);
  });
});

describe('a model that refuses', () => {
  it('MANDATORY: marks the row instead of retrying it for ever', async () => {
    /*
     * ★ THE LIVELOCK THIS PREVENTS ★
     *
     * The work remaining is defined as "prose rows with no vector". A row the model refuses would
     * therefore be selected again on the very next pass, and every pass after that — the loop never
     * advances and nothing behind it is ever embedded. Classic queue livelock, and it would look
     * like the job simply running for ever.
     */
    const { db, updates } = fakeDb([{ id: 'a', text: 'x' }]);

    const r = await embedKnowledge(db, { embed: async () => null });

    expect(r.failed).toBe(1);
    expect(r.embedded).toBe(0);
    // Written anyway, so it leaves the pending set. All zeros, which nothing real ever is.
    expect(updates).toHaveLength(1);
    expect(updates[0]?.vector.startsWith('[0,0,0')).toBe(true);
  });

  it('MANDATORY: refuses a vector of the wrong width', async () => {
    /*
     * Swapping the embedding model changes the vector length. A 512-wide vector written into a
     * vector(768) column fails at the database with an error naming neither this file nor the
     * model — and it would fail on every row, after the GPU had done all the work.
     */
    const { db } = fakeDb([{ id: 'a', text: 'x' }]);

    const r = await embedKnowledge(db, { embed: async () => new Array(512).fill(0.1) });

    expect(r.failed).toBe(1);
  });
});

describe('nothing to do', () => {
  it('reports zero without touching the model', async () => {
    const { db } = fakeDb([]);
    const embed = vi.fn(async () => vector());

    const r = await embedKnowledge(db, { embed });

    expect(r.pending).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });
});
