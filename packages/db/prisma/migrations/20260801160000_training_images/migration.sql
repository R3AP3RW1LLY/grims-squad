-- Help Train the Bot: member-submitted screenshots for the image models (P2).
--
-- ★ SQUADRON OWNER, 2026-08-01 ★
--
-- "a new side bar category called GMSD AI ... name it Help Train the Bot ... a category based
-- uploader, a material progression bar that shows how many images are required in the pool to
-- properly train that category ... each image should have a slot for text description."
--
-- Hand-written, like every migration here: `prisma migrate dev` proposes dropping the pgvector
-- HNSW index, the cube GiST indexes and the generated tsvector on every diff.

-- ★ A SEPARATE ROW FROM THE UPLOAD, NOT A FLAG ON IT ★
--
-- An upload is a FILE. This is an OFFER, and it carries what a file does not: which concept it is
-- meant to teach, what the member says is in it, whether an officer accepted it, and whether the
-- member has since changed their mind. Withdrawing consent deletes THIS row and leaves their image
-- exactly where it was.
CREATE TABLE "training_images" (
  "id"          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "upload_id"   UUID        NOT NULL REFERENCES "media_uploads"("id") ON DELETE CASCADE,
  "user_id"     UUID        NOT NULL REFERENCES "users"("id")         ON DELETE CASCADE,

  -- A key of TRAINING_CATEGORIES. A LoRA is trained per concept; a category somebody invented is
  -- an image that will never be part of any training run.
  "category"    TEXT        NOT NULL,

  -- The entire value of the upload. A thousand unlabelled screenshots teach a model nothing; a
  -- hundred labelled "Krait Mk II, exterior, docked at an orbis starport" teach it to draw a Krait.
  "description" TEXT        NOT NULL,

  -- Usually DERIVED from the member's journal around the upload time rather than asked. Null is
  -- honest; a guess would teach the model that a Python is a Krait.
  "ship_type"   TEXT,
  "notes"       TEXT,

  "state"       TEXT        NOT NULL DEFAULT 'pending',

  -- Shown to the member. A rejection with no reason teaches them nothing and they submit the same
  -- thing again.
  "review_note" TEXT,
  "reviewed_by" UUID        REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" TIMESTAMPTZ,

  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "training_images_state_check"
    CHECK ("state" IN ('pending', 'approved', 'rejected', 'withdrawn')),

  -- One offer per image. Submitting the same upload twice is a mistake, not two contributions —
  -- and without this it would count twice towards a category's progress bar.
  CONSTRAINT "training_images_upload_key" UNIQUE ("upload_id")
);

-- The progress bars: how many approved and pending per category. The only query the page makes on
-- every load, so it is the one that must not scan.
CREATE INDEX "training_images_category_idx" ON "training_images" ("category", "state");

-- "What have I submitted", newest first.
CREATE INDEX "training_images_user_idx" ON "training_images" ("user_id", "created_at" DESC);

-- The review queue: everything waiting, oldest first. Partial, because reviewed rows are the vast
-- majority within a week and none of them belong in a queue.
CREATE INDEX "training_images_queue_idx"
  ON "training_images" ("created_at")
  WHERE "state" = 'pending';
