-- AI_REVIEW (bit 54): read the AI call log, work the screening queue.
--
-- Squadron owner, 2026-07-30: every AI conversation is "logged for officer review ... it also need
-- to be visible to the webmaster role! this is non-negotiable as the webmaster is the AI developer."
--
-- * WHY A NEW BIT RATHER THAN AI_TOOLS_ADMIN *
--
-- AI_TOOLS_ADMIN already covers cross-member conversation review and would have satisfied this in
-- one line. It also carries the kill switches and quota overrides. Reviewing what the model said
-- and being able to turn it off are different jobs, and only one was asked for.
--
-- * WHY ADDITION AND NOT  *
--
-- perm_mask is NUMERIC(40,0), and POSTGRES HAS NO BITWISE OPERATOR FOR NUMERIC --  is a
-- syntax error here, which is how the first version of this migration failed. The masks exceed
-- bigint, so casting down is not available either.
--
-- Addition IS the same as OR for a bit that is not already set, and the WHERE clause proves it is
-- not: mod(div(mask, 2^54), 2) = 0 tests bit 54 using integer division, which numeric does support.
-- Without that guard, re-running this would double-count the bit into bit 55 and grant something
-- nobody intended.
UPDATE roles
SET perm_mask = perm_mask + 18014398509481984
WHERE perm_mask > 0
  AND mod(div(perm_mask, 18014398509481984), 2) = 0;
