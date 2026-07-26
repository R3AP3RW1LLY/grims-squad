import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';

/**
 * P0.2 — schema verification.
 *
 * These assertions exist because Prisma CANNOT express most of what makes this
 * schema correct. Partial indexes, expression indexes, generated columns, HNSW
 * and the Timescale hypertable are all hand-written DDL in the migration
 * (ssot/03-data/indexes.md), and a migration that silently omits them produces a
 * database that looks fine and is quietly wrong — a sequential scan instead of a
 * GiST lookup, or a uniqueness invariant that does not hold.
 *
 * Run against the dev stack: docker compose -f infra/docker/compose.dev.yml up -d
 */

const CONNECTION =
  process.env['DATABASE_URL'] ??
  'postgresql://grims:devpassword@localhost:5432/grimssquad?schema=public';

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: CONNECTION });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}

describe('P0.2 database schema', () => {
  it('installs every required extension', async () => {
    const r = await rows<{ extname: string }>(
      `select extname from pg_extension where extname = any($1::text[])`,
      [['citext', 'cube', 'vector', 'pgcrypto', 'timescaledb']],
    );
    const found = r.map((x) => x.extname).sort();
    expect(found).toEqual(['citext', 'cube', 'pgcrypto', 'timescaledb', 'vector']);
  });

  it('creates every table in the SSOT schema', async () => {
    const r = await rows<{ n: string }>(
      `select count(*)::text as n from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
         and table_name not like '\\_prisma%'`,
    );
    // 56 models in ssot/03-data/schema.prisma.
    expect(Number(r[0]?.n)).toBe(56);
  });

  describe('hand-written DDL that Prisma cannot express', () => {
    it('creates the GiST expression index on systems — the spatial workhorse', async () => {
      const r = await rows(`select 1 from pg_indexes where indexname = 'systems_xyz_idx'`);
      expect(r).toHaveLength(1);
    });

    it('creates both partial market_orders indexes', async () => {
      const r = await rows<{ indexname: string }>(
        `select indexname from pg_indexes
         where indexname in ('market_orders_sell_idx','market_orders_buy_idx') order by 1`,
      );
      expect(r.map((x) => x.indexname)).toEqual([
        'market_orders_buy_idx',
        'market_orders_sell_idx',
      ]);
    });

    it('creates the HNSW index on knowledge_chunks', async () => {
      const r = await rows(
        `select 1 from pg_indexes where indexname = 'knowledge_chunks_embedding_idx'`,
      );
      expect(r).toHaveLength(1);
    });

    it('makes market_history a TimescaleDB hypertable', async () => {
      const r = await rows<{ hypertable_name: string }>(
        `select hypertable_name from timescaledb_information.hypertables
         where hypertable_name = 'market_history'`,
      );
      expect(r).toHaveLength(1);
    });

    it('generates forum_posts.search_tsv rather than leaving it a plain column', async () => {
      const r = await rows<{ is_generated: string }>(
        `select is_generated from information_schema.columns
         where table_name = 'forum_posts' and column_name = 'search_tsv'`,
      );
      expect(r[0]?.is_generated).toBe('ALWAYS');
    });
  });

  describe('partial unique indexes that enforce invariants', () => {
    it('@INV-005 rejects a second VERIFIED claim on one CMDR name', async () => {
      const r = await rows(
        `select 1 from pg_indexes where indexname = 'cmdr_verifications_active_name_uniq'`,
      );
      expect(r).toHaveLength(1);
    });

    it('@INV-042 dedupes both ingestion paths on bgs_activity_reports', async () => {
      const r = await rows<{ indexname: string }>(
        `select indexname from pg_indexes
         where indexname in ('bgs_reports_event_uniq','bgs_reports_import_uniq') order by 1`,
      );
      expect(r.map((x) => x.indexname)).toEqual(['bgs_reports_event_uniq', 'bgs_reports_import_uniq']);
    });

    it('@INV-042 dedupes both ingestion paths on hauling_contributions', async () => {
      const r = await rows<{ indexname: string }>(
        `select indexname from pg_indexes
         where indexname in ('hauling_event_uniq','hauling_import_uniq') order by 1`,
      );
      expect(r.map((x) => x.indexname)).toEqual(['hauling_event_uniq', 'hauling_import_uniq']);
    });
  });

  describe('behavioural checks — the constraints actually hold', () => {
    it('@INV-005 a pending claim does NOT block the real owner, a verified one does', async () => {
      await db.query('begin');
      try {
        const u1 = await rows<{ id: string }>(
          `insert into users (handle, display_name) values ('probe_a','Probe A') returning id`,
        );
        const u2 = await rows<{ id: string }>(
          `insert into users (handle, display_name) values ('probe_b','Probe B') returning id`,
        );
        const a = u1[0]?.id;
        const b = u2[0]?.id;
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();

        // An UNVERIFIED pending claim takes no lock (RED-TEAM R7).
        await db.query(
          `insert into cmdr_verifications (user_id, cmdr_name, method, trust_tier, is_verified)
           values ($1,'Grimshaw','inara_nonce',2,false)`,
          [a],
        );
        await db.query(
          `insert into cmdr_verifications (user_id, cmdr_name, method, trust_tier, is_verified)
           values ($1,'Grimshaw','fdev_capi',3,true)`,
          [b],
        );

        // A second VERIFIED claim on the same name must be rejected.
        await expect(
          db.query(
            `insert into cmdr_verifications (user_id, cmdr_name, method, trust_tier, is_verified)
             values ($1,'Grimshaw','officer_manual',1,true)`,
            [a],
          ),
        ).rejects.toThrow(/duplicate key|unique/i);
      } finally {
        await db.query('rollback');
      }
    });

    it('@INV-006 stores a permission mask above 2^63 without truncation', async () => {
      await db.query('begin');
      try {
        // SITE_CONFIG is 1n << 63n = 9223372036854775808, one past int8 max.
        const mask = '9223372036854775808';
        const r = await rows<{ perm_mask: string }>(
          `insert into roles (key, name, perm_mask) values ('probe_role','Probe',$1::numeric)
           returning perm_mask::text as perm_mask`,
          [mask],
        );
        expect(r[0]?.perm_mask).toBe(mask);
      } finally {
        await db.query('rollback');
      }
    });

    it('populates the generated tsvector on insert', async () => {
      await db.query('begin');
      try {
        const u = await rows<{ id: string }>(
          `insert into users (handle, display_name) values ('probe_c','Probe C') returning id`,
        );
        const cat = await rows<{ id: string }>(
          `insert into forum_categories (slug, name) values ('probe-cat','Probe') returning id`,
        );
        const th = await rows<{ id: string }>(
          `insert into forum_threads (category_id, author_id, slug, title)
           values ($1,$2,'probe','Probe') returning id`,
          [cat[0]?.id, u[0]?.id],
        );
        const post = await rows<{ tsv: string | null }>(
          `insert into forum_posts (thread_id, author_id, body_md, body_html)
           values ($1,$2,'tritium hauling to shinrarta','<p>x</p>')
           returning search_tsv::text as tsv`,
          [th[0]?.id, u[0]?.id],
        );
        expect(post[0]?.tsv).toContain('tritium');
      } finally {
        await db.query('rollback');
      }
    });
  });
});

