-- Voice minutes: how long, beside how often. Hand-written (ADR-020).
--
-- ★ SQUADRON OWNER, 2026-08-04 ★
--
-- "for voice joins can we track how long they are in voice chat per month? keep an aggregate
-- total etc and include that in YTD aswell."
--
-- The bot banks a session's minutes when the session ENDS — a leave, or a move out of the
-- channels that count — splitting at UTC month boundaries so a session crossing the 1st credits
-- each month its own minutes. The column sits BESIDE voice_join_count; nothing is replaced, and
-- the monthly promotion check does not read it.
--
-- Admin console only. The member profile once carried an invented `voiceMinutes` (joins divided
-- by sixty) and it was removed as fiction; this is the real figure, and it stays behind the
-- officer gate rather than returning to the payload that lied about it.

ALTER TABLE "member_activity_months" ADD COLUMN "voice_minutes" INTEGER NOT NULL DEFAULT 0;
