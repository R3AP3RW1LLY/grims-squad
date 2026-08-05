import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppError, ErrorCode } from '@grims/shared';
import { notifyMembers, PrismaClient } from '@grims/db';
import { LIVE_SERVICE } from '../live/live.tokens.js';
import { liveNudgeOf } from '../live/live-nudge.js';
import type { LiveService } from '../live/live.service.js';
import {
  GUEST_POSTS_PER_WINDOW,
  GUEST_POST_WINDOW_MS,
  GUEST_STARTS_PER_WINDOW,
  GUEST_START_WINDOW_MS,
  cleanGuestName,
  cleanMessageBody,
  cleanSubject,
  hashGuestToken,
  newGuestToken,
  postingProblem,
  systemLineFor,
  transitionProblem,
  type SupportStatus,
} from './support-chat.js';

/**
 * Help & Support — one service, three doors.
 *
 * The member door (session), the guest door (token) and the officer console (SUPPORT_AGENT) all
 * land here, exactly as colonisation's two doors share ColonyService: one copy of every rule,
 * because the rule that drifts is the one nobody re-reads — and here that rule is "whose
 * conversation may you read".
 *
 * ★ THE PLAIN CLIENT, AND WHY THAT IS CORRECT (INV-002) ★
 *
 * Support tables carry no ACL column and are not in ACL_MODELS — like `notifications`, their
 * visibility is not a mask on the row but an OWNERSHIP question, and it is answered HERE, in
 * every read: a member's reads are scoped `userId = caller`, a guest's reads are addressed by
 * their token's hash and can name no other row, and the console door is gated on SUPPORT_AGENT
 * before it reaches this class. No method on this service takes "which conversation" without
 * also taking who is asking.
 *
 * ★ WRONG TOKEN, WRONG ID, SOMEBODY ELSE'S — ONE ANSWER ★
 *
 * Every miss is "that conversation is not available", never a 403: a distinguishable refusal
 * would confirm which ids and tokens exist, which is the exact leak the device-link flow
 * documents and avoids.
 */

export interface SupportAuthorView {
  readonly id: string;
  readonly displayName: string;
}

export interface SupportMessageView {
  readonly id: string;
  readonly authorKind: 'member' | 'officer' | 'guest' | 'ai' | 'system';
  /** The member or officer who wrote it — their avatar is /v1/media/avatars/{id}. Null for guest and system turns. */
  readonly author: SupportAuthorView | null;
  readonly body: string;
  /** The hardened media route, ready for an <img src>. */
  readonly attachmentPath: string | null;
  readonly createdAt: Date;
}

export interface SupportConversationView {
  readonly id: string;
  readonly status: SupportStatus;
  readonly subject: string | null;
  readonly guestName: string | null;
  readonly createdAt: Date;
  readonly lastMessageAt: Date;
  /** Whether something landed since the REQUESTER last opened the transcript. */
  readonly unread: boolean;
  /** The newest message's opening words, for the list. */
  readonly preview: string;
}

export interface ConsoleConversationRow {
  readonly id: string;
  readonly status: SupportStatus;
  readonly subject: string | null;
  readonly requester:
    | { readonly kind: 'member'; readonly id: string; readonly displayName: string }
    | { readonly kind: 'guest'; readonly name: string };
  readonly preview: string;
  readonly createdAt: Date;
  readonly lastMessageAt: Date;
  /** Whether something landed since ANY officer last opened it. */
  readonly unread: boolean;
}

const PREVIEW_CHARS = 120;

/** The message columns every transcript read selects, author included. */
const MESSAGE_SELECT = {
  id: true,
  authorKind: true,
  body: true,
  attachmentId: true,
  createdAt: true,
  author: { select: { id: true, displayName: true } },
} as const;

interface MessageRow {
  readonly id: string;
  readonly authorKind: 'member' | 'officer' | 'guest' | 'ai' | 'system';
  readonly body: string;
  readonly attachmentId: string | null;
  readonly createdAt: Date;
  readonly author: { readonly id: string; readonly displayName: string } | null;
}

function messageView(row: MessageRow): SupportMessageView {
  return {
    id: row.id,
    authorKind: row.authorKind,
    author: row.author,
    body: row.body,
    attachmentPath: row.attachmentId === null ? null : `/v1/media/uploads/${row.attachmentId}`,
    createdAt: row.createdAt,
  };
}

