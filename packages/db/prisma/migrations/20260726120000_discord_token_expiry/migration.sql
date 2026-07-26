-- P1.1: the refresh worker needs to know which access tokens lapse soon.
-- Nullable with no backfill: existing rows genuinely have an unknown expiry,
-- and inventing one would make the worker refresh at the wrong time.
ALTER TABLE "discord_identities" ADD COLUMN "token_expires_at" TIMESTAMPTZ(6);
CREATE INDEX "discord_identities_token_expires_at_idx" ON "discord_identities"("token_expires_at");
