-- Telemetry month stats: a month's telemetry, banked before the purge. Hand-written (ADR-020).
--
-- ★ SQUADRON OWNER, 2026-08-01 ★
--
-- "the Journal Telemetry needs to be split into the YTD and per month so we can see it per month
-- how much telemetry were getting etc."
--
-- Raw `telemetry_events` are purged at THIRTY DAYS, so a per-month view read from them would show
-- honest data for one month and fake zeros for every month before it — and once a month has been
-- purged nothing can ever recompute it. So the worker's telemetry rollup banks each month's
-- counts here while the raw rows still exist: the current and previous month are swept on the
-- daemon cadence, and anything older is left exactly as banked.
--
-- Aggregates only. A count per event type and a distinct-reporter count — never a payload — so
-- keeping these rows for ever does not stretch the raw events' 30-day promise.

CREATE TABLE "telemetry_month_stats" (
  -- First day of the month, UTC. Same month-key convention as member_activity_months.
  "month"             DATE NOT NULL,
  -- Journal event name, matching telemetry_events.event_type.
  "event_type"        TEXT NOT NULL,
  "event_count"       INTEGER NOT NULL DEFAULT 0,
  -- Distinct commanders who sent ANY telemetry this month. Repeated on every row of the month —
  -- the commodity_snapshots idiom — because distinct reporters cannot be summed from per-type
  -- counts, and a second table to hold one number would put a join on every dashboard read.
  "reporting_members" INTEGER NOT NULL DEFAULT 0,
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "telemetry_month_stats_pkey" PRIMARY KEY ("month", "event_type")
);
