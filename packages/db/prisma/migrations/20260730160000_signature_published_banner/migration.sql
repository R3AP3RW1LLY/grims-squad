-- A flat PNG of the built banner, for pasting into other forums as BBCode.
--
-- BBCode cannot describe a banner: [img] takes a URL and nothing else. So sharing off-site means
-- publishing a picture, and a picture cannot resolve "my rank" the way the live banner does --
-- a promotion updates the on-site banner and leaves the published copy stale until it is
-- published again. Inherent to the format, not a shortcut.
--
-- SET NULL rather than CASCADE, matching the other two image columns: deleting the upload leaves
-- the signature intact and merely un-published.
ALTER TABLE "forum_signatures" ADD COLUMN "banner_published_media_id" UUID;

ALTER TABLE "forum_signatures" ADD CONSTRAINT "forum_signatures_banner_published_media_id_fkey"
    FOREIGN KEY ("banner_published_media_id") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
