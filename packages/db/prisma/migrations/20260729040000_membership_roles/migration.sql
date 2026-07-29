-- Membership roles become real, editable roles (squadron owner, 2026-07-29).
--
-- ★ WHY THEY DID NOT EXIST ★
--
-- "Grim's Squad members" and "Allies" are ordinary Discord roles and most of the
-- squadron wears one. They had no `roles` row, so they had no permission mask
-- and could not be edited — which meant the platform had no way to say what an
-- ordinary member may do, only what an officer may do.
--
-- ★ AND WHY `unranked` IS ONE TOO ★
--
-- Somebody signing in who holds neither is not a special case to be ignored;
-- they are the floor, and the floor is exactly the thing an admin needs to be
-- able to set. Without a row there was nothing to edit and no honest answer to
-- "what can a brand-new member do".
--
-- It is granted by role sync when NOTHING else maps — see role-sync.service.ts.
-- A role granted to nobody would be a control that silently does nothing, which
-- is worse than no control at all.
--
-- ★ MASKS ARE ZERO ON PURPOSE ★
--
-- Not a placeholder to fill in later: it is the honest starting point. These
-- roles conferred nothing yesterday, and a migration that quietly granted the
-- whole squadron a permission bundle nobody chose would be a privilege
-- escalation dressed as a feature. The page exists to set them deliberately.
--
-- `is_hierarchical` false: none of these is a rung on the promotion ladder, and
-- marking them true would put them in the ladder the promotion job walks.
INSERT INTO roles (id, key, name, rank_order, perm_mask, is_hierarchical, description) VALUES
  (gen_random_uuid(), 'grims_squad_members', 'Grim''s Squad members', 900,
   0::numeric(40,0), false,
   'Ordinary squadron membership. The baseline for anybody who flies with us.'),
  (gen_random_uuid(), 'allies', 'Allies', 910,
   0::numeric(40,0), false,
   'Friendly commanders from outside the squadron.'),
  (gen_random_uuid(), 'unranked', 'Unranked', 999,
   0::numeric(40,0), false,
   'Holds no squadron role at all. Granted automatically when nothing else maps.')
ON CONFLICT (key) DO NOTHING;

-- The two that exist in Discord are mapped so reconciliation grants them.
-- `unranked` deliberately has NO mapping: it is the absence of a role, not a
-- role somebody wears, and role sync grants it directly.
--
-- Snowflakes live in DATA, never in application source (INV-008). Verified
-- against the live guild before being written down.
INSERT INTO role_mappings (role_id, discord_role_id, sync_direction)
SELECT r.id, m.discord_role_id, 'inbound'::"SyncDirection"
FROM (VALUES
  ('grims_squad_members', '804027821986807860'),
  ('allies',              '892493916530671657')
) AS m(key, discord_role_id)
JOIN roles r ON r.key = m.key
ON CONFLICT (role_id, discord_role_id) DO NOTHING;
