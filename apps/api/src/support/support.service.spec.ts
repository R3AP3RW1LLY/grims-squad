import { describe, expect, it } from 'vitest';
import { ERROR_STATUS, ErrorCode } from '@grims/shared';
import type { PrismaClient } from '@grims/db';
import { SupportService } from './support.service.js';
import {
  GUEST_POSTS_PER_WINDOW,
  GUEST_STARTS_PER_WINDOW,
  MESSAGE_MAX_CHARS,
  hashGuestToken,
} from './support-chat.js';

/**
 * The service, against a recording stub — the moderation.spec shape.
 *
 * ★ WHAT MATTERS HERE ★
 *
 * Three things carry the feature's security, and each has a MANDATORY test: the guest token is
 * stored only as a hash and a wrong one answers like nothing exists; every door enforces the
 * message cap server-side; and reads are scoped to their owner in the query itself. Everything
 * else — previews, ordering — is furniture.
 */

interface Recorded {
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  notifications: Array<Record<string, unknown>>;
}

function stubDb(over: Record<string, unknown> = {}): { db: PrismaClient; rec: Recorded } {
  const rec: Recorded = { conversations: [], messages: [], updates: [], notifications: [] };

  const db = {
    supportConversation: {
      create: async (a: { data: Record<string, unknown> }) => {
        rec.conversations.push(a.data);
        return { id: 'c1' };
      },
      findFirst: async () => null,
      findUnique: async () => null,
      findMany: async () => [],
      count: async () => 0,
      update: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        rec.updates.push(a);
        return {};
      },
    },
    supportMessage: {
      create: async (a: { data: Record<string, unknown> }) => {
        rec.messages.push(a.data);
        return {
          id: 'm1',
          authorKind: a.data['authorKind'],
          body: a.data['body'],
          attachmentId: a.data['attachmentId'] ?? null,
          createdAt: new Date(),
          author:
            typeof a.data['authorId'] === 'string'
              ? { id: a.data['authorId'], displayName: 'Somebody' }
              : null,
        };
      },
      count: async () => 0,
    },
    mediaUpload: { findFirst: async () => null },
    notification: {
      createMany: async (a: { data: Array<Record<string, unknown>> }) => {
        rec.notifications.push(...a.data);
        return { count: a.data.length };
      },
    },
    ...over,
  };

  return { db: db as unknown as PrismaClient, rec };
}

const NOT_AVAILABLE = { code: ErrorCode.RESOURCE_NOT_VISIBLE };

describe('the guest token round-trip', () => {
  it('MANDATORY: the token is stored ONLY as a hash, shown once, and round-trips', async () => {
    const { db, rec } = stubDb();
    const svc = new SupportService(db);

    const started = await svc.startForGuest('Halsey', 'Docking', 'How do I join?');
    expect(started.guestToken.startsWith('gsup_')).toBe(true);

    // The stored row carries the HASH of what was returned…
    expect(rec.conversations[0]?.['guestTokenHash']).toBe(hashGuestToken(started.guestToken));
    // …and nothing anywhere in the write carries the token itself.
    expect(JSON.stringify(rec.conversations)).not.toContain(started.guestToken);
  });

  it('MANDATORY: a wrong token answers "not available" — a 404, never a 403-shaped confession', async () => {
    /*
     * A 403 would say "that conversation exists and is not yours", which for a token-addressed
     * row means "keep guessing". Wrong, empty and absent must all be the same sentence with the
     * same status — the device-link discipline.
     */
    const { db } = stubDb();
    const svc = new SupportService(db);

    await expect(svc.readForGuest('gsup_wrong')).rejects.toMatchObject(NOT_AVAILABLE);
    await expect(svc.readForGuest('')).rejects.toMatchObject(NOT_AVAILABLE);
    await expect(svc.postAsGuest('gsup_wrong', 'hello')).rejects.toMatchObject(NOT_AVAILABLE);
    expect(ERROR_STATUS[ErrorCode.RESOURCE_NOT_VISIBLE]).toBe(404);
  });

  it('the right token reaches the transcript, by hash and by nothing else', async () => {
    const token = 'gsup_right';
    const row = {
      id: 'c1',
      status: 'open',
      subject: null,
      guestName: 'Halsey',
      createdAt: new Date(),
      lastMessageAt: new Date(),
      requesterSeenAt: null,
      messages: [
        {
          id: 'm1',
          authorKind: 'guest',
          body: 'How do I join?',
          attachmentId: null,
          createdAt: new Date(),
          author: null,
        },
      ],
    };

    const asked: string[] = [];
    const { db } = stubDb({
      supportConversation: {
        findUnique: async (a: { where: { guestTokenHash: string } }) => {
          asked.push(a.where.guestTokenHash);
          return a.where.guestTokenHash === hashGuestToken(token) ? row : null;
        },
        update: async () => ({}),
      },
    });

    const svc = new SupportService(db);
    const read = await svc.readForGuest(token);
    expect(read.messages).toHaveLength(1);
    expect(read.conversation.guestName).toBe('Halsey');
    // The lookup presented the HASH to the database, never the token.
    expect(asked).toEqual([hashGuestToken(token)]);
  });
});

