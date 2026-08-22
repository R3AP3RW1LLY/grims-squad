-- A named group of systems the squadron treats as one economy.
--
-- ★ SQUADRON OWNER, 2026-08-18 ★
--
-- "the new systems must compliment these current systems so they all build one cohesive market
-- economy and all work well together + trade routes etc."
--
-- ★ WHY A GROUP AND NOT A DISTANCE ★
--
-- The most useful thing found while planning the Col 285 systems by hand was invisible from any one
-- of them: c2-12 refines ore and c2-16 builds high tech, and NOTHING between them turned refined
-- metal into components -- so both ends were trading outside the squadron for the middle step.
--
-- That is a property of the SET. Inferring the set from distance was considered and dropped: the
-- squadron's own idea of which systems belong together is not a radius, and a boundary drawn by
-- arithmetic would confidently include a system nobody thinks of as ours.
CREATE TABLE IF NOT EXISTS "colony_blocs" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the squadron calls it. "Col 285 Core", not a generated label.
  "name"          TEXT NOT NULL,
  -- Why this grouping exists, in an officer's words.
  "note"          TEXT,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "colony_blocs_name_key" ON "colony_blocs"("name");

-- One system's membership, and the role the squadron DECIDED it will take.
--
-- ★ THE DECISION IS STORED, NOT ONLY THE POTENTIAL ★
--
-- `scoreRoles` says what a system COULD be from its bodies. This is what officers chose, which is a
-- different fact and the one the gap analysis needs: a system with perfect extraction bodies that
-- the squadron has chosen to make military IS military, and a bloc that counted potential rather
-- than decisions would report a supply chain it does not have.
--
-- `role` is nullable and is not an enum. Nobody has to decide immediately, and an unrecognised value
-- must degrade to "no role decided" rather than break the gap analysis for the whole bloc.
CREATE TABLE IF NOT EXISTS "colony_bloc_systems" (
  "bloc_id"     UUID NOT NULL REFERENCES "colony_blocs"("id") ON DELETE CASCADE,
  "system_name" TEXT NOT NULL,
  "role"        TEXT,
  "added_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "added_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("bloc_id", "system_name")
);

-- A system may be looked up without knowing its bloc: the planning page starts from the system.
CREATE INDEX IF NOT EXISTS "colony_bloc_systems_system_name_idx"
  ON "colony_bloc_systems"("system_name");
