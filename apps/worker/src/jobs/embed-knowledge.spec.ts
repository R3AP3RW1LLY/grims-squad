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
  it('MANDATORY: embeds every source the contract marks, which is now all of them', async () => {
    /*
     * ★ THIS TEST USED TO ASSERT THE OPPOSITE ★
     *
     * It required the galaxy to be EXCLUDED, on the grounds that embedding 448,676 systems would
     * take "roughly three weeks". Measured on the actual card: 104/s at concurrency 8, so just over
     * an hour. The figure was inherited and never checked, and it shaped the design.
     *
     * What has NOT changed is that embedding is added rather than substituted — "which stations in
     * Deciat have a large pad" is still an exact lookup, because a similarity search answers it
     * with Deciak. `STORAGE_KIND` says `both` for those sources and that is the point of the word.
     *
     * The list is DERIVED from the contract rather than written out here, so it cannot drift.
     */
    const { db } = fakeDb([]);
    await embedKnowledge(db, { embed: async () => vector() });

    const call = (db.$queryRawUnsafe as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const sources = call?.[1] as string[];

    for (const s of ['forum', 'reference', 'galaxy', 'coriolis', 'journal', 'inara']) {
      expect(sources, s).toContain(s);
    }

    // Indexed AND embedded — not one instead of the other.
    expect(STORAGE_KIND.galaxy).toBe('both');
    expect(STORAGE_KIND.forum).toBe('vector');
  });

  it('embeds only the source it was asked for', async () => {
    /*
     * The cadences differ by orders of magnitude — the forum every five minutes, the galaxy after
     * its nightly import. One job sweeping everything on the fastest schedule would re-scan 448,676
     * rows every five minutes to find nothing.
     */
    const { db } = fakeDb([]);
    await embedKnowledge(db, { embed: async () => vector() }, { sources: ['forum'] });

    const call = (db.$queryRawUnsafe as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[1]).toEqual(['forum']);
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

/**
 * ★ THE STARVATION BUG — PRODUCTION, 2026-08-24 ★
 *
 * The squadron owner: "it looks like these are not being embedded ... Systems our members have flown
 * to — 73 awaiting embedding".
 *
 * They were right, and nothing was failing. The selection ran across every source at once, ordered
 * by `ingested_at`, defended in a comment as "a source that has just been ingested should not jump
 * ahead of one that has been waiting". True between comparable sources; catastrophic once one source
 * is a bulk import.
 *
 * In production the EDDN galaxy backfill held 884,910 rows pending from 9 August. Members' own
 * visited systems arrived on 22 August, 73 of them, and sorted BEHIND all 884,910 — roughly twenty
 * nights from being reached at the observed rate. Every run reported success, because it WAS
 * succeeding: it embedded tens of thousands of rows a night, just never those.
 */
function twoSourceDb(backlog: Record<string, number>) {
  const servedBySource = new Map<string, boolean>();
  const embeddedIds: string[] = [];

  const db = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('GROUP BY source')) {
        /*
         * Returned LARGEST FIRST, on purpose.
         *
         * A fake that helpfully sorts these is a fake that passes whichever order the code asks
         * for — which is exactly what happened the first time these tests were written, and
         * reversing the real ordering did not fail one of them. Handing back the worst possible
         * order is what makes the assertion below mean something.
         */
        return Object.entries(backlog)
          .map(([source, n]) => ({ source, n: BigInt(n) }))
          .sort((a, b) => Number(b.n) - Number(a.n));
      }

      const source = String(params[0]);
      // One page per source, then empty — which is how the inner loop terminates.
      if (servedBySource.get(source) === true) return [];
      servedBySource.set(source, true);

      return Array.from({ length: backlog[source] ?? 0 }, (_, i) => ({
        id: `${source}-${i}`,
        text: `${source} row ${i}`,
      }));
    }),
    $executeRawUnsafe: vi.fn(async (_sql: string, id: string) => {
      embeddedIds.push(id);
      return 1;
    }),
  } as unknown as PrismaClient;

  return { db, embeddedIds };
}

describe('a small source behind a huge one', () => {
  it('★ MANDATORY: the small queue is drained FIRST, not twenty nights later ★', () => {
    /*
     * The whole fix in one assertion. `companion` has 73 rows and `eddn` has hundreds of thousands;
     * the member-facing ones must not be behind the bulk import.
     */
    return (async () => {
      const { db, embeddedIds } = twoSourceDb({ eddn: 500, companion: 3 });

      await embedKnowledge(db, { embed: async () => vector() }, { limit: 10 });

      expect(embeddedIds.length).toBeGreaterThan(0);
      const firstThree = embeddedIds.slice(0, 3);
      expect(firstThree.every((id) => id.startsWith('companion-')), firstThree.join(',')).toBe(true);
    })();
  });

  it('★ MANDATORY: counts the backlog across every source, not just the first ★', async () => {
    /*
     * `pending` is what decides whether the run announces itself at all. Counting one source would
     * make a sweep that cleared a real backlog report "nothing to do" and stay silent.
     */
    const { db } = twoSourceDb({ eddn: 500, companion: 3 });

    const r = await embedKnowledge(db, { embed: async () => vector() }, { limit: 1000 });

    expect(r.pending).toBe(503);
  });

  it('still honours the overall limit across sources', async () => {
    // The budget is shared. A small source draining first must not let the total run over.
    const { db, embeddedIds } = twoSourceDb({ eddn: 500, companion: 3 });

    await embedKnowledge(db, { embed: async () => vector() }, { limit: 4 });

    expect(embeddedIds.length).toBeLessThanOrEqual(BATCH_UPPER_BOUND);
    expect(embeddedIds.some((id) => id.startsWith('companion-'))).toBe(true);
  });
});

/*
 * A single page is served per source, so a run cannot exceed one page beyond its budget. The limit
 * is checked between pages rather than between rows — deliberately, since a page is already in
 * flight on the card by then.
 */
const BATCH_UPPER_BOUND = 512;
