-- The system planner: bodies, and plans drawn on them.
--
-- ★ HAND-WRITTEN (ADR-020) ★
--
-- `prisma migrate dev` proposes dropping the pgvector HNSW index, the cube GiST index and the
-- full-text tsvector indexes on every run. This file was written by hand for that reason.
--
-- ★ WHY WE HAD NO BODIES AT ALL ★
--
-- Not one table. The EDDN collector consumes `commodity/3` and discards the `Scan` events that
-- carry bodies — measured at 34.7% of the whole firehose — so a planner had nothing to lay out.
--
-- EDSM answers this on demand: one request per system, no paging (173 bodies in a single response),
-- and a measured 720-per-hour token bucket. A squadron plans a handful of systems rather than the
-- galaxy, so bodies are fetched when somebody first plans a system and cached, not bulk-imported.

CREATE TABLE colony_systems (
    -- Frontier's own 64-bit address: the join key EDSM, Spansh and the journal all agree on.
    id64       BIGINT      PRIMARY KEY,
    name       TEXT        NOT NULL UNIQUE,
    body_count INTEGER,
    -- Shown on the page. A body list nobody can date is one nobody can trust.
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE colony_bodies (
    system_id64    BIGINT  NOT NULL REFERENCES colony_systems (id64) ON DELETE CASCADE,
    body_id        INTEGER NOT NULL,

    name           TEXT    NOT NULL,
    kind           TEXT    NOT NULL,
    sub_type       TEXT,

    is_landable    BOOLEAN NOT NULL DEFAULT false,
    gravity        DOUBLE PRECISION,
    temperature    DOUBLE PRECISION,
    distance_ls    DOUBLE PRECISION,
    radius_km      DOUBLE PRECISION,
    has_rings      BOOLEAN NOT NULL DEFAULT false,
    terraformable  BOOLEAN NOT NULL DEFAULT false,
    has_atmosphere BOOLEAN NOT NULL DEFAULT false,
    has_volcanism  BOOLEAN NOT NULL DEFAULT false,

    -- The body this orbits, so a moon draws under its planet. Null for the primary star.
    parent_body_id INTEGER,

    -- ★ READ OFF THE IN-GAME MAP, NOT PREDICTED ★
    --
    -- A community formula exists for SURFACE slots and none exists for orbital — RavenColonial
    -- predicts the first and asks for the second. The owner chose to ask for both, which is the
    -- stricter answer: every number on the planner is then something somebody read off their own
    -- screen rather than something we inferred and dressed up as fact.
    --
    -- On the BODY rather than on a plan, because how many slots a body has is a fact about the
    -- system. One member reads it once and every plan of that system has it.
    orbital_slots  INTEGER,
    surface_slots  INTEGER,
    -- Who entered them, so a wrong number has an author rather than being anonymous.
    slots_by_id    UUID REFERENCES users (id) ON DELETE SET NULL,
    slots_at       TIMESTAMPTZ,

    PRIMARY KEY (system_id64, body_id),
    CONSTRAINT colony_bodies_orbital_ck CHECK (orbital_slots IS NULL OR orbital_slots BETWEEN 0 AND 32),
    CONSTRAINT colony_bodies_surface_ck CHECK (surface_slots IS NULL OR surface_slots BETWEEN 0 AND 32)
);

-- "Draw this system": every body, and the tree needs the parent to nest moons under planets.
CREATE INDEX colony_bodies_tree_idx ON colony_bodies (system_id64, parent_body_id);

CREATE TABLE colony_plans (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner        "ColonyOwner" NOT NULL,
    title        TEXT        NOT NULL,
    system_name  TEXT        NOT NULL,
    system_id64  BIGINT      REFERENCES colony_systems (id64) ON DELETE SET NULL,
    notes        TEXT,

    -- ★ OPTIMISTIC CONCURRENCY, AND IT IS NOT OPTIONAL HERE ★
    --
    -- The highest-value moment for this feature is two officers on Discord looking at the same
    -- plan. Last-write-wins on a drag-ordered list silently destroys work in exactly that scenario,
    -- so a save carries the version it started from and a mismatch is reported rather than applied.
    version      INTEGER     NOT NULL DEFAULT 1,

    posted_by_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX colony_plans_owner_idx  ON colony_plans (owner);
CREATE INDEX colony_plans_system_idx ON colony_plans (system_id64);

CREATE TABLE colony_plan_sites (
    id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id      UUID    NOT NULL REFERENCES colony_plans (id) ON DELETE CASCADE,

    -- Null while somebody is still deciding where to put it.
    system_id64  BIGINT,
    body_id      INTEGER,

    location     TEXT    NOT NULL,
    build_type_id TEXT   REFERENCES colony_build_types (id) ON DELETE SET NULL,

    -- Tier points are earned and spent in this sequence, so the order IS part of the plan.
    position     INTEGER NOT NULL,

    -- The system's FIRST station. The game treats it specially and charges nothing for it.
    is_primary   BOOLEAN NOT NULL DEFAULT false,

    -- Set once an intention became a real construction site, so a plan can show its own progress.
    project_id   UUID    REFERENCES colony_projects (id) ON DELETE SET NULL,

    CONSTRAINT colony_plan_sites_location_ck CHECK (location IN ('orbital', 'surface')),
    -- A body reference is both columns or neither. Half of one would point at nothing.
    CONSTRAINT colony_plan_sites_body_ck CHECK (
        (system_id64 IS NULL AND body_id IS NULL) OR (system_id64 IS NOT NULL AND body_id IS NOT NULL)
    ),
    CONSTRAINT colony_plan_sites_body_fk FOREIGN KEY (system_id64, body_id)
        REFERENCES colony_bodies (system_id64, body_id) ON DELETE SET NULL
);

CREATE INDEX colony_plan_sites_order_idx ON colony_plan_sites (plan_id, position);
CREATE INDEX colony_plan_sites_type_idx  ON colony_plan_sites (build_type_id);
