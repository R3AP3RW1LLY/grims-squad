import { PrismaClient } from '@grims/db';
import { ORPHAN_GRACE_MS, orphansOf, type UploadRow } from '@grims/shared';

/**
 * Deleting uploads nothing points at any more.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "any of the signature images not used by the creator should be deleted when they have selected
 * and saved the signature they want to use."
 *
 * ★ WHY A SWEEP AND NOT A DELETE ON SAVE ★
 *
 * Deleting at save time only catches the images that were orphaned BY that save. It misses the ones
 * orphaned by a save that failed half way, by a member who closed the tab, by a banner replaced
 * from the manual builder, and by every path added later that forgets to call the cleanup.
 *
 * A sweep asks the only question that matters — "is anything pointing at this?" — and answers it the
 * same way regardless of how the file was orphaned. It is also idempotent, so running it twice is
 * harmless and running it after an incident is a repair rather than a risk.
 *
 * ★ THE DESIGNER ALREADY AVOIDS MOST OF THIS ★
 *
 * Worth saying plainly: the AI designer previews its five backplates from memory and uploads only
 * the one the member chooses. Four of five never become files at all. What this collects is the
 * genuinely orphaned remainder — a member who picked twice, replaced a banner, or abandoned an
 * upload.
 *
 *   node apps/worker/dist/sweep-orphan-media.js         delete
 *   node apps/worker/dist/sweep-orphan-media.js --dry   report only
 */

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const db = new PrismaClient();

  try {
    /*
     * Only uploads old enough to be candidates are read. The grace period exists because an upload
     * is written BEFORE the row that references it, so a member mid-save always has one that looks
     * orphaned and is not.
     */
    const uploads: UploadRow[] = await db.mediaUpload.findMany({
      where: { createdAt: { lt: new Date(Date.now() - ORPHAN_GRACE_MS) } },
      select: { id: true, createdAt: true },
    });

    if (uploads.length === 0) {
      console.log('media sweep: nothing old enough to consider');
      return;
    }

    const signatures = await db.forumSignature.findMany({
      select: {
        avatarMediaId: true,
        bannerMediaId: true,
        bannerPublishedMediaId: true,
        bannerSpec: true,
      },
    });

    const columnIds = new Set<string>();
    for (const s of signatures) {
      for (const id of [s.avatarMediaId, s.bannerMediaId, s.bannerPublishedMediaId]) {
        if (id !== null) columnIds.add(id);
      }
    }

    /*
     * ★ EVERY DOCUMENT THAT COULD MENTION AN ID, AS TEXT ★
     *
     * Banner specs nest ids inside layers; rich documents nest them inside nodes. Searching the
     * serialised form catches every shape without this job knowing any of them — including shapes
     * added after it was written, which is the failure a structured walk would have.
     *
     * `bodyHtml` as well as `bodyDoc`: the rendered form carries the media URL, and a post whose
     * doc failed to store correctly must not lose its picture as a result.
     */
    const posts = await db.forumPost.findMany({ select: { bodyDoc: true, bodyHtml: true } });
    const training = await db.trainingImage.findMany({ select: { uploadId: true } });
    for (const t of training) columnIds.add(t.uploadId);

    const documents = [
      ...signatures.map((s) => JSON.stringify(s.bannerSpec ?? '')),
      ...posts.flatMap((p) => [JSON.stringify(p.bodyDoc ?? ''), p.bodyHtml ?? '']),
    ];

    const orphans = orphansOf(uploads, { columnIds, documents });

    console.log(
      `media sweep: ${orphans.length} orphan(s) of ${uploads.length} considered` +
        `${dry ? ' (dry run, nothing deleted)' : ''}`,
    );

    if (dry || orphans.length === 0) return;

    /*
     * ★ THE ROW GOES, THE OBJECT IS LEFT ★
     *
     * Deleting the database row is what makes the file unreachable and reclaims the member's quota.
     * The object itself is not removed here because this job has no object-store credentials — and
     * giving a cron job the ability to delete from the bucket, to save a few hundred kilobytes, is
     * a much larger decision than the tidying it is doing.
     *
     * The bucket is swept separately against the rows that remain. Orphaned BYTES are cheap;
     * orphaned REFERENCES are what break pages.
     */
    const { count } = await db.mediaUpload.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
    console.log(`media sweep: ${count} upload row(s) removed`);
  } finally {
    await db.$disconnect();
  }
}

await main();
