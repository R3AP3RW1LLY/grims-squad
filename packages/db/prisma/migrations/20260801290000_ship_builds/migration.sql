-- Fitted ships, imported from a build link or read out of a member's own journal.
--
-- ★ THE DECODED BUILD IS STORED, NOT THE LINK ★
--
-- Re-decoding on every read would tie every answer to somebody else's website staying up and
-- keeping its format, and a build that decoded correctly last month would start failing silently
-- after their deploy. The URL is kept beside it so a member can get back to the original.
--
-- Stats are stored for the same reason in the other direction: they must not change when
-- coriolis-data refreshes underneath them. A member asking twice and getting two jump ranges for
-- one ship has no way to tell which is true.
--
-- Hand-written, like every migration here: prisma migrate dev proposes dropping the pgvector HNSW
-- index, the cube GiST index and the tsvector indexes every time. See ADR-020.

CREATE TABLE IF NOT EXISTS "ship_builds" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ship_id"         TEXT NOT NULL,
  "ship_name"       TEXT NOT NULL,
  "build_name"      TEXT,
  "source"          TEXT NOT NULL,
  "source_url"      TEXT NOT NULL,
  "build"           JSONB NOT NULL,
  "stats"           JSONB,
  "submitted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "is_baseline"     BOOLEAN NOT NULL DEFAULT false,
  "from_journal"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- One journal build per member per ship: a refit REPLACES it rather than adding a second row.
--
-- Pasted links are deliberately not unique. Two members may share the same build, and one member
-- may keep several plans for one hull — both are normal and neither is a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "ship_builds_one_journal_per_ship"
  ON "ship_builds" ("submitted_by_id", "ship_id", "from_journal");

CREATE INDEX IF NOT EXISTS "ship_builds_ship_idx" ON "ship_builds" ("ship_id");
-- Partial: the baseline is a handful of rows against everything members submit, and "show me the
-- reference builds" is the query the admin console and the AI both open with.
CREATE INDEX IF NOT EXISTS "ship_builds_baseline_idx" ON "ship_builds" ("is_baseline") WHERE "is_baseline";
CREATE INDEX IF NOT EXISTS "ship_builds_submitter_idx" ON "ship_builds" ("submitted_by_id");
