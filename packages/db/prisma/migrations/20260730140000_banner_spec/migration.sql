-- The banner a member BUILT, as a layer spec rather than a rendered image.
--
-- Storing the output would freeze it. Text layers name a SOURCE (commander, rank, squadron)
-- resolved when the banner is drawn, so a promotion or rename updates every banner automatically.
-- A stored PNG would leave somebody advertising a rank they no longer hold until they remembered
-- to rebuild it.
ALTER TABLE "forum_signatures" ADD COLUMN "banner_spec" JSONB;
