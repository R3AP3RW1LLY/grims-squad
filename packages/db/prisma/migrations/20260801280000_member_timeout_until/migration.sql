-- When a Discord timeout on a member expires.
--
-- Mirrored from Discord's `communication_disabled_until`, so the Squad Members roster is one
-- database read rather than a rate-limited call to Discord on every page load.
--
-- ★ A ROW IN THE PAST MEANS NOT TIMED OUT ★
--
-- Discord expires a timeout on its own and sends nothing when it does. Readers compare against the
-- clock; testing for null would show an expired timeout as active for ever.
--
-- Hand-written, like every migration here: prisma migrate dev proposes dropping the pgvector HNSW
-- index, the cube GiST index and the tsvector indexes every time. See ADR-020.

ALTER TABLE "discord_guild_members"
  ADD COLUMN IF NOT EXISTS "timeout_until" TIMESTAMPTZ(6);

-- Partial index: the roster asks "who is timed out RIGHT NOW", which is a small set on a table of a
-- hundred and something rows. Indexing the nulls would be most of the table for no reader.
CREATE INDEX IF NOT EXISTS "discord_guild_members_timeout_idx"
  ON "discord_guild_members" ("timeout_until")
  WHERE "timeout_until" IS NOT NULL;
