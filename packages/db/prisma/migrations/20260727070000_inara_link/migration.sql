-- A member's own Inara API key (P1.8b — verification without Frontier).
--
-- Calling Inara with the MEMBER'S key returns the commander bound to that
-- account, so the name arrives from Inara rather than from a text box. That is
-- the entire difference between verification and self-declaration, and it is
-- why the key is stored at all rather than just the name.
--
-- Optional. A member who adds no key is verified by an officer (trust tier 1);
-- adding one upgrades them to tier 2 with nobody else involved.

CREATE TABLE "inara_links" (
  "user_id"         UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  -- AES-256-GCM ciphertext, AAD-bound to (purpose, subject) so a row lifted
  -- from this table cannot be decrypted as another member's (INV-012).
  -- NEVER returned by any endpoint, in any shape.
  "api_key_enc"     BYTEA NOT NULL,
  -- What INARA reported. Citext because Elite treats commander names
  -- case-insensitively and so does cmdr_verifications.
  "cmdr_name"       CITEXT,
  "verified_at"     TIMESTAMPTZ(6),
  "last_checked_at" TIMESTAMPTZ(6),
  -- Shown to the member so a bad key is self-diagnosable. Must never contain
  -- the key itself; the adapter deliberately discards Inara's echoed request.
  "last_error"      TEXT,
  -- 'web' or 'app'. Recorded because a key added in the desktop app appears on
  -- the website with no action from the member, and that should be explicable
  -- six months later.
  "source"          TEXT NOT NULL DEFAULT 'web',
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "inara_links_cmdr_name_idx" ON "inara_links" ("cmdr_name");
