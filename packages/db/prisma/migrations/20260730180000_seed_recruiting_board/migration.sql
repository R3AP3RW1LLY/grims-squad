-- The Recruiting board.
--
-- Squadron owner, 2026-07-30: "add a category to the forums called Recruiting please, this should
-- be a publically visible category please like the Guides are".
--
-- * view_perm IS NULL, THE SECOND PUBLIC BOARD *
--
-- Same exception as Guides, for the same reason and a stronger one: recruitment copy that only
-- existing members can read is recruitment nobody is recruited by. A stranger deciding whether to
-- apply is exactly the reader this board is for.
--
-- Being a public CATEGORY does not make its threads public. forum_threads.is_public defaults to
-- false, so a post is drafted privately and published on purpose; an anonymous visitor sees only
-- what was explicitly published, while members see drafts too.
--
-- * post_perm IS FORUM_POST_GUIDE (128), NOT FORUM_POST_OFFICER *
--
-- Deliberately different from Guides, which is 64. Recruitment copy needs maintaining -- links go
-- stale, requirements change -- and 128 is the bit that carries the documentation-maintainer rule:
-- anybody holding it may edit anybody else post on a board whose post_perm demands it. Officers and
-- the webmaster both hold it, so a dead Inara link can be fixed by whoever notices rather than only
-- by whoever wrote it.
--
-- Positioned 6, immediately after Guides: the two public boards sit together rather than with a
-- members-only board between them.
INSERT INTO forum_categories (id, slug, name, description, view_perm, post_perm, position)
VALUES (
  gen_random_uuid(),
  'recruiting',
  'Recruiting',
  'Who we are, who we are looking for, and how to join. Published posts are readable by anybody.',
  NULL,
  128::numeric(40,0),
  6
)
ON CONFLICT (slug) DO NOTHING;
