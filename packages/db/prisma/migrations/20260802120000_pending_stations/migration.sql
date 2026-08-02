-- Stations EDDN reported that we do not hold.
--
-- Squadron owner, 2026-08-02: "add the stations we do not hold" — and, when asked what one should
-- become given EDDN carries only a name, a system and a market id: "Look each one up before creating
-- it", so it lands complete with pad size and type rather than as a stub.
--
-- ★ A QUEUE, BECAUSE THE COLLECTOR CANNOT WAIT ★
--
-- The collector keeps up with roughly one message a second off the live relay. An HTTP lookup per
-- unknown station inside that loop would stall the feed behind a rate-limited third party, and they
-- arrive in bursts — about 111 in a fifteen-minute window.
--
-- So the sighting is one cheap upsert here, and a worker job resolves them at a pace the upstream
-- tolerates. Nothing reaches `knowledge_items` until it is complete.
CREATE TABLE IF NOT EXISTS pending_stations (
  market_id     BIGINT PRIMARY KEY,
  station_name  TEXT NOT NULL,
  system_name   TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_tried_at TIMESTAMPTZ(6),
  last_error    TEXT,
  resolved_at   TIMESTAMPTZ(6)
);

-- The queue the resolver reads: unresolved, least recently tried first. Partial, because the
-- resolved rows are kept for ever and are never queried this way.
CREATE INDEX IF NOT EXISTS pending_stations_queue_idx
  ON pending_stations (last_tried_at NULLS FIRST)
  WHERE resolved_at IS NULL;
