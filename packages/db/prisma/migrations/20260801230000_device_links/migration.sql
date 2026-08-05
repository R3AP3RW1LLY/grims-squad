-- Linking the companion app to an account without anybody copying a credential.
--
-- ★ SQUADRON OWNER, 2026-08-01 ★
--
-- "COMPANION Discord login; remove key generator"
--
-- The old flow: sign in on the website, press a button, get a `gsq_…` token shown once, select it,
-- copy it, alt-tab to the app, paste it into a password field. Six steps, one of which is handling
-- a live credential by hand, and the most likely place for it to end up is a chat message.
--
-- ★ THE DEVICE AUTHORISATION FLOW, AND WHY NOT PLAIN OAUTH ★
--
-- A desktop app cannot keep a client secret and has no trustworthy redirect target — a loopback
-- listener can be raced by anything else running on the machine. So the app never handles the OAuth
-- exchange at all. It shows a code; the member approves that code in their own browser, in the
-- session they already have; the app collects the result.
--
-- The code is safe to display because holding it does nothing without a signed-in browser to
-- approve it. The polling secret never leaves the app.
CREATE TABLE "device_links" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Shown by the app, approved in the browser. Single use.
  "code"             TEXT NOT NULL UNIQUE,
  -- SHA-256, like the device token itself. The secret is returned once and never stored.
  "poll_secret_hash" TEXT NOT NULL,
  -- So the approval screen can say WHICH machine is asking. A member with a desktop and a laptop
  -- approving a link they did not start should be able to see that immediately.
  "label"            TEXT NOT NULL,
  "user_id"          UUID REFERENCES "users"("id") ON DELETE CASCADE,
  "approved_at"      TIMESTAMPTZ(6),
  "device_token_id"  UUID,
  -- Held only between approval and collection, then cleared. See the model comment for why it
  -- cannot simply be minted at poll time.
  "token_once"       TEXT,
  "collected_at"     TIMESTAMPTZ(6),
  "expires_at"       TIMESTAMPTZ(6) NOT NULL,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- The poll is the hottest read here: a waiting app asks every few seconds.
CREATE INDEX "device_links_code_idx" ON "device_links" ("code");

-- Sweeping expired rows. Links are short-lived and an abandoned one must not stay approvable.
CREATE INDEX "device_links_expires_idx" ON "device_links" ("expires_at");
