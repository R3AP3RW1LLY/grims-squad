-- Discord's own role metadata: name, colour, position.
--
-- Distinct from `roles`, which is OUR permission bundle. Most Discord roles are
-- not mapped to one and never will be — colour roles, ping roles, joke roles —
-- and a member wearing them is still wearing them.
--
-- The roster shows what somebody actually has in Discord, so it needs names and
-- colours for roles the permission system has no opinion about.
--
-- A CACHE. Nothing here is authoritative; Discord is. `synced_at` records when
-- it was last true.

CREATE TABLE IF NOT EXISTS "discord_roles" (
  "discord_role_id" TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "colour"          TEXT,
  "position"        INTEGER NOT NULL DEFAULT 0,
  "hoist"           BOOLEAN NOT NULL DEFAULT false,
  "synced_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "discord_roles_pkey" PRIMARY KEY ("discord_role_id")
);

CREATE INDEX IF NOT EXISTS "discord_roles_position_idx" ON "discord_roles" ("position");
