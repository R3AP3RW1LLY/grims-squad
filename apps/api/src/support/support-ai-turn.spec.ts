import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@grims/shared';
import type { PrismaClient } from '@grims/db';
import type { SupportAnswerService, SupportTurn } from '../ai/support-answer.service.js';
import { SupportService } from './support.service.js';
import { OFFICER_HANDOFF_LINE, hashGuestToken } from './support-chat.js';

/**
 * Wave 3 — the AI's turn, the hand-off, and the badge that only counts people's work.
 *
 * ★ THE MODE RULES, EACH PINNED ★
 *
 * AI ANSWERS FIRST: a requester message into an AI-handled conversation gets an `ai` turn,
 * appended after the requester's own POST already returned. HUMAN ON DEMAND: "talk to an
 * officer" flips the mode with a system line; any officer reply flips it silently; the AI
 * being unreachable flips it silently too. And in every officer-mode conversation the AI is
 * STRUCTURALLY silent — the responder here THROWS if consulted, so a regression cannot pass.
 */

interface Recorded {
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  updateManys: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  findManyWheres: Array<Record<string, unknown>>;
}

function stubDb(over: Record<string, unknown> = {}): { db: PrismaClient; rec: Recorded } {
  const rec: Recorded = {
    conversations: [],
    messages: [],
    updates: [],
    updateManys: [],
    findManyWheres: [],
  };

  const db = {
    supportConversation: {
      create: async (a: { data: Record<string, unknown> }) => {
        rec.conversations.push(a.data);
        return { id: 'c1' };
      },
      findFirst: async () => null,
      findUnique: async () => null,
      findMany: async (a: { where: Record<string, unknown> }) => {
        rec.findManyWheres.push(a.where);
        return [];
      },
      count: async () => 0,
      update: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        rec.updates.push(a);
        return {};
      },
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        rec.updateManys.push(a);
        return { count: 1 };
      },
    },
    supportMessage: {
      create: async (a: { data: Record<string, unknown> }) => {
        rec.messages.push(a.data);
        return {
          id: `m${rec.messages.length}`,
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
      findMany: async () => [],
      count: async () => 0,
    },
    mediaUpload: { findFirst: async () => null },
    notification: { createMany: async (a: { data: unknown[] }) => ({ count: a.data.length }) },
    ...over,
  };

  return { db: db as unknown as PrismaClient, rec };
}

/** A responder whose answer is known, and which records what it was asked. */
function stubResponder(reply: string | null = 'Open "Settings" and press "Pair this device".'): {
  responder: SupportAnswerService;
  calls: Array<{ question: string; history: readonly SupportTurn[] }>;
} {
  const calls: Array<{ question: string; history: readonly SupportTurn[] }> = [];
  const responder = {
    answer: async (question: string, history: readonly SupportTurn[]) => {
      calls.push({ question, history });
      return reply;
    },
  };
  return { responder: responder as unknown as SupportAnswerService, calls };
}

/**
 * A responder that fails the build if the AI is ever consulted. The strongest available claim:
 * not "it answered nothing" but "the code path does not exist".
 */
function explodingResponder(): SupportAnswerService {
  return {
    answer: async () => {
      throw new Error('the AI was consulted in a conversation that is not its to answer');
    },
  } as unknown as SupportAnswerService;
}

/** The AI turn is fire-and-forget; wait for its writes to land. */
const settled = (check: () => boolean): Promise<void> =>
  vi.waitFor(() => {
    if (!check()) throw new Error('not yet');
  });

const AI_CONVERSATION = { id: 'c1', status: 'open', handledBy: 'ai', userId: 'u1' };
const OFFICER_CONVERSATION = { id: 'c1', status: 'open', handledBy: 'officer', userId: 'u1' };