describe('the message cap holds at every door', () => {
  it('MANDATORY: member, guest and officer doors all refuse past 4000', async () => {
    /*
     * Walked, not spot-checked: the cap that drifts is the one on the door nobody re-tests.
     * None of these may even reach the database — the stub's findFirst would be the next call
     * and it never gets one.
     */
    const long = 'a'.repeat(MESSAGE_MAX_CHARS + 1);
    const { db } = stubDb();
    const svc = new SupportService(db);

    for (const attempt of [
      () => svc.startForMember('u1', undefined, long),
      () => svc.postAsMember('u1', 'c1', long, undefined),
      () => svc.startForGuest('Halsey', undefined, long),
      () => svc.postAsGuest('gsup_x', long),
      () => svc.replyAsOfficer('o1', 'c1', long, undefined),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });
});

describe('reads are scoped to their owner in the query itself', () => {
  it("MANDATORY: somebody else's conversation id answers exactly like no conversation", async () => {
    const wheres: Array<Record<string, unknown>> = [];
    const { db } = stubDb({
      supportConversation: {
        findFirst: async (a: { where: Record<string, unknown> }) => {
          wheres.push(a.where);
          return null;
        },
      },
    });

    const svc = new SupportService(db);
    await expect(svc.readForMember('u1', 'c-not-mine')).rejects.toMatchObject(NOT_AVAILABLE);
    await expect(svc.postAsMember('u1', 'c-not-mine', 'hi', undefined)).rejects.toMatchObject(
      NOT_AVAILABLE,
    );

    // The scoping is IN the where — the database never even returns a foreign row for the
    // service to consider. That is what makes the two misses indistinguishable.
    for (const where of wheres) {
      expect(where).toMatchObject({ userId: 'u1' });
    }
  });
});

describe('the state machine, enforced', () => {
  const closedRow = { id: 'c1', status: 'closed', userId: 'u1' };

  it('MANDATORY: nobody posts into a closed conversation — officers included', async () => {
    const { db } = stubDb({
      supportConversation: {
        findFirst: async () => closedRow,
        findUnique: async () => ({ id: 'c1', status: 'closed' }),
      },
    });
    const svc = new SupportService(db);

    for (const attempt of [
      () => svc.postAsMember('u1', 'c1', 'hello?', undefined),
      () => svc.postAsGuest('gsup_x', 'hello?'),
      () => svc.replyAsOfficer('o1', 'c1', 'hello?', undefined),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });

  it('closing stamps who and when, and the room says so as system', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => ({ id: 'c1', status: 'open' }),
        update: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updates.push(a);
          return {};
        },
      },
    });

    const svc = new SupportService(db);
    await svc.transition('officer-1', 'c1', 'close');

    const data = rec.updates[0]?.data as Record<string, unknown>;
    expect(data).toMatchObject({ status: 'closed', closedById: 'officer-1' });
    expect(data['closedAt']).toBeInstanceOf(Date);
    // The line is the ROOM's, not the officer's — authorKind system, no authorId.
    expect(data['messages']).toMatchObject({
      create: { authorKind: 'system', body: 'This conversation was closed.' },
    });
  });

  it('a stale screen is told so: close on closed, reopen on open', async () => {
    const { db } = stubDb({
      supportConversation: { findFirst: async () => ({ id: 'c1', status: 'closed' }) },
    });
    const svc = new SupportService(db);
    await expect(svc.transition('o1', 'c1', 'close')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });

    const open = stubDb({
      supportConversation: { findFirst: async () => ({ id: 'c1', status: 'open' }) },
    });
    await expect(
      new SupportService(open.db).transition('o1', 'c1', 'reopen'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('reopening clears the closure entirely', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => ({ id: 'c1', status: 'closed' }),
        update: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updates.push(a);
          return {};
        },
      },
    });

    await new SupportService(db).transition('o1', 'c1', 'reopen');
    expect(rec.updates[0]?.data).toMatchObject({
      status: 'open',
      closedAt: null,
      closedById: null,
    });
  });
});

