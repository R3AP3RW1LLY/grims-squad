-- A project remembers which build type it is.
--
-- ★ HAND-WRITTEN (ADR-020) ★
--
-- Nullable and ON DELETE SET NULL, both deliberately. Nullable because a project posted before
-- anybody has docked has no requirement to fingerprint yet, and a site whose requirement matches
-- nothing in the catalogue is a build type we have not recorded — which is information, not an
-- error, and must not block the project from existing.
--
-- SET NULL rather than CASCADE because a catalogue row is a description of a KIND of build. If one
-- is ever removed, the squadron's actual construction site does not stop existing with it; it just
-- goes back to being an unidentified site.
ALTER TABLE colony_projects
    ADD COLUMN build_type_id TEXT
        REFERENCES colony_build_types (id) ON DELETE SET NULL;

-- "Which of our builds are Coriolis starports" — the reverse lookup a planner does, and cheap
-- because almost every row is NULL until a site has been docked at.
CREATE INDEX colony_projects_build_type_idx
    ON colony_projects (build_type_id)
    WHERE build_type_id IS NOT NULL;