describe('the AI takes the first turn', () => {
  it('MANDATORY: a member start gets an ai turn through #append, after the POST already returned', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        create: async (a: { data: Record<string, unknown> }) => {
          stubDbRec(rec, a);
          return { id: 'c1' };
        },
        findFirst: async () => AI_CONVERSATION,
        update: async () => ({}),
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updateManys.push(a);
          return { count: 1 };
        },
      },
    });
    const { responder, calls } = stubResponder();
    const svc = new SupportService(db, null, responder);

    const started = await svc.startForMember('u1', 'Pairing', 'how do I pair the app?');
    // The member's POST returned with the id — whatever the model does happens after.
    expect(started.id).toBe('c1');

    await settled(() => rec.messages.some((m) => m['authorKind'] === 'ai'));

    const aiTurn = rec.messages.find((m) => m['authorKind'] === 'ai');
    expect(aiTurn).toMatchObject({
      conversationId: 'c1',
      authorId: null,
      body: 'Open "Settings" and press "Pair this device".',
    });
    expect(calls[0]?.question).toBe('how do I pair the app?');
    // The claim that let it speak was conditional on the conversation still being the AI's.
    expect(rec.updateManys[0]?.where).toMatchObject({ id: 'c1', status: 'open', handledBy: 'ai' });
  });

  it('MANDATORY: a guest start gets the same first turn — parity is the same code path', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        create: async (a: { data: Record<string, unknown> }) => {
          stubDbRec(rec, a);
          return { id: 'c1' };
        },
        count: async () => 0,
        findFirst: async () => ({ ...AI_CONVERSATION, userId: null }),
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updateManys.push(a);
          return { count: 1 };
        },
      },
    });
    const { responder } = stubResponder();
    const svc = new SupportService(db, null, responder);

    await svc.startForGuest('Halsey', undefined, 'how do I join the squadron?');
    await settled(() => rec.messages.some((m) => m['authorKind'] === 'ai'));

    expect(rec.messages.find((m) => m['authorKind'] === 'ai')).toMatchObject({
      authorId: null,
      conversationId: 'c1',
    });
  });

  it("MANDATORY: the requester's POST does not wait for the model", async () => {
    const { db } = stubDb({
      supportConversation: {
        create: async () => ({ id: 'c1' }),
        findFirst: async () => AI_CONVERSATION,
      },
    });
    // A model that NEVER answers. If the POST awaited it, this test would time out.
    const never = {
      answer: () => new Promise<never>(() => undefined),
    } as unknown as SupportAnswerService;

    const svc = new SupportService(db, null, never);
    await expect(svc.startForMember('u1', undefined, 'hello?')).resolves.toEqual({ id: 'c1' });
  });

  it('a follow-up carries the transcript as history, without the question twice', async () => {
    const transcript = [
      { authorKind: 'member', body: 'how do I pair the app?' },
      { authorKind: 'ai', body: 'Open "Settings".' },
      { authorKind: 'system', body: 'noise that must not become a turn' },
      { authorKind: 'member', body: 'and on my phone?' },
    ];
    const { db } = stubDb({
      supportConversation: {
        findFirst: async () => AI_CONVERSATION,
        update: async () => ({}),
        updateMany: async () => ({ count: 1 }),
      },
      supportMessage: {
        create: async (a: { data: Record<string, unknown> }) => ({
          id: 'm1',
          authorKind: a.data['authorKind'],
          body: a.data['body'],
          attachmentId: null,
          createdAt: new Date(),
          author: null,
        }),
        // Newest first, as the service asks for them.
        findMany: async () => [...transcript].reverse(),
        count: async () => 0,
      },
    });
    const { responder, calls } = stubResponder();
    const svc = new SupportService(db, null, responder);

    await svc.postAsMember('u1', 'c1', 'and on my phone?', undefined);
    await settled(() => calls.length > 0);

    expect(calls[0]?.question).toBe('and on my phone?');
    // The triggering message rides as the QUESTION only; system lines vanish; roles map.
    expect(calls[0]?.history).toEqual([
      { role: 'user', content: 'how do I pair the app?' },
      { role: 'assistant', content: 'Open "Settings".' },
    ]);
  });
});

