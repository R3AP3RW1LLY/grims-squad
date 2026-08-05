import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import {
  AppError,
  ErrorCode,
  Permission,
  TRAINING_CATEGORIES,
  trainingCategory,
  categoryProgress,
  MIN_DESCRIPTION_CHARS,
  MAX_DESCRIPTION_CHARS,
  MIN_TRAINING_EDGE,
  TRAINING_IMAGE_TYPES,
  SHIP_INFERENCE_WINDOW_MS,
  type CategoryProgress,
} from '@grims/shared';

/**
 * Help Train the Bot — members offering screenshots for the image models.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "a category based uploader, a material progression bar that shows how many images are required in
 * the pool to properly train that category and what were at in collecting those images."
 *
 * ★ THE UPLOAD ALREADY HAPPENED ★
 *
 * This service never touches bytes. The image goes through the existing media pipeline — quota,
 * decode, re-encode, storage — which is where the hardening lives, and building a second upload
 * path for training would mean a second place to get that wrong. What arrives here is an upload id
 * and an OFFER to train on it.
 */

/** One of the member's own submissions, as shown back to them. */
export interface SubmissionView {
  readonly id: string;
  readonly uploadId: string;
  readonly category: string;
  readonly description: string;
  readonly state: string;
  readonly reviewNote: string | null;
  readonly createdAt: string;
}

/**
 * One submission as a REVIEWER sees it.
 *
 * Everything the member wrote, plus who they are — a caption is judged partly on whether it
 * describes the picture, and knowing whose it is matters when the same person keeps sending the
 * same thing. `shipType` and `notes` are here because they are appended to the caption at training
 * time, so a reviewer approving the row is approving those too.
 */
export interface QueuedSubmission {
  readonly id: string;
  readonly uploadId: string;
  readonly category: string;
  readonly description: string;
  readonly shipType: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly submittedBy: {
    readonly handle: string;
    readonly displayName: string;
    readonly cmdrName: string | null;
  };
}

/** What a reviewer decided. `withdrawn` is the member's word and is never a reviewer's. */
export type ReviewDecision = 'approved' | 'rejected';

@Injectable()
export class CorpusService {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  /**
   * Where every category stands.
   *
   * ★ ONE GROUPED QUERY, NOT ONE PER CATEGORY ★
   *
   * Seven categories rendered together. Seven round trips to draw one page is the kind of thing
   * that is invisible on localhost and obvious over a transatlantic link.
   */
  async progress(): Promise<CategoryProgress[]> {
    const rows = await this.db.trainingImage.groupBy({
      by: ['category', 'state'],
      _count: { _all: true },
    });

    const counts = new Map<string, { approved: number; pending: number }>();
    for (const c of TRAINING_CATEGORIES) counts.set(c.key, { approved: 0, pending: 0 });

    for (const r of rows) {
      const bucket = counts.get(r.category);
      // A row whose category is no longer in the contract is ignored rather than crashing the
      // page — categories can be retired, and their old images should not take the panel down.
      if (bucket === undefined) continue;
      if (r.state === 'approved') bucket.approved += r._count._all;
      else if (r.state === 'pending') bucket.pending += r._count._all;
    }

    return TRAINING_CATEGORIES.map(
      (c) => categoryProgress(c.key, counts.get(c.key) ?? { approved: 0, pending: 0 }) as CategoryProgress,
    );
  }

