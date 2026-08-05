-- Shareable ship builds.
--
-- Squadron owner, 2026-08-01: "also include shareable links, and the ability for our users to share
-- their builds and make them visible to the squadron and public if they choose to please."
--
-- ★ PRIVATE BY DEFAULT, INCLUDING FOR EVERY EXISTING ROW ★
--
-- `DEFAULT 'private'` backfills every build already stored. That is the only safe direction: these
-- rows were written when there was no such thing as sharing, so nobody who submitted one agreed to
-- it being visible. A default of 'squadron' would publish the lot retroactively.
ALTER TABLE ship_builds
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

-- ★ THE TOKEN IS NULLABLE AND UNIQUE, WHICH POSTGRES ALLOWS ★
--
-- NULLs do not collide under a unique index, so every unshared build keeps a null and only the
-- shared ones occupy the namespace. No sentinel value, and no partial index needed.
ALTER TABLE ship_builds
  ADD COLUMN IF NOT EXISTS share_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ship_builds_share_token_key
  ON ship_builds (share_token);

-- ★ A CHECK CONSTRAINT, BECAUSE THIS COLUMN DECIDES WHO CAN READ THE ROW ★
--
-- The application validates it too. This is the layer that holds when somebody fixes data by hand
-- at 2am: a typo'd 'pubic' would not merely look wrong, it would fail every visibility comparison
-- and silently make the build unreachable — or, with the comparison written the other way, readable
-- by anyone.
ALTER TABLE ship_builds
  DROP CONSTRAINT IF EXISTS ship_builds_visibility_check;
ALTER TABLE ship_builds
  ADD CONSTRAINT ship_builds_visibility_check
  CHECK (visibility IN ('private', 'squadron', 'public'));

-- The share board's only query: shared builds, newest first.
CREATE INDEX IF NOT EXISTS ship_builds_visibility_updated_at_idx
  ON ship_builds (visibility, updated_at);
