import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppError, ErrorCode } from '@grims/shared';
import { notifyMembers, PrismaClient } from '@grims/db';
import { AclDbService } from '../authz/acl-db.service.js';
import { PermissionService } from '../authz/permission.service.js';
import { ThreadService } from '../forum/thread.service.js';
import { LIVE_SERVICE } from '../live/live.tokens.js';
import { liveNudgeOf } from '../live/live-nudge.js';
import type { LiveService } from '../live/live.service.js';
import {
  FEATURE_REQUESTS_SLUG,
  cleanSuggestionBody,
  openingPostFor,
  reviewProblem,
  titleFrom,
  type SuggestionStatus,
} from './suggestion-box.js';

/**
 * The suggestion box — members' ideas on their way to the webmaster, and what becomes of them.
 *
 * ★ THE PLAIN CLIENT ON `suggestions`, AND WHY THAT IS CORRECT (INV-002) ★
 *
 * The table carries no ACL column and is not in ACL_MODELS — like `notifications` and the
 * support tables, its visibility is an OWNERSHIP question answered HERE in every read: a
 * member's reads are scoped `userId = caller` in the query itself, and the inbox door is gated
 * on SITE_CONFIG before it reaches this class.
 *
 * ★ PUBLISHING GOES THROUGH ThreadService, AS THE WEBMASTER, DELIBERATELY ★
 *
 * The forum-cc doctrine: a published suggestion must be a REAL thread — same sanitiser, same
 * screening, same ACL — indistinguishable from one the webmaster typed into the board. So the
 * publish path acts through the webmaster's own bound client and mask, and "the webmaster
 * cannot post there" surfaces as the same refusal a browser would get. The sender is credited
 * IN the opening post by display name rather than made the thread's author — which is also
 * what keeps the vote rail open to them, since nobody may vote on their own post.
 */

export interface SuggestionMineView {
  readonly id: string;
  readonly body: string;
  readonly status: SuggestionStatus;
  readonly createdAt: Date;
  /** Where it went when it was published, ready for an <a href>. Null until then — and null
   *  if the thread has since been removed by moderation. */
  readonly threadLink: string | null;
}

export interface SuggestionInboxRow {
  readonly id: string;
  readonly body: string;
  readonly sender: { readonly id: string; readonly displayName: string };
  readonly createdAt: Date;
}

