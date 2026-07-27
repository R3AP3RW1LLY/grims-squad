-- The ten progression ranks, as roles (P1 — rank progression).
--
-- Until now `roles` held ONLY the six leadership roles plus Webmaster. The
-- promotion engine reads a member's rank from their GRANTS (INV-047 forbids a
-- denormalised rank column, because it drifts from what actually confers it) —
-- so with no rank rows to grant, the engine had nothing to read and every dry
-- run correctly reported zero. This is the missing data, not a missing feature.
--
-- ★ perm_mask IS ZERO FOR EVERY ONE OF THEM, AND THAT IS THE POINT ★
--
-- INV-046: "A tenure or loyalty rank never grants a permission." A member's
-- effective mask is identical whether they are a Sergeant or a Grand Master
-- General. Time served must never confer moderation power — that was an
-- explicit human decision, and these rows are where it would be quietly undone
-- if somebody later "helpfully" gave the senior ranks a few bits.
--
-- rank_order runs 100..190 so every ladder rank sorts BELOW every leadership
-- role (10..60) and below Webmaster. rank_order is display and precedence only;
-- it confers nothing.

INSERT INTO roles (id, key, name, rank_order, perm_mask, is_hierarchical, description) VALUES
  (gen_random_uuid(), 'rank_cadet', 'Cadet', 100, 0::numeric(40,0), true,
   'Onboarding complete. The floor of the ladder — granted by an officer, never by the engine.'),
  (gen_random_uuid(), 'rank_sergeant', 'Sergeant', 110, 0::numeric(40,0), true,
   'One qualifying month at Cadet.'),
  (gen_random_uuid(), 'rank_master_sergeant', 'Master Sergeant', 120, 0::numeric(40,0), true,
   'Two cumulative qualifying months.'),
  (gen_random_uuid(), 'rank_2nd_lieutenant', '2nd Lieutenant', 130, 0::numeric(40,0), true,
   'Three cumulative qualifying months.'),
  (gen_random_uuid(), 'rank_1st_lieutenant', '1st Lieutenant', 140, 0::numeric(40,0), true,
   'Four cumulative qualifying months.'),
  (gen_random_uuid(), 'rank_commander', 'Commander', 150, 0::numeric(40,0), true,
   'Five cumulative qualifying months.'),
  (gen_random_uuid(), 'rank_master_commander', 'Master Commander', 160, 0::numeric(40,0), true,
   'Six cumulative qualifying months.'),
  (gen_random_uuid(), 'rank_general', 'General', 170, 0::numeric(40,0), true,
   'Seven cumulative months. TWO qualifying months are required here — there is no eight-month rank.'),
  (gen_random_uuid(), 'rank_lord_general', 'Lord General', 180, 0::numeric(40,0), true,
   'Nine cumulative months. THREE qualifying months are required here — there is no ten or eleven-month rank.'),
  (gen_random_uuid(), 'rank_grand_master_general', 'Grand Master General', 190, 0::numeric(40,0), true,
   'Twelve cumulative months. The top of the ladder; the cycle ends here.')
ON CONFLICT (key) DO NOTHING;

-- Discord mappings, so the platform LEARNS each member's current rank from the
-- guild rather than requiring 108 people to be entered by hand. The ids come
-- from ssot/02-domain/discord-roles.yaml, which is where snowflakes live —
-- never in application source (INV-008).
--
-- Direction is `inbound`: Discord is authoritative for what rank someone holds
-- TODAY. That is what makes the first reconciliation a bootstrap rather than a
-- mass revocation.
INSERT INTO role_mappings (role_id, discord_role_id, sync_direction)
SELECT r.id, m.discord_role_id, 'inbound'::"SyncDirection"
FROM (VALUES
  ('rank_cadet',                 '1528251831531339927'),
  ('rank_sergeant',              '1528252058380144740'),
  ('rank_master_sergeant',       '1528252671453036634'),
  ('rank_2nd_lieutenant',        '1528252377143050361'),
  ('rank_1st_lieutenant',        '1528253163755405402'),
  ('rank_commander',             '1528253388901580881'),
  ('rank_master_commander',      '1528253529532141739'),
  ('rank_general',               '1528253849998065834'),
  ('rank_lord_general',          '1528254061504237700'),
  ('rank_grand_master_general',  '1528254279289278534')
) AS m(role_key, discord_role_id)
JOIN roles r ON r.key = m.role_key
ON CONFLICT (role_id, discord_role_id) DO NOTHING;
