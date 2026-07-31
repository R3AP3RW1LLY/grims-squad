import { describe, it, expect, vi } from 'vitest';
import { writeBatch } from './knowledge-writer.js';

/**
 * Writing knowledge rows.
 *
 * The SQL is raw because Prisma has no type for `cube` or `vector`, so the things a query builder
 * would normally guarantee have to be asserted here instead.
 */

function fakeDb() {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      executed.push({ sql, params });
      return 1;
    }),
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

  it('MANDATORY: an update never clears the embedding', async () => {
    /*
     * `embedding` is written by the embedder, not the ingest. Including it in the update set would
     * silently un-embed every prose source on each nightly run, and the assistant would quietly
     * stop finding guides.
     */
    const { db, executed } = fakeDb();
    await writeBatch(db, [row()]);

    const updateClause = executed[0]?.sql.slice(executed[0].sql.indexOf('DO UPDATE')) ?? '';
    expect(updateClause).not.toContain('embedding');
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

  it('an empty batch touches the database at all', async () => {
    const { db, executed } = fakeDb();
    expect(await writeBatch(db, [])).toBe(0);
    expect(executed).toHaveLength(0);
  });

  it('rows without coordinates are still written', async () => {
    // Ships and blueprints have no position. They must not be dropped for lacking one.
    const { db, executed } = fakeDb();
    await writeBatch(db, [row({ source: 'coriolis', kind: 'ship', coords: null })]);
    expect(executed[0]?.sql).toContain('NULL)');
  });
});
