-- AI_TRAINING (bit 55) and AI_TRAIN_SUBMIT (bit 56).
--
-- Squadron owner, 2026-08-01: "Ai Training also needs permissions that we can add to each role
-- please. set that up in the roles and permissions page on the /app page please so we can enable /
-- disable it as we need to."
--
-- ★ TWO BITS, BECAUSE THEY ARE TWO JOBS ★
--
--   55  AI_TRAINING       see what the assistant has learned; approve submitted screenshots.
--   56  AI_TRAIN_SUBMIT   offer your own screenshots on Help Train the Bot.
--
-- One bit covering both would mean the only way to stop somebody submitting is to take away their
-- ability to review, and the only way to let somebody review is to let everybody submit.
--
-- ★ ADDITION, NOT BITWISE OR — AND THE GUARD IS WHAT MAKES IT SAFE ★
--
-- perm_mask is NUMERIC(40,0) and Postgres has NO bitwise operator for numeric; `|` is a syntax
-- error here, and the masks exceed bigint so casting down is not available either. Addition is the
-- same as OR for a bit that is not already set, and `mod(div(mask, 2^n), 2) = 0` proves it is not —
-- integer division, which numeric does support.
--
-- Without that guard a re-run would carry into the NEXT bit and silently grant something nobody
-- intended. Migrations are re-run: on a restore, on a fresh environment, by somebody testing.

-- ── bit 55: who may see and approve ─────────────────────────────────────────
--
-- Every role that already holds any permission. Officers were given AI_REVIEW for the same reason —
-- a queue nobody can open fills up — and judging whether a screenshot of a Krait belongs in a
-- training set is a job for people who fly them.
--
-- The webmaster gets it by holding everything outside squadron standing, which is the same
-- mechanism as AI_REVIEW and needs no special case here.
UPDATE roles
SET perm_mask = perm_mask + 36028797018963968
WHERE perm_mask > 0
  AND mod(div(perm_mask, 36028797018963968), 2) = 0;

-- ── bit 56: who may contribute ──────────────────────────────────────────────
--
-- Every member. The whole point of "Help Train the Bot" is that the pool fills from people playing
-- the game, and a collection drive nobody is allowed to join collects nothing.
--
-- It is a BIT rather than an assumption precisely so it can be taken away from one role when
-- somebody floods the pool — the sanction that lets the feature stay open by default.
UPDATE roles
SET perm_mask = perm_mask + 72057594037927936
WHERE perm_mask > 0
  AND mod(div(perm_mask, 72057594037927936), 2) = 0;
