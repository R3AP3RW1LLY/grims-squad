/**
 * Which uploads are safe to delete.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "any of the signature images not used by the creator should be deleted when they have selected
 * and saved the signature they want to use."
 *
 * ★ THE RULE IS BIASED, ON PURPOSE ★
 *
 * Keeping an orphan costs a few hundred kilobytes. Deleting one that is still referenced breaks a
 * member's post, or their banner, in a way nothing can undo — the bytes are gone and the row that
 * pointed at them is left showing a hole.
 *
 * So every check here is over-inclusive: anything that even LOOKS referenced is kept, and the cost
 * of matching too eagerly is a file that survives one more sweep.
 *
 * ★ THE SUBSTRING SEARCH IS ONLY SAFE BECAUSE IDS ARE UUIDS ★
 *
 * A 36-character uuid cannot appear by accident inside a document. A shorter id could, and would —
 * the spec for this file first used single letters and 'c' matched inside the word "background".
 * That failure was in the safe direction, and it is exactly the assumption to keep in mind if the
 * id format ever changes.
 *
 * ★ AND A GRACE PERIOD ★
 *
 * An upload is written before the thing that references it. A member who uploads a banner and then
 * loses their connection before saving has an orphan that is about to stop being one. Anything
 * younger than the grace period is left alone regardless.
 */

/** How long an upload is left alone regardless of whether anything points at it. */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

export interface UploadRow {
  readonly id: string;
  readonly createdAt: Date;
}

/**
 * What might still be pointing at an upload.
 *
 * Deliberately typed as opaque text rather than parsed structures: the signature spec nests media
 * ids inside layers, and a rich document nests them inside nodes. Searching the serialised form
 * catches every shape without this file having to know any of them — including shapes added later.
 */
export interface References {
  /** Media ids named directly by a column: signature avatar, banner, published snapshot. */
  readonly columnIds: ReadonlySet<string>;
  /** Serialised documents and specs that may mention an id anywhere inside them. */
  readonly documents: readonly string[];
}

/**
 * Splits uploads into what may be deleted and what must be kept.
 *
 * Pure, because this is the decision that destroys data. A rule that can only be exercised through
 * a database and an object store is a rule nobody exercises — and the failure mode is silent until
 * a member notices a picture missing from a post they wrote last year.
 */
export function orphansOf(
  uploads: readonly UploadRow[],
  refs: References,
  now: Date = new Date(),
): UploadRow[] {
  // One pass over the documents per upload would be O(n·m) with a substring search each time. The
  // ids are uuids, so collecting the ones that appear anywhere is a single scan.
  const mentioned = new Set<string>();
  for (const upload of uploads) {
    if (refs.documents.some((d) => d.includes(upload.id))) mentioned.add(upload.id);
  }

  return uploads.filter((u) => {
    if (now.getTime() - u.createdAt.getTime() < ORPHAN_GRACE_MS) return false;
    if (refs.columnIds.has(u.id)) return false;
    if (mentioned.has(u.id)) return false;
    return true;
  });
}