describe('the AI is structurally silent where it has no seat', () => {
  it('MANDATORY: an officer-mode conversation never consults the responder', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => OFFICER_CONVERSATION,
        update: async () => ({}),
      },
    });
    const svc = new SupportService(db, null, explodingResponder());

    await svc.postAsMember('u1', 'c1', 'anybody there?', undefined);
    // Give a would-be stray AI turn every chance to surface before declaring silence.
    await new Promise((r) => setTimeout(r, 20));

    expect(rec.messages.filter((m) => m['authorKind'] === 'ai')).toHaveLength(0);
  });

  it('MANDATORY: an officer reply never consults the responder — the AI does not answer officers', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => ({ id: 'c1', status: 'open', userId: null }),
        update: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updates.push(a);
          return {};
        },
      },
    });
    const svc = new SupportService(db, null, explodingResponder());

    await svc.replyAsOfficer('o1', 'c1', 'A person here now.', undefined);
    await new Promise((r) => setTimeout(r, 20));

    expect(rec.messages.filter((m) => m['authorKind'] === 'ai')).toHaveLength(0);
  });

  it('MANDATORY: a closed conversation gets no turn even when the door raced it open', async () => {
    // The post-time read said open+ai; by the time the AI looked for itself, it was closed.
    let reads = 0;
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => {
          reads += 1;
          return reads === 1 ? AI_CONVERSATION : { ...AI_CONVERSATION, status: 'closed' };
        },
        update: async () => ({}),
      },
    });
    const svc = new SupportService(db, null, explodingResponder());

    await svc.postAsMember('u1', 'c1', 'last word', undefined);
    await new Promise((r) => setTimeout(r, 20));

    expect(rec.messages.filter((m) => m['authorKind'] === 'ai')).toHaveLength(0);
  });

  it('MANDATORY: losing the atomic claim drops the reply — the AI never talks over a takeover', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => AI_CONVERSATION,
        update: async () => ({}),
        // Somebody took the conversation while the model was writing.
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updateManys.push(a);
          return { count: 0 };
        },
      },
    });
    const { responder, calls } = stubResponder('Too late to matter.');
    const svc = new SupportService(db, null, responder);

    await svc.postAsMember('u1', 'c1', 'hello', undefined);
    await settled(() => calls.length > 0 && rec.updateManys.length > 0);
    await new Promise((r) => setTimeout(r, 20));

    // The member's message landed; the AI's did not.
    expect(rec.messages.filter((m) => m['authorKind'] === 'member')).toHaveLength(1);
    expect(rec.messages.filter((m) => m['authorKind'] === 'ai')).toHaveLength(0);
  });
});

describe('"talk to an officer" — the hand-off', () => {
  it('MANDATORY: flips the mode once, says so as system, and leaves the officer mark alone', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => AI_CONVERSATION,
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updateManys.push(a);
          return { count: 1 };
        },
      },
    });
    const svc = new SupportService(db, null, explodingResponder());

    await svc.escalateForMember('u1', 'c1');

    // Conditional on still being the AI's — two presses cannot write two lines.
    expect(rec.updateManys[0]?.where).toMatchObject({ id: 'c1', handledBy: 'ai' });
    const data = rec.updateManys[0]?.data ?? {};
    expect(data).toMatchObject({ handledBy: 'officer' });
    // The requester pressed it; the line must not read unread to THEM…
    expect(data['requesterSeenAt']).toBeInstanceOf(Date);
    // …and the officer mark stays put, which is exactly what lights the waiting badge.
    expect(data['officerSeenAt']).toBeUndefined();

    expect(rec.messages).toHaveLength(1);
    expect(rec.messages[0]).toMatchObject({ authorKind: 'system', body: OFFICER_HANDOFF_LINE });
  });

  it('a guest escalates through their token door, and a wrong token learns nothing', async () => {
    const token = 'gsup_right';
    const { db, rec } = stubDb({
      supportConversation: {
        findUnique: async (a: { where: { guestTokenHash: string } }) =>
          a.where.guestTokenHash === hashGuestToken(token)
            ? { id: 'c1', status: 'open', handledBy: 'ai' }
            : null,
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updateManys.push(a);
          return { count: 1 };
        },
      },
    });
    const svc = new SupportService(db, null, explodingResponder());

    await svc.escalateForGuest(token);
    expect(rec.messages[0]).toMatchObject({ authorKind: 'system', body: OFFICER_HANDOFF_LINE });

    await expect(svc.escalateForGuest('gsup_wrong')).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
  });

  it('pressing it on an already-officer conversation agrees quietly — no second line, no error', async () => {
    /*
     * The requester's screen can be honestly stale: the AI-down fallback flips silently, and a
     * polling guest is seconds behind. Refusing "talk to an officer" with an error — for asking
     * for a person who is already coming — would read as the desk breaking at the worst moment.
     */
    const { db, rec } = stubDb({
      supportConversation: { findFirst: async () => OFFICER_CONVERSATION },
    });
    const svc = new SupportService(db, null, explodingResponder());

    await expect(svc.escalateForMember('u1', 'c1')).resolves.toBeUndefined();
    expect(rec.updateManys).toHaveLength(0);
    expect(rec.messages).toHaveLength(0);
  });

  it('a closed conversation cannot be escalated — it needs reopening, not an officer', async () => {
    const { db } = stubDb({
      supportConversation: {
        findFirst: async () => ({ id: 'c1', status: 'closed', handledBy: 'ai' }),
      },
    });
    await expect(
      new SupportService(stubDb().db, null, null).escalateForMember('u1', 'missing'),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_VISIBLE });
    await expect(
      new SupportService(db, null, null).escalateForMember('u1', 'c1'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('an officer reply takes the conversation over', () => {
  it('MANDATORY: the reply itself writes handledBy officer — the AI does not talk over a person', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => ({ id: 'c1', status: 'open', userId: 'member-1' }),
        update: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updates.push(a);
          return {};
        },
      },
    });
    const svc = new SupportService(db, null, explodingResponder());

    await svc.replyAsOfficer('officer-1', 'c1', 'On it.', undefined);

    // The same write that lands the reply's clock carries the takeover.
    expect(rec.updates[0]?.data).toMatchObject({ handledBy: 'officer' });
  });
});

