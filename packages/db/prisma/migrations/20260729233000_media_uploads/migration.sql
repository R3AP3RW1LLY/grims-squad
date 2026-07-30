-- Images a member uploaded, after hardening.
--
-- Squadron owner, 2026-07-29: image uploads pulled forward so the joining guides can carry real
-- screenshots instead of placeholder text.
--
-- ★ EVERY ROW DESCRIBES A FILE WE ENCODED, NOT ONE THAT ARRIVED ★
--
-- The upload is decoded to pixels and re-encoded (image-hardening.ts), so content_type, width,
-- height and bytes all describe OUR output. There is deliberately no column for the original
-- filename or the declared content type: both are attacker-controlled strings, neither is needed
-- to serve the image, and storing them invites a later feature to trust them.
--
-- ★ THE ID IS THE URL ★
--
-- id appears directly in /v1/media/uploads/<id>, which the sanitiser validates against a strict
-- pattern before allowing an <img> to reference it. A UUID satisfies that pattern and is
-- unguessable — which matters because these are served to anybody who can read the post.
--
-- ★ ACCESS IS NOT INHERITED FROM THE UPLOADER ★
--
-- uploader_id is for attribution and a future quota. It does NOT gate reading: an image in a
-- public guide must be readable by anonymous visitors, and one in an officers' thread is
-- protected by that thread. Tying visibility to the uploader would make a guide's screenshots
-- vanish the day its author left the squadron.
CREATE TABLE "media_uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uploader_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "media_uploads_pkey" PRIMARY KEY ("id")
);

-- One row per object. A duplicate key would mean two rows believing they own the same file, and
-- deleting either would break the other.
CREATE UNIQUE INDEX "media_uploads_storage_key_key" ON "media_uploads"("storage_key");

-- "What has this member uploaded, newest first" — the quota and moderation query.
CREATE INDEX "media_uploads_uploader_id_created_at_idx" ON "media_uploads"("uploader_id", "created_at");

-- CASCADE: a deleted account takes its uploads' ROWS with it. The objects are removed by the
-- account-deletion path, which is the only thing that can talk to object storage — a foreign key
-- cannot reach a bucket, and pretending otherwise would leave orphaned files nobody counts.
ALTER TABLE "media_uploads"
  ADD CONSTRAINT "media_uploads_uploader_id_fkey"
  FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
