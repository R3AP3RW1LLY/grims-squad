-- Every line that has appeared on the live AI log (P2).
--
-- ★ SQUADRON OWNER, 2026-08-01 ★
--
-- "record all logs so we have a record of them."
--
-- ★ WHY A TABLE WHEN THERE IS ALREADY A STREAM ★
--
-- `AiStreamService` is a ring buffer in memory: a hundred lines, gone on restart, invisible to
-- anybody who was not watching at the time. That is exactly right for a LIVE panel and no shape at
-- all for a record. "What did the screener say at 3am on Tuesday" had no answer.
--
-- ★ WHY NOT WIDEN ai_calls ★
--
-- That table records CALLS TO THE MODEL — prompt, verdict, duration. Half of what crosses the
-- stream is not a call: heartbeats, ingest progress, embedding sweeps, the listener connecting.
-- Putting them there would make every row's meaning conditional on its kind, and every existing
-- query would need to learn about it.
--
-- Volume is small. A heartbeat every four minutes is 360 rows a day; everything else is
-- event-driven and rarer. If it ever stops being small, a retention sweep on `at` trims it without
-- touching anything else.
CREATE TABLE "ai_log_lines" (
  "id"      BIGSERIAL   PRIMARY KEY,
  "level"   TEXT        NOT NULL,
  -- Which subsystem spoke: screen, embed, ingest, health, assistant, signature.
  "kind"    TEXT        NOT NULL,
  "message" TEXT        NOT NULL,
  "took_ms" INTEGER,
  "at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "ai_log_lines_level_check" CHECK ("level" IN ('info', 'warn', 'error'))
);

-- The panel's only query: newest first.
CREATE INDEX "ai_log_lines_at_idx" ON "ai_log_lines" ("at" DESC);

-- "Show me just the screener", which is how somebody investigates one subsystem without reading
-- every heartbeat in between.
CREATE INDEX "ai_log_lines_kind_idx" ON "ai_log_lines" ("kind", "at" DESC);