describe('the AI being unreachable hands the conversation to a person, silently', () => {
  it('MANDATORY: a null answer appends nothing and flips the mode so the badge counts it', async () => {
    const { db, rec } = stubDb({
      supportConversation: {
        findFirst: async () => AI_CONVERSATION,
        update: async () => ({}),
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          rec.updateManys.push(a);
          return { count: 1 };
        },
      },
    });
    const { responder } = stubResponder(null); // Ollama is off.
    const svc = new SupportService(db, null, responder);

    await svc.postAsMember('u1', 'c1', 'hello?', undefined);
    await settled(() => rec.updateManys.length > 0);

    // No ai turn, no system line — the requester is never shown the model's absence…
    expect(rec.messages.filter((m) => m['authorKind'] !== 'member')).toHaveLength(0);
    // …the mode flips so a person picks it up…
    expect(rec.updateManys[0]?.where).toMatchObject({ id: 'c1', handledBy: 'ai' });
    expect(rec.updateManys[0]?.data).toEqual({ handledBy: 'officer' });
    // …and nothing bumped the clocks, so the requester's own message is what lights the badge.
    expect(rec.updateManys[0]?.data).not.toHaveProperty('lastMessageAt');
  });

  it('MANDATORY: no responder wired at all behaves the same as Wave 1 — everything goes to people', async () => {
    // The AI module absent entirely: conversations still start, and stay answerable.
    const { db, rec } = stubDb();
    const svc = new SupportService(db, null, null);

    await svc.startForMember('u1', undefined, 'hello');
    await new Promise((r) => setTimeout(r, 20));

    expect(rec.conversations).toHaveLength(1);
    expect(rec.messages.filter((m) => m['authorKind'] === 'ai')).toHaveLength(0);
  });
});

describe('the waiting badge counts conversations that are a PERSON\'s to answer', () => {
  it("MANDATORY: the query itself narrows to handledBy 'officer' — AI-handled rows never reach the count", async () => {
    const { db, rec } = stubDb();
    const svc = new SupportService(db, null, null);

    await svc.consoleBadge();

    // Narrowed in the WHERE, not filtered after: an AI-handled conversation is not "waiting".
    expect(rec.findManyWheres[0]).toMatchObject({ status: 'open', handledBy: 'officer' });
  });

  it('still counts by the officer high-water mark, unchanged from Wave 1', async () => {
    const old = new Date(Date.now() - 60_000);
    const { db } = stubDb({
      supportConversation: {
        findMany: async () => [
          { lastMessageAt: new Date(), officerSeenAt: old }, // words since the last look
          { lastMessageAt: old, officerSeenAt: new Date() }, // looked at since the last words
          { lastMessageAt: new Date(), officerSeenAt: null }, // never looked at
        ],
      },
    });

    await expect(new SupportService(db, null, null).consoleBadge()).resolves.toEqual({
      waiting: 2,
    });
  });
});

/** Records a conversation create the way the shared stub does — for overridden creates. */
function stubDbRec(rec: Recorded, a: { data: Record<string, unknown> }): void {
  rec.conversations.push(a.data);
}
