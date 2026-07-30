-- The webmaster runs the website. It does not speak for the squadron.
--
-- Squadron owner, 2026-07-29: "webmaster should not be able to post to Announcements, as this
-- is for officers! ... the webmasters are not admins by default in the squadron. they do need
-- all website functions but not posting to the web app announcements."
--
-- The role carried ALL_PERMISSIONS, which includes FORUM_POST_OFFICER (bit 6, value 64) —
-- described in permissions.ts as Announcements and the Squadron Log. So whoever ran the website
-- could post in the squadron's name, which is a different authority from administering it. The
-- codebase already drew that line elsewhere: `isOfficer` is a RANK question, and its comment
-- notes the webmaster "holds every permission on the platform and no standing in the squadron
-- at all". The mask had simply never been made to agree.
--
-- ★ AN OFFICER-WEBMASTER IS UNAFFECTED ★
--
-- `computeEffectiveMask` ORs every held role together, so somebody holding BOTH webmaster and an
-- officer rank still receives FORUM_POST_OFFICER from the rank. The capability follows squadron
-- standing rather than website access, which is the whole point.
--
-- ★ WHY ARITHMETIC AND NOT `& ~64` ★
--
-- Postgres has NO BITWISE OPERATOR FOR NUMERIC, and perm_mask is NUMERIC(40,0) because the mask
-- exceeds 64 bits (ADR-005). `perm_mask & ~64` fails with "no operator matches the given name
-- and argument type". The same constraint is why the ACL extension resolves visible ids in
-- TypeScript rather than in SQL.
--
-- `div()` is integer division; plain `/` on numeric returns a fraction, so `floor(perm_mask/64)
-- % 2` reports 0 for a mask that plainly has the bit set. That was tried first and was wrong.
--
-- The WHERE guard makes this idempotent, and correct against a mask that has since been edited
-- in the role editor: it removes the bit if present and does nothing if not. The intent is
-- "clear this one bit", never "replace the mask with a number I computed today".
UPDATE roles
SET perm_mask = perm_mask - 64
WHERE key = 'webmaster'
  AND div(perm_mask, 64) % 2 = 1;

-- ★ AND THE OFFICERS BOARD GATED POSTING ON A *VIEW* BIT ★
--
-- Caught while verifying the change above. `forum_categories.post_perm` for the officers board
-- was seeded as FORUM_VIEW_OFFICER (16) rather than FORUM_POST_OFFICER (64) — so anybody who
-- could SEE the board could post in it, which is not what a separate post permission is for.
--
-- Guarded on the current value so this is idempotent and does not overwrite a deliberate change.
UPDATE forum_categories
SET post_perm = 64
WHERE slug = 'officers' AND post_perm = 16;
