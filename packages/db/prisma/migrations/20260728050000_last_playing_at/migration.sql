-- When the companion app last saw the journal still being written.
--
-- Deliberately NOT "last event received". Elite's journal clusters at session
-- start — LoadGame, Rank, Progress and Loadout all land within seconds — and
-- then goes quiet for hours. A member three hours into a flight has sent
-- nothing recently and is very much playing, so inferring presence from event
-- recency would report them offline for most of every session.
--
-- The app reports that the file is still GROWING, which it can see without
-- reading or transmitting a single additional journal line.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_playing_at" TIMESTAMPTZ(6);
