-- Forum signatures — the block under a member's posts.
--
-- ★ THE AVATAR HERE IS NOT THE AVATAR ON `users` ★
--
-- Squadron owner, 2026-07-30: the signature avatar "should only be displayed on the forums and not
-- replace their global avatar that discord imports". So this is a separate column and nothing in
-- this feature writes `users.avatar_stored_hash`. Overwriting it would have been silently undone by
-- the next Discord sync, and a member would watch their picture change on its own.
--
-- ★ user_id IS THE PRIMARY KEY ★
--
-- A member has one signature or none. A surrogate id with a unique index can physically hold two
-- rows for one member, which eventually it does.
CREATE TABLE "forum_signatures" (
    "user_id" UUID NOT NULL,
    "avatar_media_id" UUID,
    "tagline" TEXT,
    "banner_media_id" UUID,
    -- Validated against a HOST ALLOWLIST before it gets here — see the contract. A signature is
    -- rendered under every post a member has ever written, so an arbitrary URL is advertising
    -- space with retroactive reach.
    "banner_url" TEXT,
    "banner_label" TEXT,
    "accent" TEXT NOT NULL DEFAULT 'orange',
    "show_rank" BOOLEAN NOT NULL DEFAULT true,
    "show_commander" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "forum_signatures_pkey" PRIMARY KEY ("user_id")
);

-- CASCADE from the member: a departed account takes its signature with it.
ALTER TABLE "forum_signatures" ADD CONSTRAINT "forum_signatures_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL from the images: deleting an upload leaves the signature intact and merely
-- picture-less, rather than deleting the member's whole block along with one file.
ALTER TABLE "forum_signatures" ADD CONSTRAINT "forum_signatures_avatar_media_id_fkey"
    FOREIGN KEY ("avatar_media_id") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "forum_signatures" ADD CONSTRAINT "forum_signatures_banner_media_id_fkey"
    FOREIGN KEY ("banner_media_id") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