describe('seeded roles', () => {
  /**
   * The OR of every permission bit declared in ssot/04-contracts/permissions.ts
   * as of P1.3. Written out here rather than imported so this spec keeps its
   * only dependency on `pg` — and so a change to the contract has to be
   * mirrored deliberately rather than tracking silently.
   *   FORUM 0-6 · OPS 10-13 · FLEET 20-24 · BGS 30-32 · TRADE 40-42
   *   AI 50-53 · ADMIN 60-63 · TELEMETRY 70
   */
  const ALL_PERMISSIONS = [
    0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 20, 21, 22, 23, 24, 30, 31, 32, 40, 41, 42, 50, 51, 52,
    53, 60, 61, 62, 63, 70,
  ].reduce((acc, bit) => acc | (1n << BigInt(bit)), 0n);

  it('webmaster carries exactly ALL_PERMISSIONS, bit for bit @INV-006', async () => {
    // This test caught a real defect. The migration originally computed the mask
    // as (2^0 + 2^1 + ... + 2^70). Postgres `^` returns DOUBLE PRECISION, so the
    // high bits lost precision before the cast to numeric(40,0) and the row was
    // seeded as 1197902339489250000000 instead of 1197902339489246755967 —
    // setting bits nobody intended and clearing ones that were, silently, in the
    // single most powerful role in the system.
    const r = await rows<{ perm_mask: string; is_hierarchical: boolean }>(
      `select perm_mask::text, is_hierarchical from roles where key = 'webmaster'`,
    );
    expect(r).toHaveLength(1);
    expect(BigInt(r[0]!.perm_mask)).toBe(ALL_PERMISSIONS);
    // An orthogonal tag, not a squadron rank.
    expect(r[0]!.is_hierarchical).toBe(false);
  });

  it('webmaster is mapped to NO Discord role', async () => {
    // The whole point of it: a support role that exists independently of the
    // squadron hierarchy. A mapping would let Discord role sync revoke it.
    const r = await rows<{ n: string }>(
      `select count(*)::text as n from role_mappings m
       join roles r on r.id = m.role_id where r.key = 'webmaster'`,
    );
    expect(Number(r[0]!.n)).toBe(0);
  });
});
