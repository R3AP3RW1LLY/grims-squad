-- Per-thread read access for a NAMED USER who cannot see the thread's category.
--
-- Squadron owner, 2026-07-29: "officers category should only be visible to officers. non-officers
-- should not have the ability to view unless permission to a specific user is provided this should
-- be done from a dropdown on the post that allows an admin to allow access to one or more users
-- (multi select dropdown that is searchable and autocompletable)".
--
-- ★ WHY A TABLE AND NOT A WIDER PERMISSION ★
--
-- The alternatives both overshoot. Inventing a role, or clearing the officers board's view_perm,
-- grants access to EVERY thread on that board and keeps doing so long after the one conversation
-- that needed it. A row here is scoped to one thread and one person, and revoking it is a DELETE.
--
-- ★ THIS TABLE WIDENS ACCESS — THE ONLY THING IN THE FORUM THAT DOES ★
--
-- forum_threads.is_public can only NARROW: a thread reaches the internet only if its category is
-- public too. This does the reverse, letting a named individual past a category ACL they do not
-- satisfy. Hence explicit, attributable rows rather than a flag:
--
--   granted_by  NOT NULL — an unattributable grant is one nobody can review
--   granted_at            — when, for the same reason
--   ON DELETE CASCADE from the thread, so a deleted thread leaves no live grants
--
-- ★ READ ONLY ★
--
-- A grant conveys VIEW. Posting is still decided by the category's post_perm, so somebody invited
-- to read an officers' thread cannot reply in it. Being shown something is not being given a voice
-- in it.
CREATE TABLE "forum_thread_grants" (
    "thread_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "reason" TEXT,

    -- Composite PK: the same person cannot be granted the same thread twice, enforced by the
    -- database rather than by an upsert everybody remembers to write.
    CONSTRAINT "forum_thread_grants_pkey" PRIMARY KEY ("thread_id","user_id")
);

-- The hot path. Every request by a member who holds any grant resolves "which extra threads may
-- this user see" from exactly this index.
CREATE INDEX "forum_thread_grants_user_id_idx" ON "forum_thread_grants"("user_id");

ALTER TABLE "forum_thread_grants"
  ADD CONSTRAINT "forum_thread_grants_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The grantee cascades: a deleted account should not leave grants pointing at nothing.
ALTER TABLE "forum_thread_grants"
  ADD CONSTRAINT "forum_thread_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The GRANTER restricts, deliberately. Deleting the admin who issued a grant must not silently
-- erase who authorised it, and must not silently delete the grant either — both would destroy the
-- audit trail this column exists to provide.
ALTER TABLE "forum_thread_grants"
  ADD CONSTRAINT "forum_thread_grants_granted_by_fkey"
  FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supports the anonymous-visitor predicate (category public AND is_public), which is otherwise a
-- full scan of every thread on a public board.
CREATE INDEX "forum_threads_is_public_idx" ON "forum_threads"("is_public");
