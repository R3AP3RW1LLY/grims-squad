-- The build catalogue: what a construction site of a given kind costs.
--
-- ★ HAND-WRITTEN, LIKE EVERY MIGRATION HERE (ADR-020) ★
--
-- `prisma migrate dev` proposes dropping the pgvector HNSW index, the cube GiST index and the
-- full-text tsvector indexes on every run, because it cannot see DDL it did not write. This file
-- was written by hand for that reason and contains only what it says it contains.
--
-- ★ WHY THIS TABLE EXISTS ★
--
-- A colonisation project had no needs at all until somebody physically flew to the site and docked.
-- So "what will this build cost me" — the question worth asking BEFORE committing to a system —
-- could not be answered, and nothing could be planned ahead.
--
-- ★ WHY EVERY ROW CARRIES ITS SOURCE ★
--
-- Frontier publishes none of this. Every figure in circulation is community-gathered, out of their
-- own forum threads, and the lists disagree at the edges. Recording `source` per row means the
-- table can hold a community figure and our own confirmed measurement side by side and say which is
-- which — and `confirmations` means a row that six of our own builds have agreed with is visibly
-- not the same kind of claim as one nobody has checked.

CREATE TABLE colony_build_types (
    id              TEXT PRIMARY KEY,
    display_name    TEXT        NOT NULL,
    category        TEXT        NOT NULL,
    tier            INTEGER     NOT NULL,
    location        TEXT        NOT NULL,
    pad_size        TEXT        NOT NULL,
    -- Every name this has been seen under, so a station name can be matched back to a type.
    layouts         TEXT[]      NOT NULL DEFAULT '{}',
    -- Denormalised: every list and every sort wants it, and it never changes without the costs.
    total_tonnes    INTEGER     NOT NULL,
    source          TEXT        NOT NULL,
    confirmed_at    TIMESTAMPTZ,
    confirmations   INTEGER     NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Guarded rather than trusted to the application. These four are read by a planner that does
    -- arithmetic on them, and a stray value would produce a wrong answer rather than an error.
    CONSTRAINT colony_build_types_tier_ck     CHECK (tier BETWEEN 1 AND 3),
    CONSTRAINT colony_build_types_location_ck CHECK (location IN ('orbital', 'surface')),
    CONSTRAINT colony_build_types_pad_ck      CHECK (pad_size IN ('none', 'small', 'medium', 'large')),
    CONSTRAINT colony_build_types_source_ck   CHECK (source IN ('community', 'observed'))
);

CREATE INDEX colony_build_types_category_idx ON colony_build_types (category);
CREATE INDEX colony_build_types_tier_idx     ON colony_build_types (tier);

CREATE TABLE colony_build_costs (
    build_type_id TEXT    NOT NULL REFERENCES colony_build_types (id) ON DELETE CASCADE,
    -- A DISPLAY name ("CMM Composite"), matching colony_needs and market_entries, so a build type
    -- joins straight against the market mirror to be priced and against a live project's needs to
    -- be recognised. A symbol here would join against nothing at all.
    commodity     TEXT    NOT NULL,
    tonnes        INTEGER NOT NULL,

    PRIMARY KEY (build_type_id, commodity),
    CONSTRAINT colony_build_costs_tonnes_ck CHECK (tonnes > 0)
);

-- "Which build types want Steel", for the reverse lookup a shopping planner does.
CREATE INDEX colony_build_costs_commodity_idx ON colony_build_costs (commodity);