describe('the officer reply', () => {
  const memberConversation = { id: 'c1', status: 'open', userId: 'member-1' };

  it("rings the MEMBER's bell as support.reply, linking to the conversation", async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => memberConversation,
        update: async () => ({}),
      },
    });

    await new SupportService(db).replyAsOfficer('officer-1', 'c1', 'On it.', undefined);

    expect(rec.notifications).toHaveLength(1);
    expect(rec.notifications[0]).toMatchObject({
      userId: 'member-1',
      kind: 'support.reply',
      link: '/dashboard?support=c1',
    });
    // The reply itself wears the officer's identity.
    expect(rec.messages[0]).toMatchObject({ authorKind: 'officer', authorId: 'officer-1' });
  });

  it('a guest conversation rings no bell — guests have none', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => ({ id: 'c1', status: 'open', userId: null }),
        update: async () => ({}),
      },
    });

    await new SupportService(db).replyAsOfficer('officer-1', 'c1', 'On it.', undefined);
    expect(rec.notifications).toHaveLength(0);
  });

  it("MANDATORY: an attachment must be the sender's own upload", async () => {
    // Somebody else's upload id under an officer's name is the confusion this forecloses.
    const { db } = stubDb({
      supportConversation: { findFirst: async () => memberConversation },
      mediaUpload: { findFirst: async () => null },
    });

    await expect(
      new SupportService(db).replyAsOfficer('officer-1', 'c1', 'See attached.', 'upload-9'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('members are never throttled', () => {
  it('MANDATORY: the member doors never even CONSULT the spam counters', async () => {
    /*
     * Squadron owner, verbatim: "if they are logged in then no protection is required for spam."
     * Spam protection is the GUEST doors' custom discipline and nobody else's — a member is an
     * accountable account with a name on every message, and moderation is the remedy there.
     *
     * Asserted structurally rather than by volume: a stub whose counters THROW proves the member
     * paths contain no counting at all, where "50 posts succeeded" would only prove the ceiling
     * is above 50 — and a limiter added at 100 would pass it.
     */
    const explode = async (): Promise<never> => {
      throw new Error('a member door consulted the spam counter');
    };

    const { db, rec } = stubDb({
      supportConversation: {
        create: async (a: { data: Record<string, unknown> }) => {
          rec.conversations.push(a.data);
          return { id: 'c1' };
        },
        findFirst: async () => ({ id: 'c1', status: 'open', userId: 'u1' }),
        update: async () => ({}),
        count: explode,
      },
      supportMessage: {
        create: async (a: { data: Record<string, unknown> }) => {
          rec.messages.push(a.data);
          return {
            id: 'm1',
            authorKind: a.data['authorKind'],
            body: a.data['body'],
            attachmentId: null,
            createdAt: new Date(),
            author: { id: 'u1', displayName: 'Somebody' },
          };
        },
        count: explode,
      },
    });

    const svc = new SupportService(db);
    await svc.startForMember('u1', 'A subject', 'hello');
    for (let i = 0; i < 25; i += 1) {
      await svc.postAsMember('u1', 'c1', `message ${i}`, undefined);
    }
    // The officer door is a signed-in door too, and gets the same freedom.
    await svc.replyAsOfficer('o1', 'c1', 'on it', undefined);

    expect(rec.messages.length).toBeGreaterThanOrEqual(26);
  });
});

describe('the guest limiters', () => {
  it('refuses a start flood with RATE_LIMITED', async () => {
    const { db } = stubDb({
      supportConversation: {
        count: async () => GUEST_STARTS_PER_WINDOW,
        create: async () => ({ id: 'never' }),
      },
    });

    await expect(
      new SupportService(db).startForGuest('Halsey', undefined, 'hello'),
    ).rejects.toMatchObject({ code: ErrorCode.RATE_LIMITED });
  });

  it('refuses a posting flood inside one conversation', async () => {
    const { db } = stubDb({
      supportConversation: {
        findUnique: async () => ({ id: 'c1', status: 'open' }),
      },
      supportMessage: {
        count: async () => GUEST_POSTS_PER_WINDOW,
        create: async () => ({ id: 'never' }),
      },
    });

    await expect(new SupportService(db).postAsGuest('gsup_x', 'again')).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
    });
  });
});
