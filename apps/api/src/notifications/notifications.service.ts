import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';

/**
 * Reads and read-state for the bell.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "create a notifications dropdown in a bell icon ... this should also have a badge system with a
 * read all option and should work like standard social media notifications etc!" — approved with
 * the panel as a right-edge slide-in.
 *
 * Two feeds, two read models, one badge:
 *   personal — rows in `notifications`, each with its own readAt. Standard social-media shape.
 *   squadron — one shared row per event; "read" is the member's own high-water mark
 *              (users.squadronSeenAt), because marking a SHARED fact read per-member per-row
 *              would be a join table for information one timestamp already carries.
 * The badge is the sum of both unread counts.
 */

export interface PersonalItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface SquadronItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  readonly actor: { readonly handle: string; readonly displayName: string } | null;
  readonly createdAt: Date;
}

const PAGE = 30;

@Injectable()
export class NotificationsService {
  constructor(private readonly db: PrismaClient) {}

  async counts(userId: string): Promise<{ personal: number; squadron: number; total: number }> {
    const [personal, seen] = await Promise.all([
      this.db.notification.count({
        where: { userId, channel: 'in_app', readAt: null },
      }),
      this.db.user.findUnique({ where: { id: userId }, select: { squadronSeenAt: true } }),
    ]);

    const squadron = await this.db.squadronActivity.count({
      where:
        seen?.squadronSeenAt == null ? {} : { createdAt: { gt: seen.squadronSeenAt } },
    });

    return { personal, squadron, total: personal + squadron };
  }

  /** Newest first, cursor on id. `nextCursor` null when the history is exhausted. */
  async personal(
    userId: string,
    cursor: string | null,
  ): Promise<{ items: PersonalItem[]; nextCursor: string | null }> {
    const rows = await this.db.notification.findMany({
      where: { userId, channel: 'in_app' },
      orderBy: { createdAt: 'desc' },
      take: PAGE + 1,
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        link: true,
        readAt: true,
        createdAt: true,
      },
    });

    const page = rows.slice(0, PAGE);
    return {
      items: page,
      nextCursor: rows.length > PAGE ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async squadron(
    cursor: string | null,
  ): Promise<{ items: SquadronItem[]; nextCursor: string | null }> {
    const cursorId = cursor === null ? null : BigInt(cursor);
    const rows = await this.db.squadronActivity.findMany({
      orderBy: { id: 'desc' },
      take: PAGE + 1,
      ...(cursorId === null ? {} : { cursor: { id: cursorId }, skip: 1 }),
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        link: true,
        createdAt: true,
        actor: { select: { handle: true, displayName: true } },
      },
    });

    const page = rows.slice(0, PAGE);
    return {
      items: page.map((r) => ({
        id: String(r.id),
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: r.link,
        actor: r.actor,
        createdAt: r.createdAt,
      })),
      nextCursor: rows.length > PAGE ? String(page[page.length - 1]?.id ?? '') || null : null,
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    // updateMany rather than update: a forged or foreign id must be a no-op, never an error probe.
    await this.db.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** "Read all": every personal row, and the squadron marker brought to now, in one act. */
  async readAll(userId: string): Promise<void> {
    await Promise.all([
      this.db.notification.updateMany({
        where: { userId, channel: 'in_app', readAt: null },
        data: { readAt: new Date() },
      }),
      this.db.user.update({ where: { id: userId }, data: { squadronSeenAt: new Date() } }),
    ]);
  }

  async squadronSeen(userId: string): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { squadronSeenAt: new Date() } });
  }
}
