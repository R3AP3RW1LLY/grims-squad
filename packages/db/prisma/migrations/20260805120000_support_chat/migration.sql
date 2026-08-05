-- Help & Support: the live chat, durably. Hand-written (ADR-020).
--
-- ★ THE APPROVED DESIGN ★
--
-- A help chat usable by EVERYONE, signed-out guests included, answered by the officers from a
-- Support console on the site and in the companion app. A later wave puts the AI on the first
-- turn — which is why author_kind already has an 'ai' value: the first AI answer must be an enum
-- value that exists, not a migration.
--
-- ★ THE GUEST DOOR IS A TOKEN, STORED ONLY AS A HASH ★
--
-- A guest holds no account, so their conversation is addressed by a token: minted at the start,
-- shown once to that browser, stored as SHA-256 — the same discipline as device tokens and
-- recovery codes. Presenting the token names exactly one row (the hash is UNIQUE), so a wrong
-- token reads as "no such conversation" and confirms nothing about which tokens exist.

CREATE TYPE "SupportConversationStatus" AS ENUM ('open', 'closed');
CREATE TYPE "SupportAuthorKind" AS ENUM ('member', 'officer', 'guest', 'ai', 'system');

CREATE TABLE "support_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'open',
    -- What it is about, if the opener said. Null renders as the opening message's first words.
    "subject" TEXT,
    -- The signed-in member who opened it. Null means a guest conversation.
    "user_id" UUID,
    "guest_token_hash" TEXT,
    -- Display only; it authenticates nothing.
    "guest_name" TEXT,
    -- Denormalised from messages so the console can order by activity without a join per row.
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    -- Read high-water marks, one per side. A single officer mark, deliberately: the console is a
    -- shared queue, and "somebody has seen this" is what its unread indicator means.
    "officer_seen_at" TIMESTAMPTZ(6),
    "requester_seen_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "closed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- The guest lookup: one row per token, or none. UNIQUE is what makes the door safe to answer.
CREATE UNIQUE INDEX "support_conversations_guest_token_hash_key"
  ON "support_conversations"("guest_token_hash");

-- The console's queue: conversations by state, newest activity first.
CREATE INDEX "support_conversations_status_last_message_at_idx"
  ON "support_conversations"("status", "last_message_at");

-- "My conversations", for the member widget.
CREATE INDEX "support_conversations_user_id_last_message_at_idx"
  ON "support_conversations"("user_id", "last_message_at");

-- CASCADE: a deleted account takes its help conversations with it — they were that member's
-- private questions, and an unowned transcript serves nobody.
ALTER TABLE "support_conversations"
  ADD CONSTRAINT "support_conversations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL: the closure outlives the closing officer's account.
ALTER TABLE "support_conversations"
  ADD CONSTRAINT "support_conversations_closed_by_id_fkey"
  FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "author_kind" "SupportAuthorKind" NOT NULL,
    -- The member or officer who wrote it. Null for guest, system and (later) ai turns.
    "author_id" UUID,
    -- Plain text, capped at 4000 characters in the service.
    "body" TEXT NOT NULL,
    -- One image, through the hardened media path. There is deliberately no second upload route.
    "attachment_media_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- The transcript read, oldest first.
CREATE INDEX "support_messages_conversation_id_created_at_idx"
  ON "support_messages"("conversation_id", "created_at");

ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL on both: the transcript keeps its words when an author's account goes, and keeps its
-- message when an attached image is deleted — merely picture-less, like the signature images.
ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_attachment_media_id_fkey"
  FOREIGN KEY ("attachment_media_id") REFERENCES "media_uploads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── SUPPORT_AGENT (bit 80): work the console ────────────────────────────────
--
-- Granted to the roles that already carry MEMBER_MANAGE (bit 60) — the bit whose own comment
-- defines the officer tier, and which the webmaster's mask also holds. NOT `perm_mask > 0` like
-- the member-tier shipyard bits: this one opens other people's private conversations, and the
-- rank ladder rows deliberately left at member strength must not receive it by accident.
--
-- Addition, not bitwise OR: perm_mask is NUMERIC(40,0) and Postgres has no bitwise operator for
-- numeric. Addition equals OR for a bit that is not already set, and the mod(div(...)) guard
-- proves it is not — without it a re-run would carry into bit 81 and grant something nobody
-- intended.
UPDATE roles
SET perm_mask = perm_mask + 1208925819614629174706176
WHERE mod(div(perm_mask, 1152921504606846976), 2) = 1
  AND mod(div(perm_mask, 1208925819614629174706176), 2) = 0;
