-- Privacy visibility defaults to ON, except the credit balance.
--
-- Squadron owner, 2026-07-31: "default all privacy options to on except balance, they can opt into
-- that! this is non-negotiable!"
--
-- ★ VISIBILITY, NOT COLLECTION ★
--
-- Telemetry consent is already opt-OUT (telemetry_opt_out_categories defaults to empty, meaning
-- everything is kept). These columns decide what other members SEE, and every one of them was off
-- until a member found a settings page. A roster where everybody is hidden is a roster nobody uses.
ALTER TABLE "privacy_settings" ALTER COLUMN "show_location"          SET DEFAULT true;
ALTER TABLE "privacy_settings" ALTER COLUMN "show_fleet"             SET DEFAULT true;
ALTER TABLE "privacy_settings" ALTER COLUMN "show_activity"          SET DEFAULT true;
ALTER TABLE "privacy_settings" ALTER COLUMN "show_on_public_roster"  SET DEFAULT true;
ALTER TABLE "privacy_settings" ALTER COLUMN "show_on_leaderboard"    SET DEFAULT true;

-- show_credits is deliberately NOT changed. It stays false: wealth invites comparison, and in a
-- squadron that includes minors it invites attention nobody asked for. Opt IN, on purpose.

-- ★ EXISTING ROWS ARE MOVED TOO, AND THAT IS THE POINT ★
--
-- A default only affects rows created afterwards. Every member who signed up before today has these
-- explicitly false, so leaving them would mean the change applied to nobody who is already here —
-- which is everybody.
--
-- Anyone who deliberately turned something off is indistinguishable from someone who never touched
-- it, because the old default WAS off. That is a real cost and it is the owner's call; the switches
-- remain, and a member who wants a field hidden can hide it again.
UPDATE "privacy_settings"
   SET "show_location"         = true,
       "show_fleet"            = true,
       "show_activity"         = true,
       "show_on_public_roster" = true,
       "show_on_leaderboard"   = true;
