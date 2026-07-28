-- Two telemetry categories for journal data (P1.11).
--
-- The existing categories were designed for a different model and none of them
-- describes "did this commander play" or "what rank are they". Reusing a
-- near-miss like `location` would make per-category consent meaningless —
-- INV-013 only works if a category means what a member thinks it means.
--
--   session  the LoadGame event, and nothing more. The one input the promotion
--            engine needs, kept separable so a member can confirm they play
--            WITHOUT sharing what they did.
--   profile  ranks, progress and squadron standing. What a commander IS.
--
-- Ships and loadouts use the existing `fleet`, which already fits.

ALTER TYPE "TelemetryCategory" ADD VALUE IF NOT EXISTS 'session';
ALTER TYPE "TelemetryCategory" ADD VALUE IF NOT EXISTS 'profile';
