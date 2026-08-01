-- When a member joined the Discord server.
--
-- ★ WHY THIS IS THE SQUADRON TENURE ★
--
-- Asked for from Inara first. Inara cannot supply it: getcommanderprofile returns squadronName and
-- squadronMemberRank and no date, and there is no roster endpoint. The game does not record it
-- either — SquadronStartup carries a name and a rank. The Discord join date is the only exact
-- answer that exists, and for a squadron that recruits through Discord it is the right one.
--
-- ★ HAND-WRITTEN, LIKE EVERY MIGRATION HERE ★
--
-- prisma migrate dev proposes dropping the pgvector HNSW index, the cube GiST index and the
-- tsvector indexes every single time. See ADR-020.

ALTER TABLE "discord_guild_members"
  ADD COLUMN IF NOT EXISTS "joined_at" TIMESTAMPTZ(6);

-- No backfill, and no default.
--
-- The value can only come from Discord, and the bot writes it on its next name sweep — within
-- seconds of the deploy. A default of now() would stamp every member as having joined on the day
-- this migration ran, which is a wrong answer that looks exactly like a right one and would never
-- be questioned afterwards. Null renders as "unknown" until the sweep fills it in.
