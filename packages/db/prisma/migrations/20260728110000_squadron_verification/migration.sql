-- Squadron membership as a SECOND, separate check.
--
-- Proving you control a commander name proves nothing about whether you are in
-- THIS squadron. The two were one step, so anybody who verified a name was
-- treated as a member — backwards for a squadron platform.
--
-- Three states fall out of these columns:
--   no verified name                        -> unverified
--   verified name, no confirmed squadron    -> PARTIAL
--   both                                    -> verified

ALTER TABLE "cmdr_verifications"
  -- Recorded verbatim, so somebody in a DIFFERENT squadron can be told which
  -- one rather than a bare "not a member".
  ADD COLUMN IF NOT EXISTS "inara_squadron" TEXT,
  -- Set when Inara confirmed OUR squadron. Cleared if they later leave.
  ADD COLUMN IF NOT EXISTS "squadron_verified_at" TIMESTAMPTZ(6),
  -- Their CLAIM to have applied, never proof. It only decides whether it is
  -- worth spending rate budget asking, so somebody who has not applied is not
  -- polled forever.
  ADD COLUMN IF NOT EXISTS "squadron_claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "squadron_checked_at" TIMESTAMPTZ(6);

-- The 20-minute sweep asks for exactly one set: verified names that have
-- claimed a squadron and are not yet confirmed. Partial, so the index stays
-- small as the confirmed set grows.
CREATE INDEX IF NOT EXISTS "cmdr_verifications_awaiting_squadron_idx"
  ON "cmdr_verifications" ("squadron_claimed_at")
  WHERE "is_verified" = TRUE
    AND "revoked_at" IS NULL
    AND "squadron_verified_at" IS NULL;
