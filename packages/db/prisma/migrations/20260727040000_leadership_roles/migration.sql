-- Leadership roles and their Discord mappings (human decision, 2026-07-27).
--
-- Two tiers:
--   SUPERUSER  Galactic Admiral, Prime Legate — full permissions, as webmaster.
--   OFFICER    Squadron Leader, Sector Overseer, First Commander, Chief Fleet
--              Commander — admin area access, per-feature CRUD configurable
--              later through the leadership settings page.
--
-- Masks are LITERALS, never expressions. Computing them as (2^0 + 2^1 + ...)
-- silently loses precision above 2^53 because Postgres `^` returns double
-- precision — that defect already reached this database once, in the webmaster
-- row, and set permission bits nobody intended.
--
--   superuser 1197902339489246755967  every bit that exists
--   officer   1186364117243923545215  superuser MINUS ROLE_MANAGE (61),
--                                     SITE_CONFIG (63) and AI_TOOLS_ADMIN (53)
--
-- The officer bundle deliberately withholds ROLE_MANAGE and SITE_CONFIG: an
-- officer who can grant roles can grant themselves anything, which makes the
-- tier boundary decorative. It DOES include MEMBER_MANAGE and AUDIT_VIEW, so
-- officers can administer members and see what other officers did.

INSERT INTO roles (id, key, name, rank_order, perm_mask, is_hierarchical, description) VALUES
  (gen_random_uuid(), 'galactic_admiral', 'Galactic Admiral', 10,
   1197902339489246755967::numeric(40,0), true,
   'Reserved. Full platform permissions.'),
  (gen_random_uuid(), 'prime_legate', 'Prime Legate', 20,
   1197902339489246755967::numeric(40,0), true,
   'Reserved, second in command. Full platform permissions.'),
  (gen_random_uuid(), 'chief_fleet_commander', 'Chief Fleet Commander', 30,
   1186364117243923545215::numeric(40,0), true,
   'Leadership. Admin area access; per-feature CRUD configurable.'),
  (gen_random_uuid(), 'first_commander', 'First Commander', 40,
   1186364117243923545215::numeric(40,0), true,
   'Leadership. Admin area access; per-feature CRUD configurable.'),
  (gen_random_uuid(), 'sector_overseer', 'Sector Overseer', 50,
   1186364117243923545215::numeric(40,0), true,
   'Leadership. Admin area access; per-feature CRUD configurable.'),
  (gen_random_uuid(), 'squadron_leader', 'Squadron Leader', 60,
   1186364117243923545215::numeric(40,0), true,
   'Leadership. Admin area access; per-feature CRUD configurable. Awards loyalty ranks.')
ON CONFLICT (key) DO UPDATE SET perm_mask = EXCLUDED.perm_mask, description = EXCLUDED.description;

-- Discord role id -> our role. IDs live in DATA, never in source (INV-008), so
-- renaming a role in Discord changes nothing here. All six were verified
-- against the live guild before being written down.
INSERT INTO role_mappings (role_id, discord_role_id, sync_direction)
SELECT r.id, m.discord_role_id, 'inbound'::"SyncDirection"
FROM (VALUES
  ('galactic_admiral',      '804027885081591818'),
  ('prime_legate',          '1512912541771235601'),
  ('chief_fleet_commander', '1512912750416760892'),
  ('first_commander',       '1513748632963387523'),
  ('sector_overseer',       '1513749464458723469'),
  ('squadron_leader',       '1513669809756311593')
) AS m(key, discord_role_id)
JOIN roles r ON r.key = m.key
ON CONFLICT (role_id, discord_role_id) DO NOTHING;
