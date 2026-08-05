import { Inject, Injectable } from '@nestjs/common';
import { AppError, ErrorCode } from '@grims/shared';
import { PrismaClient } from '@grims/db';
import { AclDbService } from '../authz/acl-db.service.js';
import { FEATURE_REQUESTS_SLUG } from '../suggestions/suggestion-box.js';
import {
  cleanCardBody,
  cleanCardTitle,
  clampPosition,
  isRoadmapColumn,
  placeInOrder,
  type RoadmapColumn,
} from './roadmap-board.js';

/**
 * The roadmap — the webmaster's kanban, and the squadron's read-only view of it.
 *
 * ★ THE PLAIN CLIENT ON `roadmap_cards`, AND WHY THAT IS CORRECT (INV-002) ★
 *
 * The table carries no ACL column and is not in ACL_MODELS: every card is either
 * member-readable (the whole point of /roadmap) or archived, and archived is a lifecycle state
 * rather than a visibility mask. The MANAGE door is gated on SITE_CONFIG before it reaches this
 * class; the board read is any signed-in member's.
 *
 * ★ THREAD LINKS RESOLVE THROUGH THE CALLER'S OWN BOUND CLIENT ★
 *
 * A promoted card names its source thread, and the link is composed per reader: a thread the
 * caller cannot see — or one moderation has removed — yields a card with no link rather than an
 * address that 404s. The card itself still shows; what was promoted is board content, where the
 * vote lives is forum content, and only the second is gated.
 */

