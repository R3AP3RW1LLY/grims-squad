-- TOTP second factor (P1.10).
--
-- Mandatory to enter the admin console. Enrolment is FORCED rather than
-- suggested: the accounts worth attacking are exactly the ones that can grant
-- roles and change site config, and a recommendation is not a control.

CREATE TABLE "two_factor_credentials" (
  "user_id"        UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  -- AES-256-GCM ciphertext of the base32 secret, AAD-bound to (purpose, subject)
  -- so a row lifted from this table cannot be replayed elsewhere (INV-012).
  "secret_enc"     BYTEA NOT NULL,
  -- NULL until possession is proven. An unconfirmed credential grants nothing,
  -- otherwise merely STARTING enrolment would satisfy the requirement.
  "confirmed_at"   TIMESTAMPTZ(6),
  -- Replay defence: a code is single-use within its own 30-second window.
  "last_used_step" BIGINT,
  "failed_count"   INTEGER NOT NULL DEFAULT 0,
  "locked_until"   TIMESTAMPTZ(6),
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE TABLE "two_factor_recovery_codes" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"   UUID NOT NULL REFERENCES "two_factor_credentials"("user_id") ON DELETE CASCADE,
  -- SHA-256 only. A recovery code is a password equivalent, so storing it
  -- recoverably would make this table a bypass of the control it backs up.
  "code_hash" TEXT NOT NULL UNIQUE,
  "used_at"   TIMESTAMPTZ(6)
);

CREATE INDEX "two_factor_recovery_codes_user_id_used_at_idx"
  ON "two_factor_recovery_codes" ("user_id", "used_at");
