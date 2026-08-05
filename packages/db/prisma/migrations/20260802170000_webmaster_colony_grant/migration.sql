-- The webmaster holds every website permission except squadron standing (INV-006).
--
-- ★ WHY A MIGRATION AND NOT A CODE CHANGE ★
--
-- Role masks are stored ROWS, not computed from the presets in code. `ROLE_PRESETS` is what a role
-- is seeded with; it is not reapplied when a permission is added, and deliberately so — an officer
-- who has taken a bit away from a rank would have it silently handed back on the next deploy.
--
-- The consequence is that a new permission reaches nobody until somebody grants it, which is
-- correct for a rank and WRONG for the webmaster: INV-006 says they carry everything that is not
-- squadron standing, and `schema.int.spec.ts` checks the live database against that promise. It
-- failed the moment the four colonisation bits existed, which is the guard working.
--
-- ★ ADDED, NOT ASSIGNED ★
--
-- `| ` is not available: the mask is NUMERIC(40,0) because it exceeds a signed 64-bit integer
-- (SITE_CONFIG alone is 2^63), and Postgres has no bitwise operator for NUMERIC. Addition is
-- equivalent PROVIDED the bit is not already set — hence the guard in the WHERE clause, which uses
-- the same `mod(div(...))` test the rest of this schema uses to read a single bit out of a NUMERIC.
--
--   COLONY_VIEW          1 << 71
--   COLONY_POST          1 << 72
--   COLONY_SHARE_PUBLIC  1 << 73
--   COLONY_MANAGE        1 << 74
UPDATE "roles"
   SET "perm_mask" = "perm_mask" + 35417748621522339102720
 WHERE "key" = 'webmaster'
   -- Idempotent: re-running must not add the bits twice, which would set bit 75 and grant a
   -- permission that does not exist yet. Checked on the lowest of the four, because they are only
   -- ever granted together.
   AND mod(div("perm_mask", 2361183241434822606848), 2) = 0;
