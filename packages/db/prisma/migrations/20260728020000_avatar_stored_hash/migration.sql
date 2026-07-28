-- Which avatar we have actually copied into object storage.
--
-- Distinct from avatar_url (which, despite the name, holds Discord's avatar
-- HASH as last seen at sign-in). They differ between a member changing their
-- picture and our copy of it landing — conflating them would mean serving a
-- 404 for the duration of that gap, on every page showing that member.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_stored_hash" TEXT;
