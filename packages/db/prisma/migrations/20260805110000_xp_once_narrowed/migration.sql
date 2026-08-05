-- Narrows the XP idempotency index to the reasons that are genuinely one-shot. Hand-written (ADR-020).
--
-- ★ THE INDEX AND THE VOTE LEDGER DISAGREED, AND THE VOTE LOST ★
--
-- xp_events_once_idx was UNIQUE (user_id, reason, subject) WHERE subject IS NOT NULL, on the
-- contract that repeatable awards carry a NULL subject. The vote ledger never signed that
-- contract: it writes signed rows with subject = the post id, because "+10 postUpvoted on THAT
-- post" is what makes a ledger somebody can read. The collision is not theoretical —
--
--   · a member upvotes a post (+10 lands), then withdraws it: the −10 row has the same
--     (author, 'postUpvoted', post) key, violates the index, and the WHOLE vote transaction —
--     vote row, denormalised score, ledger — rolls back as a 500;
--   · a second member upvoting the same post collides with the first member's award the same way.
--
-- So the index now names the one-shot reasons instead of assuming them. 'playedToday' (subject is
-- the UTC date) and the two answer-acceptance awards keep their run-twice-award-once guarantee —
-- their writers rely on it via skipDuplicates — and the vote reasons are simply out of scope, as
-- their arithmetic requires. New one-shot reasons must be ADDED HERE when their writers are born;
-- a reason left off this list is repeatable, which is the safe default for a ledger.
DROP INDEX "xp_events_once_idx";

CREATE UNIQUE INDEX "xp_events_once_idx"
  ON "xp_events" ("user_id", "reason", "subject")
  WHERE "subject" IS NOT NULL
    AND "reason" IN ('playedToday', 'answerAccepted', 'answerAcceptedByYou');
