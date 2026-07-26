-- The `webmaster` role: full site permissions, granted OUTSIDE the Discord
-- hierarchy as a support role.
--
-- is_hierarchical = false: confers no rank in the squadron. It is an orthogonal
-- tag, like bgs_team or carrier_owner.
--
-- No row in role_mappings, deliberately: there is no Discord role for this, so
-- role sync can neither grant nor revoke it.
--
-- ★ THE MASK IS A LITERAL, NOT AN EXPRESSION. ★
-- The first version of this migration computed it as (2^0 + 2^1 + ... + 2^70).
-- Postgres's `^` operator returns DOUBLE PRECISION, so the high bits — 2^63 and
-- 2^70 — lost precision before the cast to numeric(40,0), and the row was
-- seeded as 1197902339489250000000 instead of 1197902339489246755967. That is
-- not a rounding curiosity: it sets permission bits that were never intended
-- and clears ones that were, silently, in the single most powerful role in the
-- system. Writing the value out is uglier and cannot go wrong.
--
-- Value = OR of every bit in ssot/04-contracts/permissions.ts as of P1.3:
--   FORUM 0-6 · OPS 10-13 · FLEET 20-24 · BGS 30-32 · TRADE 40-42
--   AI 50-53 · ADMIN 60-63 · TELEMETRY 70
-- A future permission does NOT widen this row automatically. Granting a new bit
-- to webmaster is then a deliberate, reviewable migration rather than a silent
-- side effect of adding a constant.
INSERT INTO roles (id, key, name, rank_order, perm_mask, is_hierarchical, description)
VALUES (
  gen_random_uuid(),
  'webmaster',
  'Webmaster',
  1000,
  1197902339489246755967::numeric(40,0),
  false,
  'Website support. Full site permissions, granted outside the Discord hierarchy. Every grant and revoke is audited.'
)
ON CONFLICT (key) DO UPDATE SET perm_mask = EXCLUDED.perm_mask;
