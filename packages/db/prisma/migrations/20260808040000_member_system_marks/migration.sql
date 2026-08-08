-- Systems a member wants back without typing them again, and the small UI settings beside them.
--
-- ★ HAND-WRITTEN, DELIBERATELY ★
--
-- `prisma migrate dev` refused to generate this without resetting the database. It reads the
-- hand-written DDL from ssot/03-data/indexes.md — the GIN index on knowledge_items(data) among
-- others — as drift, because those objects exist in the database and in no migration. Resetting to
-- reconcile that would drop the galaxy dump and every market row to add two empty tables.
--
-- So this is written by hand and applied with `migrate deploy`, which applies what is pending
-- without auditing for drift. Same reason the migrations before it carry the same note.

-- Fourteen fields across the website and the app ask for a system, and every one is a bare text
-- box today. This is the store behind all of them.
CREATE TABLE "member_system_marks" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"      UUID         NOT NULL,
    -- Canonical spelling, as the galaxy holds it, NOT what was typed. Normalised on the way in so
    -- `col 285 sector gl-w c2-12` and the real thing are one row rather than two.
    "system_name"  TEXT         NOT NULL,
    -- Null is allowed on purpose: a member may name a system we do not hold yet, and refusing it
    -- would make this box worse than the plain text field it replaces.
    "system_id64"  BIGINT,
    -- 'pinned' survives forever; 'recent' is trimmed to the newest twenty by the writer. Text
    -- rather than an enum, because adding a kind should not lock a table every page reads.
    "kind"         TEXT         NOT NULL DEFAULT 'recent',
    -- A member's own name for a pin: "Home", "The dodec". Matched on as well as the real name.
    "label"        TEXT,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "use_count"    INTEGER      NOT NULL DEFAULT 1,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "member_system_marks_pkey" PRIMARY KEY ("id")
);

-- One row per system per member. The upsert on every successful search depends on this.
CREATE UNIQUE INDEX "member_system_marks_once"
    ON "member_system_marks" ("user_id", "system_name");

-- The dropdown's own query: this member, newest first, pins included.
CREATE INDEX "member_system_marks_user_id_kind_last_used_at_idx"
    ON "member_system_marks" ("user_id", "kind", "last_used_at");

ALTER TABLE "member_system_marks"
    ADD CONSTRAINT "member_system_marks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Small per-member settings that are not worth a column each. Opened for the freight office's
-- ranking control and deliberately general: the alternative is a migration every time a screen
-- grows a preference.
CREATE TABLE "member_preferences" (
    "user_id"    UUID           NOT NULL,
    -- Namespaced by feature, e.g. `freight.sort`.
    "key"        TEXT           NOT NULL,
    -- jsonb so a preference can become an object later without another migration.
    "value"      JSONB          NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "member_preferences_pkey" PRIMARY KEY ("user_id", "key")
);

ALTER TABLE "member_preferences"
    ADD CONSTRAINT "member_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
