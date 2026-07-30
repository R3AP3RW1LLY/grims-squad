-- The starting boards.
--
-- Seeded as a migration for the same reason the roles are (see the webmaster and leadership
-- migrations): every install — a developer's laptop, production, a future staging box — gets the
-- same board layout, and nobody has to remember to run a script. P2.1 shipped the forum with the
-- categories created by hand on one machine, so production came up with zero boards and the page
-- correctly said there was nothing to see.
--
-- ★ THE MASKS, AND WHY THESE ONES ★
--
--   4  FORUM_VIEW_MEMBER   -- squadron owner, 2026-07-29: all forum users must be in our Discord
--   8  FORUM_POST_MEMBER
--  16  FORUM_VIEW_OFFICER
--  64  FORUM_POST_OFFICER  -- Announcements and the Squadron Log; NOT held by the webmaster
--
-- Every board requires FORUM_VIEW_MEMBER to read, so the forum is members-only in practice. A
-- public-readable board remains one row away (`view_perm = NULL`) because the schema has always
-- supported it — that capability is retained deliberately rather than designed out.
--
-- Announcements and Officers gate POSTING on FORUM_POST_OFFICER, not on a view bit. Getting that
-- wrong is what let anybody who could see the officers board post in it.
--
-- ON CONFLICT DO NOTHING on the unique slug, so this is idempotent and never overwrites a board
-- an officer has since renamed, re-described or re-permissioned in the console.
INSERT INTO forum_categories (id, slug, name, description, view_perm, post_perm, position)
VALUES
  (gen_random_uuid(), 'announcements', 'Announcements',
   'Squadron news. Everybody reads it; officers post it.',
   4::numeric(40,0), 64::numeric(40,0), 10),

  (gen_random_uuid(), 'general', 'General',
   'Anything and everything, from a good screenshot to a bad idea.',
   4::numeric(40,0), 8::numeric(40,0), 20),

  (gen_random_uuid(), 'operations', 'Operations',
   'Wings forming up, and what they need.',
   4::numeric(40,0), 8::numeric(40,0), 30),

  (gen_random_uuid(), 'bgs', 'Background Simulation',
   'The faction, its systems, and where effort is going this week.',
   4::numeric(40,0), 8::numeric(40,0), 40),

  (gen_random_uuid(), 'help', 'Help and questions',
   'Stuck on an engineer, a build, or a mechanic nobody explains well. Ask here.',
   4::numeric(40,0), 8::numeric(40,0), 50),

  (gen_random_uuid(), 'officers', 'Officers',
   'Leadership only.',
   16::numeric(40,0), 64::numeric(40,0), 90)
ON CONFLICT (slug) DO NOTHING;
