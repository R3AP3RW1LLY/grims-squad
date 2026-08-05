-- The suggestion box and the roadmap. Hand-written (ADR-020).
--
-- ★ THE APPROVED DESIGN, WAVES 4 AND 5 OF HELP & SUPPORT ★
--
-- "a suggestion box feature that sends the webmaster user submitted ideas and suggestions."
-- Members send ideas; the webmaster REVIEWS then PUBLISHES: one click turns a suggestion into a
-- thread in a new Feature Requests board — where the squadron votes on it, with the sender
-- credited by name — or declines it kindly. Promoted asks land on a webmaster-managed kanban
-- (Ideas / Considering / Planned / Building / Shipped) that every member reads at /roadmap.

CREATE TYPE "SuggestionStatus" AS ENUM ('new', 'published', 'declined');
CREATE TYPE "RoadmapColumn" AS ENUM ('ideas', 'considering', 'planned', 'building', 'shipped');

CREATE TABLE "suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    -- NOT NULL, structurally: publishing credits the sender by display name, and a suggestion
    -- nobody can be credited for is what the widget's sign-in invitation exists to prevent.
    "user_id" UUID NOT NULL,
    -- Plain text, capped at 2000 characters in the service — an idea, not an essay.
    "body" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'new',
    -- The review stamp: when, and by whom.
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by_id" UUID,
    -- The Feature Requests thread this became. A bare uuid, the announcements.forum_thread_id
    -- precedent: threads are soft-deleted rather than removed, and an FK here would put a
    -- constraint on forum moderation.
    "published_thread_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- The webmaster's inbox: new suggestions, oldest first — a queue is worked in arrival order.
CREATE INDEX "suggestions_status_created_at_idx" ON "suggestions"("status", "created_at");

-- "Your suggestions", for the widget's own list.
CREATE INDEX "suggestions_user_id_created_at_idx" ON "suggestions"("user_id", "created_at");

-- CASCADE: a deleted account takes its unattributable ideas with it — a suggestion exists to be
-- credited, and one with no sender can be neither published nor answered.
ALTER TABLE "suggestions"
  ADD CONSTRAINT "suggestions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL: the verdict outlives the reviewer's account.
ALTER TABLE "suggestions"
  ADD CONSTRAINT "suggestions_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "roadmap_cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Capped at 200 in the service, the thread-title ceiling: promoted cards take their title
    -- from one.
    "title" TEXT NOT NULL,
    "body" TEXT,
    -- `column` is a reserved word in SQL, so the database column wears a name that never needs
    -- quoting in a hand-written migration. The Prisma field is still `column`.
    "board_column" "RoadmapColumn" NOT NULL DEFAULT 'ideas',
    "position" INTEGER NOT NULL DEFAULT 0,
    -- The Feature Requests thread this was promoted from. UNIQUE: one thread is one item of
    -- work, and promoting it twice would put the same ask on the board in two columns.
    "source_thread_id" UUID,
    -- Archived cards leave every board view but keep their history — "we are not doing this
    -- after all" is itself a fact worth keeping.
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "roadmap_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roadmap_cards_source_thread_id_key" ON "roadmap_cards"("source_thread_id");

-- The board read: one column's live cards, in order.
CREATE INDEX "roadmap_cards_board_column_position_idx" ON "roadmap_cards"("board_column", "position");

-- ── The Feature Requests board ───────────────────────────────────────────────
--
-- Seeded here the way every board is (see 20260729210000_seed_forum_boards): an idempotent
-- INSERT, so every install gets the same board and ON CONFLICT (slug) DO NOTHING never
-- overwrites what an officer later renames or re-permissions in the console.
--
-- ★ THE MASKS, AND WHY THESE ONES ★
--
--   view_perm =                   4  FORUM_VIEW_MEMBER — the squadron reads it and votes on it.
--                                    Voting rides VISIBILITY (vote.service.ts), not post_perm,
--                                    so this bit alone is what opens the vote rail to members.
--   post_perm = 9223372036854775808  SITE_CONFIG (bit 63) — the webmaster's bit. Threads here
--                                    are born from the publish flow, not typed; gating creation
--                                    on the same bit as the inbox means the two cannot drift.
--
-- The officer-board pattern (Announcements: view 4, post 64) applied one tier up. As on
-- Announcements, post_perm gates REPLIES too — members vote rather than debate here, and the
-- thread body says where discussion lives. No role grant is needed: SITE_CONFIG already exists
-- and is held by the webmaster tier.
INSERT INTO forum_categories (id, slug, name, description, view_perm, post_perm, position)
VALUES (
  gen_random_uuid(),
  'feature-requests',
  'Feature Requests',
  'Ideas from the suggestion box, published for a vote. Each thread credits the member who sent it — vote up what you want built.',
  4::numeric(40,0),
  9223372036854775808::numeric(40,0),
  55
)
ON CONFLICT (slug) DO NOTHING;
