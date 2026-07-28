-- Inara's public view of a commander, cached.
--
-- Nothing on a request path may call Inara (ADR-004). The roster reads this
-- table; a scheduled sweep is the only thing that writes it. A missing or stale
-- row therefore renders as missing or stale, and no page load can be delayed,
-- rate-limited, or broken by a third party being unavailable.
--
-- `is_found` false means Inara ANSWERED and had no such commander — a member
-- with no Inara account, which is the common case and not a failure. That is a
-- different fact from having no row at all, which means we have never asked.
-- Without the distinction, the sweep would retry every known-absent commander
-- forever as though the last attempt had failed.

CREATE TABLE IF NOT EXISTS "inara_commander_profiles" (
  "user_id"       UUID PRIMARY KEY,
  -- The name we ASKED about. CITEXT because Elite treats commander names
  -- case-insensitively, and so must any later comparison against a rename.
  "search_name"   CITEXT NOT NULL,
  -- Resolved onto our own rank ladders before storage, so the roster does no
  -- interpretation at render time and Inara's wording cannot leak into the UI.
  "ranks"         JSONB NOT NULL DEFAULT '[]'::jsonb,
  "squadron_name" TEXT,
  "squadron_rank" TEXT,
  "fetched_at"    TIMESTAMPTZ(6) NOT NULL,
  "is_found"      BOOLEAN NOT NULL DEFAULT FALSE,

  CONSTRAINT "inara_commander_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- Sweeps read oldest-first when a run has to be partial, and staleness is what
-- the roster labels each card with.
CREATE INDEX IF NOT EXISTS "inara_commander_profiles_fetched_at_idx"
  ON "inara_commander_profiles" ("fetched_at");
