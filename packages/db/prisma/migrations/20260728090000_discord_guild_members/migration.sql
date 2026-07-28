-- Every member of the guild, whether or not they have ever visited the website.
--
-- `discord_identities` is keyed on user_id and only exists once somebody has
-- SIGNED IN — fifty of the squadron's fifty-one active members have no such
-- row. Anything joining through it can therefore only ever name one person,
-- which is why the admin activity table showed raw snowflakes for everyone
-- else.
--
-- This is a cache of the GUILD, keyed on the snowflake. No tokens, no secrets:
-- names, roles and a timestamp. Rows for members who leave are kept, so last
-- month's activity still has a name against it instead of becoming an
-- unattributed number.

CREATE TABLE IF NOT EXISTS "discord_guild_members" (
  "discord_id"  TEXT PRIMARY KEY,
  -- The server nickname. In this squadron's convention that is the member's
  -- in-game commander name, which is what officers recognise each other by.
  "nick"        TEXT,
  "username"    TEXT,
  "global_name" TEXT,
  "roles"       TEXT[] NOT NULL DEFAULT '{}',
  "is_bot"      BOOLEAN NOT NULL DEFAULT FALSE,
  "synced_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Deliberately NO foreign key to users. The whole point is that most of these
-- members have no account, and a constraint would make the common case
-- unstorable.
