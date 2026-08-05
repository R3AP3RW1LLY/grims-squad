-- A member's own default font, and the reader's right to ignore everybody's.
--
-- ★ TWO DIFFERENT QUESTIONS ★
--
-- `default_font_id` is what a member WRITES in — their new posts start in it.
--
-- `plain_fonts` is what they READ in. Members can pick from thirty display faces, and a forum where
-- every post is a different one is genuinely hard to read; for anybody with dyslexia or low vision
-- the only current way out is to stop reading. An author choosing a font is expression, a reader
-- switching them off is accessibility, and neither should overrule the other — so they are separate
-- columns rather than one setting pretending to answer both.
--
-- Honouring the reader costs nothing: fonts render as `doc-font-<id>` CLASSES, so this is a single
-- stylesheet rule rather than a second render path.
ALTER TABLE "privacy_settings" ADD COLUMN "default_font_id" TEXT;
ALTER TABLE "privacy_settings" ADD COLUMN "plain_fonts" BOOLEAN NOT NULL DEFAULT false;
