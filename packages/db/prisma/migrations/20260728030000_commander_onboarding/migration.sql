-- When the member finished the commander onboarding step.
--
-- A separate column rather than inferring from `timezone`: the column defaults
-- to 'UTC', so a member who genuinely lives in UTC is indistinguishable from
-- one who has never been asked — and would be sent back through onboarding
-- every time they signed in.
--
-- NULL means never asked.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "commander_onboarded_at" TIMESTAMPTZ(6);
