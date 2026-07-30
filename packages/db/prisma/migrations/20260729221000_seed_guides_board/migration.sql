-- The Guides board.
--
-- Squadron owner, 2026-07-29: a guides category, with an option to make individual guide posts
-- public, and public ones surfaced in the public site's navigation.
--
-- ★ view_perm IS NULL — THE ONLY PUBLIC BOARD ★
--
-- Every other board requires FORUM_VIEW_MEMBER, because all forum users must be in the Discord
-- (D34). This one is the deliberate exception: a joining guide is no use if you have to already
-- be a member to read it.
--
-- Being a public CATEGORY does not make its threads public. `forum_threads.is_public` defaults to
-- false, so a guide is drafted privately and published on purpose; an anonymous visitor sees only
-- the threads explicitly published. Members see everything here, drafts included.
--
-- ★ post_perm IS FORUM_POST_OFFICER (64) ★
--
-- A guide carries the squadron's voice — it is the first thing a stranger reads about us — so
-- writing one is an officer action, exactly like Announcements. Note that the webmaster role does
-- NOT hold this bit (see 20260729200000): running the website is not speaking for the squadron.
INSERT INTO forum_categories (id, slug, name, description, view_perm, post_perm, position)
VALUES (
  gen_random_uuid(),
  'guides',
  'Guides',
  'How to join, how to set things up, and how the squadron does things. Published guides are readable by anybody.',
  NULL,
  64::numeric(40,0),
  5
)
ON CONFLICT (slug) DO NOTHING;
