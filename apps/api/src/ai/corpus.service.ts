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
