-- The changelog ledger. Hand-written (ADR-020).
--
-- One row per production deploy, inserted by the deploy script's final step
-- (infra/scripts/deploy.sh step 8, via `tools/changelog.mjs --sql`): the span
-- of commits the deploy shipped, and that span rendered as three markdown
-- documents — one per audience. Website is apps/web, Companion App is
-- apps/companion, Platform is everything else, and the prose is the commit
-- messages' own, never a summary.
--
-- Markdown as columns rather than a normalised entries table, deliberately:
-- the unit members read is "what did this deploy change for me", the row is
-- written once and never edited, and the page renders each column whole.
--
-- Additive only, as the deploy contract requires: the old containers keep
-- serving while this applies, and a table nothing yet reads cannot break them.

CREATE TABLE "changelog_releases" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "from_sha"     TEXT NOT NULL,
  "to_sha"       TEXT NOT NULL,
  "deployed_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "website_md"   TEXT NOT NULL,
  "companion_md" TEXT NOT NULL,
  "platform_md"  TEXT NOT NULL,
  CONSTRAINT "changelog_releases_pkey" PRIMARY KEY ("id")
);

-- The page reads newest-first; this is that read.
CREATE INDEX "changelog_releases_deployed_at_idx" ON "changelog_releases" ("deployed_at");
