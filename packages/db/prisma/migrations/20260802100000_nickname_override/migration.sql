-- A nickname a member wears instead of their humanized Inara name.
--
-- Squadron owner, 2026-08-02: "if an officer overrides their name, then this is the name that stays
-- as their discord nickname it should not change from that unless they change it. if they update it
-- in discord, it should also update here and not change back!"
--
-- ★ NULLABLE, NOT DEFAULTED TO THE COMPUTED NAME ★
--
-- Storing the computed name for everybody would look tidier and would freeze the convention in
-- place: a member who later corrects their Inara profile would never pick the correction up,
-- because there would be a stored name to prefer. Null means "follow the rule", which is what
-- almost everybody does.
--
-- Every existing row therefore backfills to NULL and keeps being renamed nightly, which is the
-- behaviour that was already in place.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nickname_override TEXT,
  ADD COLUMN IF NOT EXISTS nickname_override_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS nickname_override_source TEXT,
  ADD COLUMN IF NOT EXISTS nickname_override_allowed BOOLEAN NOT NULL DEFAULT false;

-- ★ THE SOURCE IS CONSTRAINED, BECAUSE IT DECIDES HOW AN AUDIT READS ★
--
-- `web` is somebody who deliberately opted out on the settings page. `discord` is somebody who
-- renamed themselves in the guild and may not realise they have opted out at all. A third value
-- arriving by typo would make that distinction meaningless without anything failing.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_nickname_override_source_check;
ALTER TABLE users
  ADD CONSTRAINT users_nickname_override_source_check
  CHECK (nickname_override_source IS NULL OR nickname_override_source IN ('web', 'discord'));

-- ★ AND THE THREE COLUMNS MOVE TOGETHER ★
--
-- An override with no timestamp, or a timestamp with no name, is a half-written record that every
-- reader afterwards has to guess about. Enforced here rather than trusted to the one service that
-- writes it today, because the second writer is the one that gets it wrong.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_nickname_override_complete_check;
ALTER TABLE users
  ADD CONSTRAINT users_nickname_override_complete_check
  CHECK (
    (nickname_override IS NULL AND nickname_override_at IS NULL AND nickname_override_source IS NULL)
    OR
    (nickname_override IS NOT NULL AND nickname_override_at IS NOT NULL AND nickname_override_source IS NOT NULL)
  );

-- The nightly sweep reads "everyone without an override". Partial, because the overridden set is
-- meant to stay small.
CREATE INDEX IF NOT EXISTS users_nickname_override_idx
  ON users (id) WHERE nickname_override IS NOT NULL;