function preview(body: string | undefined): string {
  if (body === undefined) return '';
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

/** Something landed after the given high-water mark. Null means nothing has ever been seen. */
function isUnread(lastMessageAt: Date, seenAt: Date | null): boolean {
  return seenAt === null || lastMessageAt.getTime() > seenAt.getTime();
}

@Injectable()
export class SupportService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    /*
     * OPTIONAL, like every other consumer: a missing live service costs a badge refresh, never a
     * message — and the specs construct this service without one.
     */
    @Optional() @Inject(LIVE_SERVICE) private readonly live: LiveService | null = null,
  ) {}

  /**
   * One coarse event for every change: `{type:'support', userId:null}`.
   *
   * Broadcast rather than targeted, deliberately. A new guest message concerns "whoever holds the
   * console open", which is not a user id anybody knows without a query — and the event carries
   * nothing, so the worst a broadcast costs any tab is re-reading a list it was already allowed
   * to read. Same doctrine as the squadron-wide notification event.
   */
  #poke(): void {
    try {
      this.live?.publish({ type: 'support', userId: null });
    } catch {
      // The rows already landed; a live hiccup must not un-succeed them.
    }
  }

  // ── The member door ────────────────────────────────────────────────────────

  async startForMember(
    userId: string,
    subjectRaw: unknown,
    bodyRaw: unknown,
  ): Promise<{ id: string }> {
    const body = this.#body(bodyRaw);
    const now = new Date();

    const row = await this.db.supportConversation.create({
      data: {
        userId,
        subject: cleanSubject(subjectRaw),
        lastMessageAt: now,
        // Opening the conversation IS seeing it — their own words must not read as unread.
        requesterSeenAt: now,
        messages: { create: { authorKind: 'member', authorId: userId, body } },
      },
      select: { id: true },
    });

    this.#poke();
    return { id: row.id };
  }

  async listForMember(userId: string): Promise<SupportConversationView[]> {
    const rows = await this.db.supportConversation.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        status: true,
        subject: true,
        guestName: true,
        createdAt: true,
        lastMessageAt: true,
        requesterSeenAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      subject: r.subject,
      guestName: r.guestName,
      createdAt: r.createdAt,
      lastMessageAt: r.lastMessageAt,
      unread: isUnread(r.lastMessageAt, r.requesterSeenAt),
      preview: preview(r.messages[0]?.body),
    }));
  }

  /** One conversation with its transcript, scoped to its owner. Opening it marks it seen. */
  async readForMember(
    userId: string,
    conversationId: string,
  ): Promise<{ conversation: SupportConversationView; messages: SupportMessageView[] }> {
    const row = await this.db.supportConversation.findFirst({
      // Scoped by OWNER in the query itself, so somebody else's id answers exactly
      // like an id that never existed.
      where: { id: conversationId, userId },
      select: {
        id: true,
        status: true,
        subject: true,
        guestName: true,
        createdAt: true,
        lastMessageAt: true,
        requesterSeenAt: true,
        messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT },
      },
    });
    if (row === null) throw this.#notAvailable();

    // AFTER the read, so a failed read never clears an indicator for words nobody saw.
    const wasUnread = isUnread(row.lastMessageAt, row.requesterSeenAt);
    await this.db.supportConversation.update({
      where: { id: row.id },
      data: { requesterSeenAt: new Date() },
    });
    /*
     * Only when the mark actually MOVED something. Marking a conversation seen changes what the
     * member's OTHER tabs should draw, so it earns a nudge — but an already-read transcript being
     * re-opened (or polled) changes nothing, and nudging on every read would turn one open guest
     * widget into a broadcast every five seconds.
     */
    if (wasUnread) this.#poke();

    return {
      conversation: {
        id: row.id,
        status: row.status,
        subject: row.subject,
        guestName: row.guestName,
        createdAt: row.createdAt,
        lastMessageAt: row.lastMessageAt,
        unread: false,
        preview: preview(row.messages[row.messages.length - 1]?.body),
      },
      messages: row.messages.map(messageView),
    };
  }

  async postAsMember(
    userId: string,
    conversationId: string,
    bodyRaw: unknown,
    attachmentIdRaw: unknown,
  ): Promise<SupportMessageView> {
    const body = this.#body(bodyRaw);

    const conversation = await this.db.supportConversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true, status: true },
    });
    if (conversation === null) throw this.#notAvailable();
    this.#assertOpen(conversation.status);

    const attachmentId = await this.#attachment(userId, attachmentIdRaw);
    const message = await this.#append(conversation.id, {
      authorKind: 'member',
      authorId: userId,
      body,
      attachmentId,
      seen: 'requester',
    });

    this.#poke();
    return message;
  }

  // ── The guest door ─────────────────────────────────────────────────────────

  /**
   * A guest starts a conversation and receives their token — ONCE. It is never shown again and
   * never stored in the clear; losing it means starting a fresh conversation, which is stated
   * where the widget hands it over.
   */
  async startForGuest(
    nameRaw: unknown,
    subjectRaw: unknown,
    bodyRaw: unknown,
  ): Promise<{ id: string; guestToken: string }> {
    const named = cleanGuestName(nameRaw);
    if ('problem' in named) throw new AppError(ErrorCode.VALIDATION_FAILED, named.problem);
    const body = this.#body(bodyRaw);

    /*
     * The rolling-window shape the upload quota uses. Guests have no identity to count against,
     * so the window is the site's — see the constant for why that trade is acceptable.
     */
    const since = new Date(Date.now() - GUEST_START_WINDOW_MS);
    const recent = await this.db.supportConversation.count({
      where: { userId: null, createdAt: { gte: since } },
    });
    if (recent >= GUEST_STARTS_PER_WINDOW) {
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        'The help desk is receiving more new conversations than it can believe are people. Try again shortly, or sign in with Discord.',
      );
    }

    const guestToken = newGuestToken();
    const now = new Date();

    const row = await this.db.supportConversation.create({
      data: {
        guestTokenHash: hashGuestToken(guestToken),
        guestName: named.name,
        subject: cleanSubject(subjectRaw),
        lastMessageAt: now,
        requesterSeenAt: now,
        messages: { create: { authorKind: 'guest', body } },
      },
      select: { id: true },
    });

    this.#poke();
    return { id: row.id, guestToken };
  }

  /**
   * The guest's transcript, addressed by their token and by nothing else.
   *
   * The hash is UNIQUE, so the token names at most one row — there is no id parameter for a
   * guesser to walk, and a wrong token answers exactly like no conversation at all.
   */
  async readForGuest(
    token: string,
  ): Promise<{ conversation: SupportConversationView; messages: SupportMessageView[] }> {
    const row = await this.db.supportConversation.findUnique({
      where: { guestTokenHash: this.#guestHash(token) },
      select: {
        id: true,
        status: true,
        subject: true,
        guestName: true,
        createdAt: true,
        lastMessageAt: true,
        requesterSeenAt: true,
        messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT },
      },
    });
    if (row === null) throw this.#notAvailable();

    // See readForMember: a nudge only when the mark moved, or a polling guest widget would
    // broadcast to every connected tab on every poll.
    const wasUnread = isUnread(row.lastMessageAt, row.requesterSeenAt);
    await this.db.supportConversation.update({
      where: { id: row.id },
      data: { requesterSeenAt: new Date() },
    });
    if (wasUnread) this.#poke();

    return {
      conversation: {
        id: row.id,
        status: row.status,
        subject: row.subject,
        guestName: row.guestName,
        createdAt: row.createdAt,
        lastMessageAt: row.lastMessageAt,
        unread: false,
        preview: preview(row.messages[row.messages.length - 1]?.body),
      },
      messages: row.messages.map(messageView),
    };
  }

  async postAsGuest(token: string, bodyRaw: unknown): Promise<SupportMessageView> {
    const body = this.#body(bodyRaw);
    const row = await this.db.supportConversation.findUnique({
      where: { guestTokenHash: this.#guestHash(token) },
      select: { id: true, status: true },
    });
    if (row === null) throw this.#notAvailable();
    this.#assertOpen(row.status);

    // Rolling window over this conversation's own guest turns — the repo's limiter shape.
    const since = new Date(Date.now() - GUEST_POST_WINDOW_MS);
    const recent = await this.db.supportMessage.count({
      where: { conversationId: row.id, authorKind: 'guest', createdAt: { gte: since } },
    });
    if (recent >= GUEST_POSTS_PER_WINDOW) {
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        'That is a lot of messages in one minute. Give us a moment to catch up, then send the next one.',
      );
    }

    const message = await this.#append(row.id, {
      authorKind: 'guest',
      authorId: null,
      body,
      // Guests attach nothing: the hardened upload path requires an account, and there is
      // deliberately no second upload path for anybody.
      attachmentId: null,
      seen: 'requester',
    });

    this.#poke();
    return message;
  }

  // ── The officer console ────────────────────────────────────────────────────
  //
  // Every method below is reached only through doors gated on SUPPORT_AGENT — the console
  // controller's class-level guard, and the device controller's per-route check.

  /** The console badge: open conversations with words no officer has seen yet. */
  async consoleBadge(): Promise<{ waiting: number }> {
    const rows = await this.db.supportConversation.findMany({
      where: { status: 'open' },
      select: { lastMessageAt: true, officerSeenAt: true },
    });
    return { waiting: rows.filter((r) => isUnread(r.lastMessageAt, r.officerSeenAt)).length };
  }

  async consoleList(status: SupportStatus): Promise<ConsoleConversationRow[]> {
    const rows = await this.db.supportConversation.findMany({
      where: { status },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        status: true,
        subject: true,
        guestName: true,
        createdAt: true,
        lastMessageAt: true,
        officerSeenAt: true,
        user: { select: { id: true, displayName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      subject: r.subject,
      requester:
        r.user === null
          ? { kind: 'guest', name: r.guestName ?? 'Guest' }
          : { kind: 'member', id: r.user.id, displayName: r.user.displayName },
      preview: preview(r.messages[0]?.body),
      createdAt: r.createdAt,
      lastMessageAt: r.lastMessageAt,
      unread: isUnread(r.lastMessageAt, r.officerSeenAt),
    }));
  }

  /** One conversation for the console. Opening it marks it seen for every officer — it is one queue. */
  async consoleRead(conversationId: string): Promise<{
    conversation: ConsoleConversationRow;
    messages: SupportMessageView[];
  }> {
    const row = await this.db.supportConversation.findFirst({
      where: { id: conversationId },
      select: {
        id: true,
        status: true,
        subject: true,
        guestName: true,
        createdAt: true,
        lastMessageAt: true,
        officerSeenAt: true,
        user: { select: { id: true, displayName: true } },
        messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT },
      },
    });
    if (row === null) throw this.#notAvailable();

    /*
     * The console is ONE shared queue, so one officer opening a conversation changes what every
     * OTHER officer's badge should say — that is a state change and earns a nudge. Only when the
     * mark moved, same as the requester side: re-reading a seen transcript changes nothing.
     */
    const wasUnread = isUnread(row.lastMessageAt, row.officerSeenAt);
    await this.db.supportConversation.update({
      where: { id: row.id },
      data: { officerSeenAt: new Date() },
    });
    if (wasUnread) this.#poke();

    return {
      conversation: {
        id: row.id,
        status: row.status,
        subject: row.subject,
        requester:
          row.user === null
            ? { kind: 'guest', name: row.guestName ?? 'Guest' }
            : { kind: 'member', id: row.user.id, displayName: row.user.displayName },
        preview: preview(row.messages[row.messages.length - 1]?.body),
        createdAt: row.createdAt,
        lastMessageAt: row.lastMessageAt,
        unread: false,
      },
      messages: row.messages.map(messageView),
    };
  }

  /**
   * An officer replies, as themselves. The reply carries their identity — name and face — which
   * is the owner's explicit ask, and a member conversation rings its member's bell.
   */
  async replyAsOfficer(
    officerId: string,
    conversationId: string,
    bodyRaw: unknown,
    attachmentIdRaw: unknown,
  ): Promise<SupportMessageView> {
    const body = this.#body(bodyRaw);

    const conversation = await this.db.supportConversation.findFirst({
      where: { id: conversationId },
      select: { id: true, status: true, userId: true },
    });
    if (conversation === null) throw this.#notAvailable();
    this.#assertOpen(conversation.status);

    const attachmentId = await this.#attachment(officerId, attachmentIdRaw);
    const message = await this.#append(conversation.id, {
      authorKind: 'officer',
      authorId: officerId,
      body,
      attachmentId,
      seen: 'officer',
    });

    if (conversation.userId !== null) {
      /*
       * The personal bell, for members only — a guest has no bell to ring, and officers get
       * console badge noise rather than a notification per message. Failure is already
       * swallowed inside notifyMembers: the reply landed, and a bell must not un-succeed it.
       */
      await notifyMembers(
        this.db,
        [conversation.userId],
        {
          kind: 'support.reply',
          title: 'Support replied to your conversation',
          body: preview(body),
          link: `/dashboard?support=${conversation.id}`,
        },
        liveNudgeOf(this.live),
      );
    }

    this.#poke();
    return message;
  }

  /** Close or reopen, strictly by the state machine, with the room saying so in the transcript. */
  async transition(
    officerId: string,
    conversationId: string,
    action: 'close' | 'reopen',
  ): Promise<void> {
    const conversation = await this.db.supportConversation.findFirst({
      where: { id: conversationId },
      select: { id: true, status: true },
    });
    if (conversation === null) throw this.#notAvailable();

    const problem = transitionProblem(conversation.status, action);
    if (problem !== null) throw new AppError(ErrorCode.VALIDATION_FAILED, problem);

    const now = new Date();
    await this.db.supportConversation.update({
      where: { id: conversation.id },
      data: {
        status: action === 'close' ? 'closed' : 'open',
        closedAt: action === 'close' ? now : null,
        closedById: action === 'close' ? officerId : null,
        lastMessageAt: now,
        officerSeenAt: now,
        // The room speaks, not the officer — see systemLineFor.
        messages: { create: { authorKind: 'system', body: systemLineFor(action) } },
      },
    });

    this.#poke();
  }

  // ── Shared internals ───────────────────────────────────────────────────────

  #body(raw: unknown): string {
    const cleaned = cleanMessageBody(raw);
    if ('problem' in cleaned) throw new AppError(ErrorCode.VALIDATION_FAILED, cleaned.problem);
    return cleaned.body;
  }

  #assertOpen(status: SupportStatus): void {
    const problem = postingProblem(status);
    if (problem !== null) throw new AppError(ErrorCode.VALIDATION_FAILED, problem);
  }

  /** Absent, wrong and somebody else's are ONE answer. See the class header. */
  #notAvailable(): AppError {
    return new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That conversation is not available.');
  }

  /**
   * The hash a guest's presented token resolves through.
   *
   * An empty or malformed token is refused with the SAME answer a wrong one gets — before the
   * database is asked, because `findUnique` on null would be a query that can never match and a
   * different timing for a guesser to notice.
   */
  #guestHash(token: string): string {
    if (typeof token !== 'string' || token === '') throw this.#notAvailable();
    return hashGuestToken(token);
  }

  /**
   * Appends one turn and bumps the conversation's clock in the same act.
   *
   * The writer's own high-water mark moves with it, so nobody's reply reads as unread to
   * themselves — which is what would make every badge permanently lit.
   */
  async #append(
    conversationId: string,
    turn: {
      authorKind: 'member' | 'officer' | 'guest' | 'system';
      authorId: string | null;
      body: string;
      attachmentId: string | null;
      seen: 'requester' | 'officer';
    },
  ): Promise<SupportMessageView> {
    const now = new Date();
    const row = await this.db.supportMessage.create({
      data: {
        conversationId,
        authorKind: turn.authorKind,
        authorId: turn.authorId,
        body: turn.body,
        attachmentId: turn.attachmentId,
        createdAt: now,
      },
      select: MESSAGE_SELECT,
    });

    await this.db.supportConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: now,
        ...(turn.seen === 'requester' ? { requesterSeenAt: now } : { officerSeenAt: now }),
      },
    });

    return messageView(row);
  }

  /**
   * Validates an attachment: it must be an upload the SENDER made.
   *
   * Ids are unguessable, so this is not defending against discovery — it stops a message being
   * decorated with somebody else's upload, which would put one member's screenshot under
   * another member's name.
   */
  async #attachment(callerId: string, raw: unknown): Promise<string | null> {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That attachment id is not valid.');
    }
    const upload = await this.db.mediaUpload.findFirst({
      where: { id: raw, uploaderId: callerId },
      select: { id: true },
    });
    if (upload === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That image is not one you uploaded. Attach it again.',
      );
    }
    return upload.id;
  }
}
