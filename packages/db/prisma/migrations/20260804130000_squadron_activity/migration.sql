-- Squadron activity: the shared feed. Hand-written (ADR-020).
--
-- ★ SQUADRON OWNER, 2026-08-04 ★
--
-- "we need to add the Personal and Squadron Activity notifications and the notifications system
-- that notifies users of various activities" — approved design: personal rows in the existing
-- `notifications` table (which finally gains readers), squadron-wide events HERE, once each. A
-- project starting is one fact, not a hundred and seven copies of it; each member's unread badge
-- counts rows newer than their own seen-marker.

CREATE TABLE "squadron_activity" (
  "id"            BIGSERIAL NOT NULL,
  "kind"          TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "body"          TEXT,
  "link"          TEXT,
  "actor_user_id" UUID,
  "meta"          JSONB,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "squadron_activity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "squadron_activity_actor_user_id_fkey" FOREIGN KEY ("actor_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "squadron_activity_created_at_idx" ON "squadron_activity" ("created_at");
CREATE INDEX "squadron_activity_kind_created_at_idx" ON "squadron_activity" ("kind", "created_at");

-- Where each member's squadron-feed badge counts from. Null = everything is new, which is true.
ALTER TABLE "users" ADD COLUMN "squadron_seen_at" TIMESTAMPTZ(6);

-- The personal bell needs "how many unread" answered by index alone. The existing
-- (user_id, read_at, created_at) index serves the list; this partial serves the count.
CREATE INDEX "notifications_unread_idx" ON "notifications" ("user_id")
  WHERE "read_at" IS NULL AND "channel" = 'in_app';
