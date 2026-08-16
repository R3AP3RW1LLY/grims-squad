-- How often to ask Frontier for one member's journal, and where we got to.
--
-- ★ THE GEFORCE NOW UNLOCK NEEDS SOMEWHERE TO KEEP ITS PLACE ★
--
-- Squadron owner: "the primary feature must be so that players that are playing on Geforce Now and
-- cloud platforms can use the companion app like everyone else". They cannot run anything beside
-- the game, so Frontier's copy of their journal is the only way they exist on this platform at all.
--
-- ★ WHY THE CADENCE IS MEASURED AND NOT CONFIGURED ★
--
-- Frontier rewrites the journal on their schedule, and it is documented nowhere worth trusting.
-- Guessing an interval means either spending the shared rate limit to receive bytes we already
-- hold, or missing a member's session entirely. So each poll reports whether anything was new and
-- the interval walks toward whatever that turns out to be, per member — a number nobody had to know
-- in advance, and one that stays right if Frontier changes it.
--
-- ★ WHY A SEPARATE TABLE FROM cmdr_verifications ★
--
-- Write rate. This row changes every sixty seconds for an actively flying member; the verification
-- row holds their identity and their tokens and must not be rewritten on that cadence.
CREATE TABLE "capi_poll_state" (
    "user_id"       UUID PRIMARY KEY,
    -- Starts at the 120s opening interval; floors at 60s while flying, widens to 30m when not.
    "interval_ms"   INTEGER NOT NULL DEFAULT 120000,
    -- Consecutive polls that brought nothing new. Three is a pattern; one is a commander in
    -- supercruise writing nothing for a minute, and widening on that would oscillate for ever.
    "unchanged"     INTEGER NOT NULL DEFAULT 0,
    -- Null for a member who linked and never flew. "No entries recently" and "no entries at all"
    -- are the same absence, and both must poll slowly rather than fast.
    "last_entry_at" TIMESTAMPTZ(6),
    "due_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "watermark"     TIMESTAMPTZ(6),
    "closed_day"    TEXT,
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "capi_poll_state_user_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- The poller's own query: who is due, most overdue first. With a per-run cap that ORDER is the
-- fairness — without it the same members fall off the end of every run and simply appear to have
-- stopped playing.
CREATE INDEX "capi_poll_state_due_idx" ON "capi_poll_state" ("due_at");
