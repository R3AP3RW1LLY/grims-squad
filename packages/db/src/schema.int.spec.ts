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

  // The count is hardcoded ON PURPOSE. Every schema addition has to come and
  // bump it, which is a two-second acknowledgement that a table was added —
  // versus a self-counting assertion that would let one appear unnoticed.
  // 70 as of 2026-07-30: ai_calls — every call to the AI, kept for officer review. Visible to
  // officers AND the webmaster, who is the AI developer and cannot debug a model whose output they
  // cannot see. Members are told it is not private; a log people do not know about is a different
  // thing from one they do.
  // 69 as of 2026-07-30: forum_signatures — the block under a member's posts. Its avatar column is
  // deliberately SEPARATE from users.avatar_stored_hash: the signature avatar shows on the forums
  // only and must never overwrite the Discord import, which would be silently undone by the next
  // sync while the member watched their picture change on its own.
  // 68 as of 2026-07-30: forum_category_reads — when a member last looked at a board, for the
  // "new posts" indicator on the category cards. Per BOARD rather than per thread: per-thread read
  // state costs a row per member per thread and would become the largest table in the schema
  // within a year, written on every page view, to drive a dot on a card.
  // 67 as of 2026-07-29: media_uploads — images a member uploaded, AFTER hardening. Every row
  // describes a file this application encoded rather than one that arrived: the upload is decoded
  // to pixels and re-encoded, so no EXIF, polyglot or appended payload survives. There is
  // deliberately no original-filename column.
  // 66 as of 2026-07-29: forum_thread_grants — per-thread read access for a NAMED
  // user, so an admin can let one non-officer into one officers' thread without
  // opening the board. It is the only thing in the forum that WIDENS access past a
  // category ACL, which is why it is a table of attributable rows (granted_by,
  // granted_at) rather than a flag.
  // 65 as of 2026-07-28: member_activity_days. The monthly table carries one
  // last_activity_at, so a daily chart built from it counts each member on the
  // ONE day they were last seen — a member active on the 5th and the 20th
  // appeared only on the 20th. Display only; promotion still reads the monthly
  // table, and a disagreement between them must never change who is promoted.
  // 64 was discord_guild_members, a CACHE of every member of the
  // guild — account or not. discord_identities is keyed on a website user id
  // and existed for 1 of 51 members, so the admin activity table could name
  // exactly one person and showed raw snowflakes for the rest.
  // 63 was inara_commander_profiles, a CACHE of Inara's public
  // view of each verified commander. Nothing on a request path may call Inara
  // (ADR-004), so the roster reads this and a 20-minute worker sweep fills it.
  // 62 was discord_roles, the guild's role names and colours. 61 was
  // inara_links (P1.8b), 60 with two_factor_credentials and
  // two_factor_recovery_codes, 58 before rank progression.
  it('creates every table in the SSOT schema', async () => {
    const r = await rows<{ n: string }>(
      `select count(*)::text as n from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
         and table_name not like '\\_prisma%'`,
    );
    // 71 tables: 70 Prisma models plus screen_decisions, added 2026-07-31 for the screening
    // feedback loop. Its vector column is hand-written in the migration because Prisma has no
    // native pgvector type and would drop it on every generated diff.
    //
    // 74 as of 2026-08-01: market_entries, one row per station-commodity, flattened out of the
    // galaxy dump's nested JSON. Route-finding across a hundred thousand markets was a four-way
    // self-join over jsonb that exhausted the disk and took Postgres down with it; the same
    // question against this table is an indexed lookup. Hand-written too — its `cube` column has
    // no Prisma type either.
    //
    // 77 as of 2026-08-01: forum_votes, xp_events and member_badges. Reputation — the owner asked
    // for "upvote, downvote and answer buttons like stack overflow ... an xp and badge system".
    // xp_events is a LEDGER rather than a counter on users: a number that only goes up cannot say
    // why somebody has 340, cannot be corrected, and cannot be audited if anything ever
    // double-awards.
    //
    // 78 as of 2026-08-01: training_images. "Help Train the Bot" — members offering screenshots for
    // the image models. A separate row from media_uploads because an upload is a FILE and this is an
    // OFFER: which concept it teaches, what the member says is in it, and whether they still consent.
    //
    // 79 as of 2026-08-01: ai_log_lines. The live panel is a hundred-line ring buffer in memory,
    // gone on restart — the owner asked for "a record of them", and "what did the screener say at
    // 3am on Tuesday" had no answer. Deliberately NOT folded into ai_calls: half of what crosses
    // the stream is not a call to the model.
    //
    // 80 as of 2026-08-01: device_links. The companion app signs in with Discord instead of the
    // member copying a `gsq_…` token out of the website and pasting it in. A desktop app cannot
    // hold a client secret and has no trustworthy redirect target, so it never performs the OAuth
    // exchange — it shows a code, the member approves it in their own browser, and the app collects
    // the result. This table is that handshake's state, and it is short-lived by construction.
    //
    // 81 as of 2026-08-01: ship_builds. Fitted ships, from a build link a member found in the wild
    // or read straight out of their own journal. The DECODED build is stored rather than the link:
    // re-decoding on read would tie every answer to somebody else's website staying up and keeping
    // its format, and a build that decoded last month would start failing after their deploy.
    expect(Number(r[0]?.n)).toBe(81);
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
   *   FORUM 0-7 · OPS 10-13 · FLEET 20-24 · BGS 30-32 · TRADE 40-42
   *   AI 50-53 · ADMIN 60-63 · TELEMETRY 70
   *
   * ★ BIT 7 ADDED 2026-07-29: FORUM_POST_GUIDE ★
   *
   * "Written out here rather than imported ... so a change to the contract has to be
   * mirrored deliberately rather than tracking silently" — and that is exactly what
   * happened. Adding FORUM_POST_GUIDE to the SSOT failed this test with a mask 128
   * larger than the list, which is the deliberate mirroring working as designed.
   *
   * Worth recording because the failure LOOKED like a stale build: the value the test
   * wanted was the old ALL_PERMISSIONS, the dist had already been rebuilt correctly, and
   * clearing the vitest cache changed nothing. The list is local by design.
   */
  /*
   * ★ BITS 55 AND 56 ADDED 2026-08-01: AI_TRAINING, AI_TRAIN_SUBMIT ★
   *
   * The deliberate mirroring working again, and worth recording because it failed in BOTH
   * directions within one session:
   *
   *   First the stored mask was SMALLER than this list — the roles had not been granted the new
   *   bits, because adding a permission to the contract does not touch the database. That needed a
   *   migration.
   *
   *   Then it was LARGER — the migration had run and this list had not been updated.
   *
   * Neither failure is a stale build, and both look like one. The list is local by design; see the
   * note above.
   */
  const ALL_PERMISSIONS = [
    0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 20, 21, 22, 23, 24, 30, 31, 32, 40, 41, 42, 50, 51,
    52, 53, 54, 55, 56, 60, 61, 62, 63, 70,
  ].reduce((acc, bit) => acc | (1n << BigInt(bit)), 0n);

  /**
   * ★ THE CONTRACT CHANGED ON 2026-07-29, AND THE PRECISION PROPERTY DID NOT ★
   *
   * This asserted `ALL_PERMISSIONS` exactly. The squadron owner then drew a line
   * the codebase had not: "webmaster should not be able to post to Announcements,
   * as this is for officers ... they do need all website functions but not posting
   * to the web app announcements."
   *
   * So the expected value is now ALL_PERMISSIONS minus FORUM_POST_OFFICER. What
   * this test EXISTS for is unchanged and still asserted bit-for-bit: it caught a
   * real defect where the migration computed the mask as (2^0 + 2^1 + ... + 2^70),
   * and Postgres `^` returns DOUBLE PRECISION — so the high bits lost precision
   * before the cast to numeric(40,0) and the row was seeded as
   * 1197902339489250000000 instead of 1197902339489246755967, setting bits nobody
   * intended and clearing ones that were, silently, in the most powerful role in
   * the system.
   *
   * Expressed as a subtraction from the full set rather than a new literal, so it
   * still fails on a precision fault rather than merely on the wrong total.
   */
  it('webmaster carries every website permission EXCEPT squadron standing @INV-006', async () => {
    const FORUM_POST_OFFICER = 1n << 6n;
    const FORUM_VIEW_OFFICER = 1n << 4n;
    const SQUADRON_STANDING = FORUM_POST_OFFICER | FORUM_VIEW_OFFICER;

    const r = await rows<{ perm_mask: string; is_hierarchical: boolean }>(
      `select perm_mask::text, is_hierarchical from roles where key = 'webmaster'`,
    );
    expect(r).toHaveLength(1);
    const stored = BigInt(r[0]!.perm_mask);

    /*
     * ★ FORUM_VIEW_OFFICER IS MASKED OFF BEFORE COMPARING, AND THAT IS NOT A FUDGE ★
     *
     * This test reads the LIVE database, and FORUM_VIEW_OFFICER is the one bit whose
     * value legitimately differs between machines. Owner, 2026-07-29: "allow the
     * webmaster to see this in development env only please!" — implemented as an
     * explicit data grant (`pnpm --filter @grims/db dev:grant-officer-view`) rather
     * than an `if (NODE_ENV)` in an authz path.
     *
     * So a developer who has run that script has the bit set and CI does not. Asserting
     * the exact stored mask therefore passes in one place and fails in the other, which
     * is what happened when this bit was added: the test failed locally for a
     * completely correct database.
     *
     * Masking it off keeps EVERY OTHER BIT exact — still a subtraction from
     * ALL_PERMISSIONS, so it still catches a numeric-precision fault (the reason this
     * test exists) rather than merely a wrong total. The dev-grantable bit is then
     * asserted separately below, as the property that is true in both environments.
     */
    expect(stored & ~FORUM_VIEW_OFFICER).toBe(ALL_PERMISSIONS & ~SQUADRON_STANDING);

    /*
     * FORUM_POST_OFFICER is withheld EVERYWHERE, in every environment, and nothing
     * grants it back — there is no dev script for this one. Speaking in the squadron's
     * name is squadron standing, and running the website is not.
     */
    expect(stored & FORUM_POST_OFFICER).toBe(0n);

    /*
     * Nothing else was lost. The difference from the full set is squadron standing and
     * nothing more — allowing for the dev grant having returned the view bit.
     */
    expect(ALL_PERMISSIONS & ~stored & ~FORUM_VIEW_OFFICER).toBe(FORUM_POST_OFFICER);

    // And the guides bit IS held: the webmaster maintains the site's own documentation.
    // Owner: "widen to officers too" — a bit officers and the webmaster share.
    expect(stored & (1n << 7n)).toBe(1n << 7n);

    // An orthogonal tag, not a squadron rank.
    expect(r[0]!.is_hierarchical).toBe(false);
  });

  /**
   * Posting in an officer board requires a POST permission, not a VIEW one.
   *
   * Caught while verifying the change above: the officers board was seeded with
   * `post_perm = FORUM_VIEW_OFFICER`, so anybody who could SEE it could post in
   * it — which is precisely what having a separate post permission is for.
   */
  it('the officers board gates posting on FORUM_POST_OFFICER, not a view bit', async () => {
    const r = await rows<{ post_perm: string | null; view_perm: string | null }>(
      `select post_perm::text, view_perm::text from forum_categories where slug = 'officers'`,
    );
    // Skipped rather than failed when the board has not been seeded in this
    // database — the assertion is about its shape, not about it existing.
    if (r.length === 0) return;

    expect(BigInt(r[0]!.post_perm ?? '0')).toBe(1n << 6n); // FORUM_POST_OFFICER
    expect(BigInt(r[0]!.view_perm ?? '0')).toBe(1n << 4n); // FORUM_VIEW_OFFICER
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