@Injectable()
export class SuggestionsService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(AclDbService) private readonly acl: AclDbService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ThreadService) private readonly threads: ThreadService,
    // Optional, like every other consumer: a missing live service costs a badge refresh, never
    // a notification row — and the specs construct this service without one.
    @Optional() @Inject(LIVE_SERVICE) private readonly live: LiveService | null = null,
  ) {}

  // ── The member door ────────────────────────────────────────────────────────

  /** A member sends an idea. The sender is the SESSION's user, never a parameter. */
  async submit(userId: string, bodyRaw: unknown): Promise<{ id: string }> {
    const cleaned = cleanSuggestionBody(bodyRaw);
    if ('problem' in cleaned) throw new AppError(ErrorCode.VALIDATION_FAILED, cleaned.problem);

    return this.db.suggestion.create({
      data: { userId, body: cleaned.body },
      select: { id: true },
    });
  }

  /** The member's own suggestions, newest first, with a link to any that made the board. */
  async listMine(userId: string): Promise<SuggestionMineView[]> {
    const rows = await this.db.suggestion.findMany({
      // Scoped by OWNER in the query itself — the support-desk rule.
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, body: true, status: true, createdAt: true, publishedThreadId: true },
    });

    /*
     * Thread links resolve through the MEMBER'S OWN bound client, so a published thread the
     * caller cannot see (or one moderation has since removed) yields a status with no link
     * rather than an address that 404s — the honest degradation.
     */
    const threadIds = rows
      .map((r) => r.publishedThreadId)
      .filter((id): id is string => id !== null);
    const links = new Map<string, string>();
    if (threadIds.length > 0) {
      const db = await this.acl.forCaller(userId);
      const threads = await db.forumThread.findMany({
        where: { id: { in: threadIds }, deletedAt: null },
        select: { id: true, slug: true, category: { select: { slug: true } } },
      });
      for (const t of threads) links.set(t.id, `/forum/${t.category.slug}/${t.slug}`);
    }

    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      status: r.status,
      createdAt: r.createdAt,
      threadLink: r.publishedThreadId === null ? null : (links.get(r.publishedThreadId) ?? null),
    }));
  }

  // ── The webmaster's inbox ──────────────────────────────────────────────────
  //
  // Every method below is reached only through the inbox controller, gated on SITE_CONFIG at
  // the class — the support-console shape, one tier up.

  /** New suggestions, oldest first: a queue is worked in arrival order. */
  async inbox(): Promise<SuggestionInboxRow[]> {
    const rows = await this.db.suggestion.findMany({
      where: { status: 'new' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        body: true,
        createdAt: true,
        user: { select: { id: true, displayName: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      sender: { id: r.user.id, displayName: r.user.displayName },
      createdAt: r.createdAt,
    }));
  }

  /**
   * One click: the suggestion becomes a Feature Requests thread, credited to its sender.
   *
   * Returns where the thread lives, and whether screening HELD its opening post — a held
   * publish must not ring the sender's bell, because the link would land them on an empty page
   * (the forum-cc doctrine, applied to a person instead of a squadron).
   */
  async publish(
    webmasterId: string,
    suggestionId: string,
  ): Promise<{ threadLink: string; held: boolean }> {
    const suggestion = await this.#byId(suggestionId);
    this.#assertReviewable(suggestion.status, 'publish');

    /*
     * Everything below acts AS the webmaster, through their own bound client and mask — what
     * makes the thread indistinguishable from one they typed, and what makes "cannot post
     * there" the same refusal a browser would get.
     */
    const db = await this.acl.forCaller(webmasterId);
    const mask = await this.permissions.effectiveMask(webmasterId);

    const category = await db.forumCategory.findFirst({
      // By slug, the forum-cc shape. Never invented here: the board is seeded by migration,
      // and a board appearing on everyone's forum must be a decision, not a side effect.
      where: {
        OR: [
          { slug: { equals: FEATURE_REQUESTS_SLUG, mode: 'insensitive' } },
          { name: { equals: 'feature requests', mode: 'insensitive' } },
        ],
      },
      select: { id: true, slug: true },
    });
    if (category === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        "There is no Feature Requests board to publish into. Run the migrations — the board is seeded by one, never invented here.",
      );
    }

    const senderName = suggestion.user.displayName;
    const thread = await this.threads.create(
      db,
      {
        categoryId: category.id,
        title: titleFrom(suggestion.body, senderName),
        body: openingPostFor(suggestion.body, senderName),
      },
      webmasterId,
      mask,
    );

    /*
     * ★ CLAIMED CONDITIONALLY, AFTER THE THREAD EXISTS ★
     *
     * Stamped on `status = 'new'`, so two webmasters racing the same row resolve to one
     * winner: the loser is told the screen was stale rather than silently double-publishing.
     * The loser's thread is already created by then — the cost of that rare race is one
     * duplicate thread for a moderator to remove, which beats the other order's failure mode
     * (a suggestion marked published whose thread never landed, unfixable from the console).
     */
    const claimed = await this.db.suggestion.updateMany({
      where: { id: suggestion.id, status: 'new' },
      data: {
        status: 'published',
        reviewedAt: new Date(),
        reviewedById: webmasterId,
        publishedThreadId: thread.id,
      },
    });
    if (claimed.count === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'A colleague reviewed this suggestion while you were reading it. Refresh the inbox — and check the board for a duplicate thread.',
      );
    }

    const threadLink = `/forum/${category.slug}/${thread.slug}`;

    if (!thread.held) {
      /*
       * The personal bell — "notify the suggester personally". Failure is swallowed inside
       * notifyMembers: the thread landed, and a bell must not un-succeed it.
       */
      await notifyMembers(
        this.db,
        [suggestion.user.id],
        {
          kind: 'suggestion.published',
          title: 'Your suggestion is on the board',
          body: `"${preview(suggestion.body)}" is now a Feature Requests thread, credited to you. The squadron votes on it there.`,
          link: threadLink,
        },
        liveNudgeOf(this.live),
      );
    }

    return { threadLink, held: thread.held };
  }

  /** The other exit: reviewed, not taken up, and the sender told so plainly. */
  async decline(webmasterId: string, suggestionId: string): Promise<void> {
    const suggestion = await this.#byId(suggestionId);
    this.#assertReviewable(suggestion.status, 'decline');

    // Conditional for the same racing-colleagues reason as publish — one review, one bell.
    const claimed = await this.db.suggestion.updateMany({
      where: { id: suggestion.id, status: 'new' },
      data: { status: 'declined', reviewedAt: new Date(), reviewedById: webmasterId },
    });
    if (claimed.count === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'A colleague reviewed this suggestion while you were reading it. Refresh the inbox.',
      );
    }

    /*
     * Told personally, and honestly: read by a person, not taken up, box still open. No reason
     * field — a one-click decline with a mandatory essay becomes a queue nobody clears, and a
     * TEMPLATED reason is worse than none.
     */
    await notifyMembers(
      this.db,
      [suggestion.user.id],
      {
        kind: 'suggestion.declined',
        title: 'Your suggestion will not be taken up',
        body: `The webmaster read "${preview(suggestion.body)}" and is not taking it forward. The box stays open — send the next one.`,
      },
      liveNudgeOf(this.live),
    );
  }

  // ── Shared internals ───────────────────────────────────────────────────────

  async #byId(id: string): Promise<{
    id: string;
    status: SuggestionStatus;
    body: string;
    user: { id: string; displayName: string };
  }> {
    const row = await this.db.suggestion.findFirst({
      where: { id },
      select: {
        id: true,
        status: true,
        body: true,
        user: { select: { id: true, displayName: true } },
      },
    });
    if (row === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That suggestion is not available.');
    }
    return row;
  }

  #assertReviewable(status: SuggestionStatus, action: 'publish' | 'decline'): void {
    const problem = reviewProblem(status, action);
    if (problem !== null) throw new AppError(ErrorCode.VALIDATION_FAILED, problem);
  }
}

const PREVIEW_CHARS = 80;

/** The suggestion's opening words, for a bell row that has to fit on one line. */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}
