-- When an officer was shown the "choose your own nickname" step.
--
-- Squadron owner, 2026-08-02: "add a step to onboarding that allows them to overide their discord
-- server nickname."
--
-- SEEN, not acted on — the same shape as companion_prompted_at and for the same reason. The step is
-- an offer rather than an obligation, so passing through completes it. Without a column the offer
-- would either block (wrong: wanting the convention is a valid answer) or reappear on every sign-in
-- (worse: an officer being asked the same optional question forever).
--
-- Backfills to NULL, so every current officer sees it once. That is the intent: nobody has been
-- offered this yet.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nickname_prompted_at TIMESTAMPTZ(6);
