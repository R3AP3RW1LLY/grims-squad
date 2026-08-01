-- Grouping AI calls into conversations.
--
-- ★ WHY A COLUMN AND NOT A TABLE ★
--
-- The owner's requirement is that every conversation is logged for officer review, and visible to
-- the webmaster. `ai_calls` already records each exchange with the member, the prompt, the reply
-- and the time — everything except which exchanges belong together.
--
-- Without that, a review screen can only group by member and guess at gaps, which gets it wrong in
-- exactly the case somebody is reviewing: a member who asked about two different things in the same
-- ten minutes reads as one incoherent conversation, and a member who came back an hour later to
-- finish a thought reads as two.
--
-- A separate conversations table would add a row that carries nothing the first message does not
-- already imply, plus a join on the hottest read of the review screen. The id is minted by the
-- client on the first message of a thread and echoed back on the rest.
--
-- Nullable, because the other two kinds have no conversation to belong to. A screening call is one
-- post judged once; a signature generation is one request. Only `assistant` threads.
ALTER TABLE "ai_calls" ADD COLUMN "thread_id" UUID;

-- The review screen's only access pattern: pull one conversation in order.
--
-- Partial, because the great majority of rows are screening calls that will never carry a thread —
-- indexing their NULLs would roughly double the index to answer nothing.
CREATE INDEX "ai_calls_thread_idx"
  ON "ai_calls" ("thread_id", "created_at")
  WHERE "thread_id" IS NOT NULL;
