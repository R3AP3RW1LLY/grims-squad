-- Frontier's own id alongside EDSY's, so ships join without a hand-written alias table.
--
-- ★ WHY THE SYMBOL WAS NOT ENOUGH ★
--
-- EDSY names the Alliance Challenger `TypeX_3` and the Type-6 `Type6`; Coriolis keys them
-- `alliance_challenger` and `type_6_transporter`. Neither is wrong and no amount of string
-- normalisation joins them — the journal importer hit the same wall and needed a two-entry alias
-- map for `lakonminer` and `mediumtransport01`.
--
-- But BOTH sides already carry Frontier's own id: EDSY as `fdid`, Coriolis as `edID`. Checked
-- against the live data, they are identical — Sidewinder 128049249, Type-6 128049285, Alliance
-- Challenger 128816588. So the join is a number both files already agree on, and a hull Frontier
-- ships next month matches with nothing to maintain.
--
-- Hand-written, like every migration here (ADR-020).

ALTER TABLE "edsy_ids"
  ADD COLUMN IF NOT EXISTS "fdid" BIGINT;

CREATE INDEX IF NOT EXISTS "edsy_ids_fdid_idx" ON "edsy_ids" ("fdid") WHERE "fdid" IS NOT NULL;