  /**
   * Offers an already-uploaded image for training.
   *
   * ★ EVERY CHECK HERE IS ABOUT NOT WASTING SOMEBODY'S TIME ★
   *
   * An image accepted now and silently dropped at training time is worse than a refusal: the member
   * believes they contributed, the bar shows progress that is not real, and nobody finds out until a
   * training run comes up short.
   */
  async submit(
    userId: string,
    mask: bigint,
    input: {
      uploadId: string;
      category: string;
      description: string;
      notes?: string;
      shipType?: string;
    },
  ): Promise<{ id: string }> {
    if ((mask & Permission.AI_TRAIN_SUBMIT) !== Permission.AI_TRAIN_SUBMIT) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Your role cannot submit training images at the moment.',
      );
    }

    const category = trainingCategory(input.category);
    if (category === null) {
      // Not free text. A category somebody invented is an image no training run will ever read.
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Pick one of the listed categories.');
    }

    const description = input.description.trim();
    if (description.length < MIN_DESCRIPTION_CHARS) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Describe what is in the shot — at least ${MIN_DESCRIPTION_CHARS} characters. ` +
          `"Krait Mk II, exterior, docked at an orbis starport" is the kind of thing that helps.`,
      );
    }
    if (description.length > MAX_DESCRIPTION_CHARS) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Keep the description under ${MAX_DESCRIPTION_CHARS} characters.`,
      );
    }

    /*
     * The upload must be THEIRS.
     *
     * Without this check a member could offer somebody else's image — and the consent model says
     * training use is the uploader's decision to make. Scoped in the WHERE rather than checked
     * afterwards, so a missing row and a row belonging to somebody else answer identically
     * (INV-024).
     */
    const upload = await this.db.mediaUpload.findFirst({
      where: { id: input.uploadId, uploaderId: userId },
      select: { id: true, width: true, height: true, contentType: true, createdAt: true },
    });
    if (upload === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That image is not available.');
    }

    /*
     * ★ FORMAT AND SIZE, REFUSED HERE RATHER THAN AT TRAINING TIME ★
     *
     * The media pipeline stores GIF quite happily. Training does not want it: an animated frame
     * grab is low-resolution and palette-limited, and it teaches the model compression artefacts.
     * Likewise anything under MIN_TRAINING_EDGE — below that the detail that makes a hull
     * recognisable is simply not in the file.
     */
    if (!(TRAINING_IMAGE_TYPES as readonly string[]).includes(upload.contentType)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Training images need to be PNG, JPEG or WebP.',
      );
    }
    if (Math.max(upload.width, upload.height) < MIN_TRAINING_EDGE) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `That shot is ${upload.width}×${upload.height}. Training needs at least ${MIN_TRAINING_EDGE}px ` +
          `on the long edge — below that the detail simply is not in the file.`,
      );
    }

    const existing = await this.db.trainingImage.findUnique({
      where: { uploadId: upload.id },
      select: { id: true },
    });
    if (existing !== null) {
      // Counted twice, it would inflate a progress bar that officers plan training runs against.
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'You have already offered that image.');
    }

    const row = await this.db.trainingImage.create({
      data: {
        uploadId: upload.id,
        userId,
        category: category.key,
        description,
        ...(input.notes === undefined || input.notes.trim() === ''
          ? {}
          : { notes: input.notes.trim().slice(0, MAX_DESCRIPTION_CHARS) }),
        /*
         * ★ WHAT THEY TYPED WINS; THE JOURNAL FILLS THE GAP ★
         *
         * The original design derived this and never asked — members will not RELIABLY tell us, and
         * a wrong label is worse than none because it teaches the model that a Python is a Krait.
         * That reasoning holds for a field nobody filled in. It does not hold for one somebody
         * deliberately typed: they are looking at their own screenshot, and the journal cannot see
         * a shot taken from a friend's cockpit, in a replay, or of a ship parked next to theirs.
         *
         * So the member's answer is taken when there is one, and the journal answers when there is
         * not. Neither is invented — the field stays null when nothing knows.
         */
        ...(input.shipType !== undefined && input.shipType.trim() !== ''
          ? { shipType: input.shipType.trim().slice(0, 120) }
          : await this.#shipAt(userId, upload.createdAt)),
      },
      select: { id: true },
    });

    return { id: row.id };
  }

  /** The member's own submissions, newest first. */
  async mine(userId: string, limit = 50): Promise<SubmissionView[]> {
    const rows = await this.db.trainingImage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        uploadId: true,
        category: true,
        description: true,
        state: true,
        reviewNote: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      uploadId: r.uploadId,
      category: r.category,
      description: r.description,
      state: r.state,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * A member changing their mind.
   *
   * ★ WITHDRAWAL IS ALWAYS AVAILABLE AND NEVER NEEDS A REASON ★
   *
   * It removes the image from FUTURE training. It cannot remove it from a model already trained —
   * that is how weights work, not a policy choice, and CONSENT_WITHDRAWAL_NOTE says so at the
   * moment somebody opts in rather than leaving them to discover it here.
   */
  async withdraw(userId: string, id: string): Promise<void> {
    const updated = await this.db.trainingImage.updateMany({
      where: { id, userId },
      data: { state: 'withdrawn' },
    });
    if (updated.count === 0) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That submission is not available.');
    }
  }

  /**
   * Everything waiting to be reviewed, oldest first.
   *
   * ★ THE HALF OF THIS FEATURE THAT WAS NEVER BUILT ★
   *
   * Squadron owner, 2026-07-30: "webmaster + AI_TRAINING holders approve". The permission was
   * written, the schema carries `state`, `reviewNote`, `reviewedBy` and `reviewedAt`, and
   * `@@index([state, createdAt])` is commented "the review queue: everything waiting, oldest
   * first". Every part of the design existed except a way to open it.
   *
   * So members submitted, the uploader told them an officer would look, and the images sat in
   * `pending` with no surface anywhere on the platform that could list them. Reported by the
   * squadron owner on 2026-08-05: "i can not find it at all and we need this working! ... we have
   * images waiting to be approved".
   *
   * ★ OLDEST FIRST, AND WHY THAT IS NOT ARBITRARY ★
   *
   * A newest-first queue starves the bottom: on any day the reviewer does not reach the end, the
   * same old submissions are the ones skipped, and a member who offered something on a busy day
   * waits forever while later ones go through. Oldest first means the wait is bounded by the
   * queue, not by luck.
   */
  async queue(limit = 100): Promise<QueuedSubmission[]> {
    const rows = await this.db.trainingImage.findMany({
      where: { state: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        uploadId: true,
        category: true,
        description: true,
        shipType: true,
        notes: true,
        createdAt: true,
        user: {
          select: {
            handle: true,
            displayName: true,
            /*
             * The proven commander name, when there is one. Officers know each other by CMDR name
             * far more than by handle, and a queue that identified people by a URL slug would make
             * "who keeps sending these" a lookup rather than a glance.
             */
            cmdrVerifications: {
              where: { isVerified: true, revokedAt: null },
              orderBy: { verifiedAt: 'desc' },
              take: 1,
              select: { cmdrName: true },
            },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      uploadId: r.uploadId,
      category: r.category,
      description: r.description,
      shipType: r.shipType,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      submittedBy: {
        handle: r.user.handle,
        displayName: r.user.displayName,
        cmdrName: r.user.cmdrVerifications[0]?.cmdrName ?? null,
      },
    }));
  }

  /** How many are waiting. The number on the console tab, and nothing else. */
  async waiting(): Promise<number> {
    return this.db.trainingImage.count({ where: { state: 'pending' } });
  }

  /**
   * A reviewer's decision.
   *
   * ★ A REJECTION WITHOUT A REASON TEACHES NOBODY ANYTHING ★
   *
   * The schema says so in its own comment on `reviewNote`: "Why an officer refused it. Shown to
   * the member, because a rejection with no reason teaches them nothing and they will submit the
   * same thing again." So a rejection REQUIRES a note, and the requirement lives here rather than
   * only in the form — a form is one caller, and the rule is about the data.
   *
   * An approval may carry a note and usually will not. There is nothing to explain about yes.
   *
   * ★ ONLY PENDING ROWS MOVE ★
   *
   * The `state: 'pending'` in the filter is the whole concurrency story. Two officers opening the
   * queue together both see the same image; whoever decides first wins, and the second gets
   * "already reviewed" instead of silently overwriting a colleague's judgement. It also stops a
   * decision landing on something the member withdrew while the tab was open — withdrawal is
   * theirs and a reviewer must not undo it.
   */
  async review(
    reviewerId: string,
    id: string,
    decision: ReviewDecision,
    note: string | null,
  ): Promise<void> {
    const trimmed = (note ?? '').trim();

    if (decision === 'rejected' && trimmed === '') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Say why it was refused — the member is shown this, and without it they will send the same image again.',
      );
    }

    const updated = await this.db.trainingImage.updateMany({
      where: { id, state: 'pending' },
      data: {
        state: decision,
        reviewNote: trimmed === '' ? null : trimmed.slice(0, MAX_DESCRIPTION_CHARS),
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_VISIBLE,
        'That submission is no longer waiting — somebody reviewed it, or the member withdrew it.',
      );
    }
  }

  /**
   * What a ship the member was flying when the screenshot was taken, if we can tell.
   *
   * Returns an empty object rather than a null field, because `exactOptionalPropertyTypes` means
   * an absent property and a property set to undefined are different things to Prisma.
   */
  async #shipAt(userId: string, at: Date): Promise<{ shipType?: string }> {
    const event = await this.db.telemetryEvent.findFirst({
      where: {
        userId,
        eventType: { in: ['Loadout', 'LoadGame'] },
        occurredAt: {
          gte: new Date(at.getTime() - SHIP_INFERENCE_WINDOW_MS),
          lte: new Date(at.getTime() + SHIP_INFERENCE_WINDOW_MS),
        },
      },
      orderBy: { occurredAt: 'desc' },
      select: { payload: true },
    });

    const ship = (event?.payload as Record<string, unknown> | undefined)?.['Ship'];
    return typeof ship === 'string' && ship !== '' ? { shipType: ship } : {};
  }
}
