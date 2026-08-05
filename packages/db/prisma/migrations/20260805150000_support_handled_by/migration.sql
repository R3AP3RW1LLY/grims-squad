-- Help & Support, Wave 3: who is answering. Hand-written (ADR-020).
--
-- ★ THE OWNER'S RULING: AI ANSWERS FIRST, HUMAN ON DEMAND ★
--
-- Every new conversation starts with GMSD AI answering from the help corpus, and every one of
-- them has "Talk to an officer" one press away. `handled_by` is that state, and the flip to
-- 'officer' is ONE-WAY: the requester asking for a person, or an officer replying, both end the
-- AI's part in the conversation for good. A model must never talk over a human who has joined.

CREATE TYPE "SupportHandledBy" AS ENUM ('ai', 'officer');

ALTER TABLE "support_conversations"
  ADD COLUMN "handled_by" "SupportHandledBy" NOT NULL DEFAULT 'ai';

-- Every conversation that exists TODAY predates the AI leg: it was opened under the
-- officers-answer design, officers have been working it, and the badge must keep counting it.
-- Leaving these at the new default would silently remove them from the waiting count and put a
-- model into threads a person was already handling — the exact two things the column forbids.
UPDATE "support_conversations" SET "handled_by" = 'officer';
