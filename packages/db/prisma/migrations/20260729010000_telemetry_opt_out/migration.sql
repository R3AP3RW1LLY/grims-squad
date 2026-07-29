-- Telemetry becomes OPT-OUT (INV-013, amended 2026-07-29).
--
-- The companion app no longer filters: it sends what it reads, and the website
-- is where a member decides what is kept. Empty columns mean everything is
-- kept, which is the new default.
--
-- `session` may never appear in the category list. Promotion eligibility is
-- computed from it, so a member who switched it off would silently stop
-- qualifying for promotions they had earned. Enforced in the service rather
-- than by a CHECK constraint, because the refusal has to reach the member as an
-- explanation and a constraint violation is not one.

ALTER TABLE "privacy_settings"
  ADD COLUMN IF NOT EXISTS "telemetry_opt_out_categories" "TelemetryCategory"[] NOT NULL DEFAULT '{}',
  -- Names, not an enum. The journal's event set is Frontier's and grows with
  -- every game update; a new event must not need a migration before a member
  -- can decline it.
  ADD COLUMN IF NOT EXISTS "telemetry_opt_out_events" TEXT[] NOT NULL DEFAULT '{}';

-- ★ THIS IS NOT A NO-OP FOR EXISTING MEMBERS ★
--
-- Under the old model `telemetry_consent` listed what somebody had opted IN to,
-- and an empty list meant "every optional category is off". Reading those rows
-- as the new default — everything on — would silently switch on collection that
-- people had specifically not agreed to.
--
-- So anybody who had recorded a decision keeps it: every optional category they
-- did NOT name becomes an opt-out. Members who never touched it get the new
-- default, which is what a fresh install would give them anyway.
--
-- `session`, `profile` and `fleet` are absent from the list below on purpose.
-- They were the old BASELINE — always collected, never opt-in — so there is no
-- prior refusal to preserve.
UPDATE "privacy_settings"
SET "telemetry_opt_out_categories" = ARRAY(
      SELECT c
      FROM unnest(
        ARRAY['location', 'combat', 'trade', 'exploration', 'bgs', 'carrier']::"TelemetryCategory"[]
      ) AS c
      WHERE NOT (c = ANY ("telemetry_consent"))
    )
WHERE array_length("telemetry_consent", 1) IS NOT NULL;
