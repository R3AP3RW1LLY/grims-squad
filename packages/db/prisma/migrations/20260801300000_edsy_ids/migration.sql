-- EDSY's own module and ship numbering, mapped to the game's symbols.
--
-- ★ WHY THIS TABLE EXISTS ★
--
-- An EDSY build link encodes each module as a three-character base-64 id in EDSY's own numbering —
-- `FBG` is 62160 is `Hpt_PulseLaser_Fixed_Small`. Nothing in Frontier's data or Coriolis's carries
-- that numbering, so without this table an EDSY link cannot be read at all.
--
-- `fdname` is the game's own symbol, which is exactly the key the journal importer already joins on
-- against coriolis-data. So this is the one hop EDSY needs and nothing else changes.
--
-- ★ WHERE IT COMES FROM ★
--
-- Extracted from `eddb.js` in taleden/EDSY, refreshed on a schedule the same way coriolis-data is.
-- Only the id-to-symbol mapping is taken — none of EDSY's code, and none of its derived statistics,
-- which we already have from Coriolis.
--
-- Licensing, since it is not ours: taleden's work is CC BY-NC 4.0, and this squadron hub is
-- non-commercial and attributes it on the import page. The Elite Dangerous data inside it remains
-- Frontier's, used under the same media rules coriolis-data already relies on.
--
-- Hand-written, like every migration here (ADR-020).

CREATE TABLE IF NOT EXISTS "edsy_ids" (
  -- `ship` or `module`. EDSY numbers them in separate spaces and a link uses both.
  "kind"       TEXT NOT NULL,
  "edsy_id"    INTEGER NOT NULL,
  -- The game's symbol, e.g. `Int_Hyperdrive_Size5_Class1`. Lower-cased on read, never here.
  "fdname"     TEXT NOT NULL,
  "synced_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("kind", "edsy_id")
);

-- The reverse direction, for checking coverage against what we hold from Coriolis.
CREATE INDEX IF NOT EXISTS "edsy_ids_fdname_idx" ON "edsy_ids" (lower("fdname"));
