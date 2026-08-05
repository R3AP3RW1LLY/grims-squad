-- Operational alerts on their way to a human. Hand-written (ADR-020).
--
-- The collector stopped for two days and the galaxy ingest could never finish, and nothing said a
-- word either time. An alert row persists until the bot has actually delivered the DM — which is
-- what makes it an announcement rather than a log line, and what a pg_notify could not survive.

CREATE TABLE "ops_alerts" (
  "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
  "kind"         TEXT        NOT NULL,
  "message"      TEXT        NOT NULL,
  "audience"     TEXT        NOT NULL DEFAULT 'webmaster',
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "delivered_at" TIMESTAMPTZ(6),

  CONSTRAINT "ops_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ops_alerts_kind_created_at_idx" ON "ops_alerts" ("kind", "created_at");

-- The bot polls for undelivered rows once a minute; partial, because delivered history dominates.
CREATE INDEX "ops_alerts_undelivered_idx" ON "ops_alerts" ("created_at")
  WHERE "delivered_at" IS NULL;
