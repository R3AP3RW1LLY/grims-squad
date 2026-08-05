-- The version a release shipped as. Hand-written (ADR-020), additive.
--
-- ★ SQUADRON OWNER, 2026-08-04: "lets keep the website and companion app versioned the same" ★
--
-- One platform version (PLATFORM_VERSION in @grims/shared) covers both surfaces; the deploy
-- pipeline stamps it onto every release row it records, so the changelog page can head each
-- entry "v0.5.0 — deployed …" automatically, for ever. Nullable because rows recorded before
-- this column existed shipped without one, and inventing versions for them would be fiction.
ALTER TABLE "changelog_releases" ADD COLUMN "version" TEXT;
