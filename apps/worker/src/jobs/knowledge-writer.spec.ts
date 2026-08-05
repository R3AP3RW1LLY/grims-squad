import { describe, it, expect, vi } from 'vitest';
import { writeBatch } from './knowledge-writer.js';

/**
 * Writing knowledge rows.
 *
 * The SQL is raw because Prisma has no type for `cube` or `vector`, so the things a query builder
 * would normally guarantee have to be asserted here instead.
 */

function fakeDb(outcome?: Array<{ inserted: boolean }>) {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      executed.push({ sql, params });
      return 1;
    }),
    /*
     * The upsert reads rows back now — `RETURNING (xmax = 0)` is how Postgres reports which rows it
     * created rather than updated, and the audit log's "new versus updated" depends on it. Recorded
     * in the same list, because these tests are about the SQL that gets built and that is the same
     * question whichever call carries it.
     */
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      executed.push({ sql, params });
      return outcome ?? [];
    }),
    auditLog: { create: vi.fn(async () => ({})) },
  } as never;
  return { db, executed };
}

const row = (over: Record<string, unknown> = {}) => ({
  source: 'galaxy',
  kind: 'system',
  extKey: '123',
  name: 'Deciat',
  data: { security: 'High' },
  ...over,
});

describe('MANDATORY: nothing is ever interpolated into SQL', () => {
  it('a hostile name is a PARAMETER, not part of the statement', () => {
    /*
     * These rows carry names written by Frontier and by players. Building the statement as a string
     * would be faster and is exactly how an injection gets in.
     */
    const { db, executed } = fakeDb();
    void writeBatch(db, [row({ name: "Robert'); DROP TABLE knowledge_items;--" })]);

    return Promise.resolve().then(() => {
      const call = executed[0];
      expect(call?.sql).not.toContain('DROP TABLE');
      expect(call?.params).toContain("Robert'); DROP TABLE knowledge_items;--");
    });
  });

  it('coordinates are bound numbers, not a formatted string', async () => {
    // cube(array[...]) built from three placeholders. A formatted string would be the same hole in
    // a less obvious place.
    const { db, executed } = fakeDb();
    await writeBatch(db, [row({ coords: { x: 1.5, y: -2.25, z: 3 } })]);

    expect(executed[0]?.sql).toMatch(/cube\(array\[\$\d+::float8,\$\d+::float8,\$\d+::float8\]\)/);
    expect(executed[0]?.params).toEqual(expect.arrayContaining([1.5, -2.25, 3]));
  });
});

describe('MANDATORY: re-ingesting updates rather than duplicating', () => {
  it('upserts on the unique key', async () => {
    /*
     * Spansh rebuilds nightly. Insert-only would double the galaxy every night; delete-then-insert
     * would leave the assistant with no knowledge for the length of the import.
     */
    const { db, executed } = fakeDb();
    await writeBatch(db, [row()]);

    expect(executed[0]?.sql).toContain('ON CONFLICT (source, kind, ext_key) DO UPDATE');
  });

  it('MANDATORY: an update clears the embedding ONLY when the text changed', async () => {
    /*
     * ★ THIS TEST USED TO ASSERT THE OPPOSITE, AND WAS RIGHT AT THE TIME ★
     *
     * It required `embedding` to be absent from the update set entirely, because it is written by
     * the embedder and clearing it every night would silently un-embed everything — the assistant
     * would quietly stop finding guides.
     *
     * That held while text never changed. It stopped holding the moment structured rows started
     * carrying a generated description: a vector describes the WORDS it was made from, so a
     * reworded row keeps a vector answering for content that no longer exists. Retrieval still
     * returns rows; they are simply the wrong ones, and nothing anywhere notices.
     *
     * Both halves matter, so both are asserted. Unconditionally clearing would throw away 448,676
     * vectors and an hour of GPU time on every nightly re-ingest of unchanged data.
     */
    const { db, executed } = fakeDb();
    await writeBatch(db, [row()]);

    const updateClause = executed[0]?.sql.slice(executed[0].sql.indexOf('DO UPDATE')) ?? '';

    // It IS in the update set now...
    expect(updateClause).toContain('embedding');
    // ...but only behind a comparison of old text against new.
    expect(updateClause).toContain('IS DISTINCT FROM');
    expect(updateClause).toContain('knowledge_items.embedding');
  });

  it('refreshes ingested_at, so a stable row does not look stale', async () => {
    // Without this a row that stopped changing keeps its original timestamp forever, and the
    // training page reports the source as stale while it is refreshed nightly.
    const { db, executed } = fakeDb();
    await writeBatch(db, [row()]);
    expect(executed[0]?.sql).toMatch(/ingested_at\s*=\s*now\(\)/);
  });
});

describe('batching', () => {
  it('sends one statement for the whole batch', async () => {
    // One statement per row is tens of millions of round trips for the galaxy.
    const { db, executed } = fakeDb();
    await writeBatch(db, [row({ extKey: '1' }), row({ extKey: '2' }), row({ extKey: '3' })]);

    expect(executed).toHaveLength(1);
    expect(executed[0]?.sql.match(/\(\$/g)).toHaveLength(3);
  });

  it('an empty batch never touches the database', async () => {
    const { db, executed } = fakeDb();
    expect(await writeBatch(db, [])).toEqual({ inserted: 0, updated: 0 });
    expect(executed).toHaveLength(0);
  });

  it('MANDATORY: separates rows it created from rows it refreshed', async () => {
    /*
     * ★ WHAT THE AUDIT LOG REPORTS AS "new / updated" ★
     *
     * Squadron owner asked for that split. There is no count for it in an upsert — the command tag
     * reports only the total — so the statement reads `(xmax = 0)` back per row: zero for a version
     * this statement created, non-zero for one it replaced.
     *
     * Without the split, an import of 448,676 rows reads identically whether a game update added a
     * thousand stations or nothing moved at all.
     */
    const { db } = fakeDb([{ inserted: true }, { inserted: false }, { inserted: false }]);

    expect(await writeBatch(db, [row({ extKey: '1' }), row({ extKey: '2' }), row({ extKey: '3' })])).toEqual(
      { inserted: 1, updated: 2 },
    );
  });

  it('rows without coordinates are still written', async () => {
    // Ships and blueprints have no position. They must not be dropped for lacking one.
    const { db, executed } = fakeDb();
    await writeBatch(db, [row({ source: 'coriolis', kind: 'ship', coords: null })]);
    expect(executed[0]?.sql).toContain('NULL)');
  });
});