export interface RoadmapCardView {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly column: RoadmapColumn;
  readonly position: number;
  /** The Feature Requests thread this came from, when the READER may see it. */
  readonly threadLink: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ArchivedCardView {
  readonly id: string;
  readonly title: string;
  readonly column: RoadmapColumn;
  readonly archivedAt: Date;
}

const CARD_SELECT = {
  id: true,
  title: true,
  body: true,
  column: true,
  position: true,
  sourceThreadId: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface CardRow {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly column: RoadmapColumn;
  readonly position: number;
  readonly sourceThreadId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

@Injectable()
export class RoadmapService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(AclDbService) private readonly acl: AclDbService,
  ) {}

  // ── The member read ────────────────────────────────────────────────────────

  /** Every live card, in board order, with thread links the CALLER may follow. */
  async board(callerId: string): Promise<RoadmapCardView[]> {
    const rows = (await this.db.roadmapCard.findMany({
      where: { archivedAt: null },
      orderBy: [{ column: 'asc' }, { position: 'asc' }],
      select: CARD_SELECT,
    })) as CardRow[];

    const links = await this.#linksFor(callerId, rows);
    return rows.map((r) => view(r, links));
  }

  // ── The webmaster's board ──────────────────────────────────────────────────
  //
  // Every method below is reached only through the manage controller, gated on SITE_CONFIG.

  /** The live board plus the archive, for the console. */
  async manageList(
    callerId: string,
  ): Promise<{ cards: RoadmapCardView[]; archived: ArchivedCardView[] }> {
    const [cards, archivedRows] = await Promise.all([
      this.board(callerId),
      this.db.roadmapCard.findMany({
        where: { archivedAt: { not: null } },
        orderBy: { archivedAt: 'desc' },
        select: { id: true, title: true, column: true, archivedAt: true },
      }),
    ]);

    return {
      cards,
      archived: archivedRows.map((r) => ({
        id: r.id,
        title: r.title,
        column: r.column as RoadmapColumn,
        archivedAt: r.archivedAt as Date,
      })),
    };
  }

  /** A new card, landing at the end of its column. */
  async create(
    callerId: string,
    input: { title?: unknown; body?: unknown; column?: unknown },
  ): Promise<RoadmapCardView> {
    const title = this.#title(input.title);
    const body = this.#body(input.body);
    const column = this.#column(input.column ?? 'ideas');

    const row = (await this.db.roadmapCard.create({
      data: { title, body, column, position: await this.#endOf(column) },
      select: CARD_SELECT,
    })) as CardRow;

    return view(row, await this.#linksFor(callerId, [row]));
  }

  /** Rewrites a card's words. Where it sits is `move`'s job — two acts, two routes. */
  async edit(
    callerId: string,
    cardId: string,
    input: { title?: unknown; body?: unknown },
  ): Promise<RoadmapCardView> {
    await this.#liveCard(cardId);

    const row = (await this.db.roadmapCard.update({
      where: { id: cardId },
      data: { title: this.#title(input.title), body: this.#body(input.body) },
      select: CARD_SELECT,
    })) as CardRow;

    return view(row, await this.#linksFor(callerId, [row]));
  }

  /**
   * Column + position, in one write set.
   *
   * ★ THE WHOLE COLUMN IS RENUMBERED, TRANSACTIONALLY ★
   *
   * The colonisation build order's discipline: the mover names a destination, and every card in
   * the affected column(s) gets its position rewritten 0..n in one transaction. Fractional or
   * gap-leaving schemes avoid the extra writes and pay for it with a compaction job nobody
   * writes; a roadmap column holds dozens of cards at most, so the honest renumber costs
   * nothing measurable.
   */
  async move(cardId: string, columnRaw: unknown, positionRaw: unknown): Promise<void> {
    const card = await this.#liveCard(cardId);
    const column = this.#column(columnRaw ?? card.column);

    const target = await this.db.roadmapCard.findMany({
      where: { column, archivedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    const targetIds = target.map((t) => t.id);

    const index = clampPosition(
      positionRaw,
      // Moving within the column: the card already occupies a slot, so the last honest index
      // is len-1. Arriving from another column, the end is one past the current occupants.
      column === card.column ? Math.max(0, targetIds.length - 1) : targetIds.length,
    );
    const ordered = placeInOrder(targetIds, cardId, index);

    const writes = ordered.map((id, position) =>
      this.db.roadmapCard.update({
        where: { id },
        data: id === cardId ? { column, position } : { position },
      }),
    );

    /*
     * The source column keeps its relative order when a card leaves it; its positions are
     * renumbered too so they stay 0..n — the property every later clamp depends on.
     */
    if (column !== card.column) {
      const source = await this.db.roadmapCard.findMany({
        where: { column: card.column, archivedAt: null, id: { not: cardId } },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      writes.push(
        ...source.map((s, position) =>
          this.db.roadmapCard.update({ where: { id: s.id }, data: { position } }),
        ),
      );
    }

    await this.db.$transaction(writes);
  }

  /** Off the board, not out of history. Strict: archiving the archived is a stale screen. */
  async archive(cardId: string): Promise<void> {
    await this.#liveCard(cardId);
    await this.db.roadmapCard.update({
      where: { id: cardId },
      data: { archivedAt: new Date() },
    });
  }

  /** Back onto the board, at the end of the column it left from. */
  async restore(cardId: string): Promise<void> {
    const card = await this.db.roadmapCard.findFirst({
      where: { id: cardId },
      select: { id: true, column: true, archivedAt: true },
    });
    if (card === null) throw this.#notAvailable();
    if (card.archivedAt === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'This card is already on the board.');
    }

    await this.db.roadmapCard.update({
      where: { id: cardId },
      data: { archivedAt: null, position: await this.#endOf(card.column as RoadmapColumn) },
    });
  }

  /**
   * "Promote to board": a Feature Requests thread becomes an Ideas card.
   *
   * The thread is read through the WEBMASTER'S bound client — you cannot promote what you
   * cannot see — and must live on the Feature Requests board: the button exists to move a
   * VOTED-ON ask onto the roadmap, and promoting arbitrary forum threads would quietly turn
   * the board into a bookmark list.
   *
   * Idempotent on the thread: `source_thread_id` is UNIQUE, and promoting an already-promoted
   * thread answers with the existing card rather than an error — the two-webmasters race
   * resolves to one card either way.
   */
  async promote(
    webmasterId: string,
    threadIdRaw: unknown,
  ): Promise<{ card: RoadmapCardView; alreadyPromoted: boolean }> {
    if (typeof threadIdRaw !== 'string' || threadIdRaw === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the thread to promote.');
    }

    const db = await this.acl.forCaller(webmasterId);
    const thread = await db.forumThread.findFirst({
      where: { id: threadIdRaw, deletedAt: null },
      select: { id: true, title: true, category: { select: { slug: true } } },
    });
    if (thread === null) throw this.#notAvailable();
    if (thread.category.slug.toLowerCase() !== FEATURE_REQUESTS_SLUG) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Only Feature Requests threads go on the roadmap — the board tracks what the squadron voted for.',
      );
    }

    const existing = (await this.db.roadmapCard.findFirst({
      where: { sourceThreadId: thread.id },
      select: CARD_SELECT,
    })) as CardRow | null;
    if (existing !== null) {
      return {
        card: view(existing, await this.#linksFor(webmasterId, [existing])),
        alreadyPromoted: true,
      };
    }

    const row = (await this.db.roadmapCard.create({
      data: {
        title: thread.title,
        column: 'ideas',
        position: await this.#endOf('ideas'),
        sourceThreadId: thread.id,
      },
      select: CARD_SELECT,
    })) as CardRow;

    return { card: view(row, await this.#linksFor(webmasterId, [row])), alreadyPromoted: false };
  }

  /** The card a thread became, for the thread page's promote panel. Null means not promoted. */
  async cardForThread(threadId: string): Promise<{ id: string; column: RoadmapColumn } | null> {
    if (typeof threadId !== 'string' || threadId === '') return null;
    const row = await this.db.roadmapCard.findFirst({
      where: { sourceThreadId: threadId },
      select: { id: true, column: true },
    });
    return row === null ? null : { id: row.id, column: row.column as RoadmapColumn };
  }

  // ── Shared internals ───────────────────────────────────────────────────────

  #title(raw: unknown): string {
    const cleaned = cleanCardTitle(raw);
    if ('problem' in cleaned) throw new AppError(ErrorCode.VALIDATION_FAILED, cleaned.problem);
    return cleaned.title;
  }

  #body(raw: unknown): string | null {
    const cleaned = cleanCardBody(raw);
    if ('problem' in cleaned) throw new AppError(ErrorCode.VALIDATION_FAILED, cleaned.problem);
    return cleaned.body;
  }

  #column(raw: unknown): RoadmapColumn {
    if (!isRoadmapColumn(raw)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not one of the five columns.');
    }
    return raw;
  }

  /** Absent and archived-when-live-was-needed are ONE answer, the support-desk rule. */
  #notAvailable(): AppError {
    return new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That card is not available.');
  }

  async #liveCard(cardId: string): Promise<{ id: string; column: RoadmapColumn }> {
    const card = await this.db.roadmapCard.findFirst({
      where: { id: cardId, archivedAt: null },
      select: { id: true, column: true },
    });
    if (card === null) throw this.#notAvailable();
    return { id: card.id, column: card.column as RoadmapColumn };
  }

  /** One past the column's last live card — where new arrivals land. */
  async #endOf(column: RoadmapColumn): Promise<number> {
    return this.db.roadmapCard.count({ where: { column, archivedAt: null } });
  }

  /** Thread links for these cards, as THIS caller may see them. */
  async #linksFor(
    callerId: string,
    rows: readonly CardRow[],
  ): Promise<ReadonlyMap<string, string>> {
    const threadIds = rows
      .map((r) => r.sourceThreadId)
      .filter((id): id is string => id !== null);
    const links = new Map<string, string>();
    if (threadIds.length === 0) return links;

    const db = await this.acl.forCaller(callerId);
    const threads = await db.forumThread.findMany({
      where: { id: { in: threadIds }, deletedAt: null },
      select: { id: true, slug: true, category: { select: { slug: true } } },
    });
    for (const t of threads) links.set(t.id, `/forum/${t.category.slug}/${t.slug}`);
    return links;
  }
}

function view(r: CardRow, links: ReadonlyMap<string, string>): RoadmapCardView {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    column: r.column,
    position: r.position,
    threadLink: r.sourceThreadId === null ? null : (links.get(r.sourceThreadId) ?? null),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
