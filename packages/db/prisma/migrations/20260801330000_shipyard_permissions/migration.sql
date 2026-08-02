-- Shipyard permissions: bits 43, 44, 45 and 46.
--
-- Squadron owner, 2026-08-01: "create the permissions for the Shipyard category and add them to the
-- roles page make them work the same as all other categories please!" — and, separately, "the
-- ability for our users to share their builds and make them visible to the squadron and public if
-- they choose to."
--
-- ★ FOUR BITS, BECAUSE THEY ARE FOUR DIFFERENT CONSEQUENCES ★
--
--   43  SHIPYARD_VIEW          open the outfitter and the assisted builder.
--   44  SHIPYARD_SAVE          keep builds against their own account.
--   45  SHIPYARD_SHARE         publish to the squadron, with the author's name on it.
--   46  SHIPYARD_SHARE_PUBLIC  publish on a link that works with NO session at all.
--
-- Planning a ship is private and costs nothing. Publishing one cannot be recalled. One bit for all
-- four would mean the only way to stop somebody publishing to the open web is to stop them planning
-- a ship at all, which is the shape of gate that gets left wide open because closing it costs too
-- much.
--
-- ★ ADDITION, NOT BITWISE OR — AND THE GUARD IS WHAT MAKES IT SAFE ★
--
-- perm_mask is NUMERIC(40,0) and Postgres has NO bitwise operator for numeric; `|` is a syntax
-- error here, and the masks exceed bigint so casting down is not available either. Addition equals
-- OR for a bit that is not already set, and `mod(div(mask, 2^n), 2) = 0` proves it is not.
--
-- Without that guard a re-run carries into the NEXT bit and silently grants something nobody
-- intended. Migrations are re-run: on a restore, on a fresh environment, by somebody testing.
--
-- ★ WHY `perm_mask > 0` AND NOT A LIST OF ROLES ★
--
-- The same predicate the AI permissions used. The rank ladder rows carry an empty mask — the owner
-- is granting those in production as features come alive ("we will add permissions in production as
-- features are added and the site comes alive") — and this migration must not pre-empt that
-- decision by writing bits into roles that were deliberately left at zero. It grants to the roles
-- that already do something, and the roles page does the rest.

-- ── bit 43: SHIPYARD_VIEW ───────────────────────────────────────────────────
UPDATE roles
SET perm_mask = perm_mask + 8796093022208
WHERE perm_mask > 0
  AND mod(div(perm_mask, 8796093022208), 2) = 0;

-- ── bit 44: SHIPYARD_SAVE ───────────────────────────────────────────────────
UPDATE roles
SET perm_mask = perm_mask + 17592186044416
WHERE perm_mask > 0
  AND mod(div(perm_mask, 17592186044416), 2) = 0;

-- ── bit 45: SHIPYARD_SHARE ──────────────────────────────────────────────────
UPDATE roles
SET perm_mask = perm_mask + 35184372088832
WHERE perm_mask > 0
  AND mod(div(perm_mask, 35184372088832), 2) = 0;

-- ── bit 46: SHIPYARD_SHARE_PUBLIC ───────────────────────────────────────────
--
-- Granted alongside the others rather than withheld: the owner's instruction is that members share
-- publicly "if they choose to". The separate bit exists so an officer can take THIS one away from
-- one person without touching anything else they can do here.
--
-- Deliberately NOT in PRIVILEGED_PERMISSIONS. `requiresTwoFactor` is built from that constant, so
-- putting it there would have obliged every member holding this bit to enrol an authenticator in
-- order to share a ship build.
UPDATE roles
SET perm_mask = perm_mask + 70368744177664
WHERE perm_mask > 0
  AND mod(div(perm_mask, 70368744177664), 2) = 0;
