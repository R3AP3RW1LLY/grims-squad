-- post_revisions.edited_by had NO foreign key.
--
-- Found while building the edit-history read (P2.2). The column existed as a bare uuid, so a
-- revision could name an account that no longer exists — and the history a moderator reads to
-- decide whether a post was quietly rewritten would show an id it could not resolve to a person.
-- An audit trail that cannot name the actor is not an audit trail.
--
-- ★ RESTRICT, NOT CASCADE ★
--
-- Deleting the editor must not erase the record that they edited something. Cascade would mean
-- an account deletion silently rewrites history — removing exactly the evidence somebody would
-- be looking for. Matches forum_thread_grants.granted_by, which restricts for the same reason.
--
-- ★ ORPHANS FIRST ★
--
-- The constraint cannot be added while a row points at a missing user, and on a live database
-- there may be some. This deletes only revisions whose editor genuinely no longer exists: they
-- are unattributable, which is precisely what this migration exists to make impossible. Doing
-- it in the same transaction as the ALTER means either both happen or neither does.
DELETE FROM post_revisions pr
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = pr.edited_by);

ALTER TABLE "post_revisions"
  ADD CONSTRAINT "post_revisions_edited_by_fkey"
  FOREIGN KEY ("edited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
