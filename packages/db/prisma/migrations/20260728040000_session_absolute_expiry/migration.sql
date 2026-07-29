-- An ABSOLUTE end for every sign-in, fixed when it begins.
--
-- Rotation mints a fresh refresh token roughly every fifteen minutes, each with
-- its own expiry. Without a cap on the FAMILY, an active member's session slides
-- forward forever — "signed in for 14 days" would really mean "signed in until
-- you stop using it", and the dashboard countdown would reset on every rotation
-- rather than counting down to anything.
--
-- Existing families are given 14 days from when they were created, which is the
-- rule they would have had. Some may already be past it; those simply require a
-- fresh sign-in, which is the correct outcome for a session older than the new
-- policy allows.

ALTER TABLE "refresh_token_families"
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6);

UPDATE "refresh_token_families"
   SET "expires_at" = "created_at" + INTERVAL '14 days'
 WHERE "expires_at" IS NULL;

ALTER TABLE "refresh_token_families"
  ALTER COLUMN "expires_at" SET NOT NULL;

-- Expired families are swept by the same job that clears expired tokens.
CREATE INDEX IF NOT EXISTS "refresh_token_families_expires_at_idx"
  ON "refresh_token_families" ("expires_at");
