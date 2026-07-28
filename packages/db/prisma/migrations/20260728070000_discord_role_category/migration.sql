-- What a Discord role MEANS to us.
--
-- Discord roles serve several unrelated purposes in one flat list: rank,
-- membership, awards, and channel access. A roster card wants three of those
-- and emphatically not the fourth — a member's card should not be eight lines
-- of "has access to the mining channel".
--
-- Stored rather than derived from names in application code, so renaming a role
-- in Discord is a data fix rather than a deploy.

DO $$ BEGIN
  CREATE TYPE "DiscordRoleCategory" AS ENUM ('rank', 'membership', 'award', 'hidden', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "discord_roles"
  ADD COLUMN IF NOT EXISTS "category" "DiscordRoleCategory" NOT NULL DEFAULT 'other';
