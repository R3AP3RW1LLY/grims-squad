import { describe, it, expect, vi } from 'vitest';
import { NotifyService } from './notify.service.js';
import { GatedDiscordDm, parseAllowlist, replyDmText } from './discord-dm.port.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Notification fan-out (INV-039).
 *
 * ★ THE INVARIANT'S OWN TEST, WRITTEN AS IT IS SPECIFIED ★
 *
 * "subscribe as a member, move the thread to an officer category, post a reply; assert no
 * notification row, no Discord DM and no WebSocket event for that member."
 *
 * That scenario is the first test below, in those steps, because an invariant whose test is
 * paraphrased tends to end up testing something adjacent to it.
 *
 * The red-team note on INV-039 is why this needs its own suite: *fan-out is not "on behalf of a
 * user", so INV-002 does not reach it.* The data-layer ACL protects reads made for one principal.
 * Fan-out is one row and many recipients — so the check is here, per recipient, or nowhere.
 */

const FORUM_VIEW_MEMBER = (1n << 2n).toString();
const FORUM_VIEW_OFFICER = (1n << 4n).toString();

const dec = (v: string) => ({ toFixed: () => v });

interface FakeSub {
  userId: string;
  status?: string;
  roles: string[];
  discordId?: string | null;
  notifyForumDm?: boolean;
  level?: string;
}

/**
 * A stub bound client. Models the two reads fan-out makes: the thread with its CURRENT category,
 * and the subscriptions.
 */
function stubDb(opts: {
  categoryViewPerm: string | null;
  categoryId?: string;
  subs: FakeSub[];
  onCreateMany?: (args: { data: unknown[] }) => void;
  onDeleteMany?: (args: unknown) => void;
  threadMissing?: boolean;
}): AclBoundClient {
  return {
    forumThread: {
      findFirst: async () =>
        opts.threadMissing === true
          ? null
          : {
              id: 't1',
              categoryId: opts.categoryId ?? 'cat-1',
              category: {
                viewPerm: opts.categoryViewPerm === null ? null : dec(opts.categoryViewPerm),
              },
            },
    },
    forumCategory: {
      findFirst: async () => ({
        viewPerm: opts.categoryViewPerm === null ? null : dec(opts.categoryViewPerm),
      }),
    },
    forumSubscription: {
      findMany: async () =>
        opts.subs
          .filter((s) => (s.level ?? 'watching') !== 'muted')
          .map((s) => ({
            userId: s.userId,
            user: {
              id: s.userId,
              status: s.status ?? 'active',
              denyMask: dec('0'),
              notifyForumDm: s.notifyForumDm ?? false,
              userRoles: s.roles.map((r) => ({ role: { permMask: dec(r) } })),
              discordIdentity:
                s.discordId === undefined || s.discordId === null
                  ? null
                  : { discordId: s.discordId },
            },
          })),
      deleteMany: vi.fn(async (args: unknown) => {
        opts.onDeleteMany?.(args);
        return { count: 0 };
      }),
    },
    notification: {
      createMany: vi.fn(async (args: { data: unknown[] }) => {
        opts.onCreateMany?.(args);
        return { count: args.data.length };
      }),
    },
  } as unknown as AclBoundClient;
}

const target = {
  threadId: 't1',
  threadTitle: 'Disciplinary: CMDR Smith',
  categorySlug: 'officers',
  threadSlug: 'disciplinary-cmdr-smith',
  actorId: 'officer-1',
};

describe('INV-039 — the invariant’s own scenario', () => {
  it('MANDATORY @INV-039: a member loses notifications when the thread moves to an officer board', async () => {
    /*
     * ★ THE LEAK, CONCRETELY ★
     *
     * The notification carries the thread TITLE. "Disciplinary: CMDR Smith" has already said the
     * thing before anybody clicks the link — so it is not enough to make the LINK 404 for them.
     *
     * Step 1: a member holding FORUM_VIEW_MEMBER is subscribed.
     * Step 2: the thread now sits in a category demanding FORUM_VIEW_OFFICER.
     * Step 3: fan-out runs.
     */
    const created: unknown[] = [];
    const db = stubDb({
      categoryViewPerm: FORUM_VIEW_OFFICER,
      subs: [{ userId: 'member-1', roles: [FORUM_VIEW_MEMBER], discordId: '123', notifyForumDm: true }],
      onCreateMany: (a) => created.push(...a.data),
    });

    const svc = new NotifyService();
    const recipients = await svc.recipientsFor(db, target);

    // No recipient at all — which is what makes the other three assertions true.
    expect(recipients).toEqual([]);

    const written = await svc.writeInApp(db, recipients, target);
    expect(written).toBe(0);
    // No notification row.
    expect(created).toEqual([]);
    // And nothing for a DM sender to be asked about.
    expect(recipients.filter((r) => r.wantsDiscordDm)).toEqual([]);
  });

  it('MANDATORY: an officer on the same thread DOES still get it', async () => {
    // The other half. A check that excluded everybody would pass the test above and be useless.
    const db = stubDb({
      categoryViewPerm: FORUM_VIEW_OFFICER,
      subs: [{ userId: 'officer-2', roles: [FORUM_VIEW_OFFICER] }],
    });

    const recipients = await new NotifyService().recipientsFor(db, target);
    expect(recipients.map((r) => r.userId)).toEqual(['officer-2']);
  });

  it('MANDATORY: the CURRENT category is read, never taken from the caller', async () => {
    /*
     * The whole failure mode is a thread that has MOVED since somebody subscribed. A caller passing
     * the category would be supplying the very thing under test, so `recipientsFor` reads it — and
     * `FanOutTarget` deliberately has no category permission field to pass.
     */
    const findFirst = vi.fn(async () => ({
      id: 't1',
      categoryId: 'cat-1',
      category: { viewPerm: dec(FORUM_VIEW_OFFICER) },
    }));
    const db = { ...stubDb({ categoryViewPerm: FORUM_VIEW_OFFICER, subs: [] }) } as Record<string, unknown>;
    db['forumThread'] = { findFirst };

    await new NotifyService().recipientsFor(db as unknown as AclBoundClient, target);
    expect(findFirst).toHaveBeenCalledOnce();

    const keys = Object.keys(target);
    expect(keys).not.toContain('viewPerm');
    expect(keys).not.toContain('categoryId');
  });
});

describe('the re-check uses CURRENT state, not the subscription', () => {
  it('MANDATORY: a banned account is excluded', async () => {
    /*
     * `computeEffectiveMask` returns NO_PERMISSIONS for any non-active status, so this needs no
     * separate condition — which is the point of that function being the one place status is
     * decided. Asserted anyway, because "it falls out of another function" is exactly the kind of
     * guarantee that quietly stops being true.
     */
    for (const status of ['banned', 'inactive', 'left']) {
      const db = stubDb({
        categoryViewPerm: FORUM_VIEW_MEMBER,
        subs: [{ userId: 'gone', status, roles: [FORUM_VIEW_MEMBER] }],
      });
      const recipients = await new NotifyService().recipientsFor(db, target);
      expect(recipients, status).toEqual([]);
    }
  });

  it('MANDATORY: the actor is never notified about their own reply', async () => {
    const db = stubDb({
      categoryViewPerm: null,
      subs: [{ userId: 'officer-1', roles: [] }, { userId: 'other', roles: [] }],
    });
    const recipients = await new NotifyService().recipientsFor(db, target);
    expect(recipients.map((r) => r.userId)).toEqual(['other']);
  });

  it('a muted subscription receives nothing', async () => {
    const db = stubDb({
      categoryViewPerm: null,
      subs: [{ userId: 'quiet', roles: [], level: 'muted' }],
    });
    expect(await new NotifyService().recipientsFor(db, target)).toEqual([]);
  });

  it('a public board notifies everybody subscribed', async () => {
    const db = stubDb({
      categoryViewPerm: null,
      subs: [{ userId: 'a', roles: [] }, { userId: 'b', roles: [] }],
    });
    const recipients = await new NotifyService().recipientsFor(db, target);
    expect(recipients.map((r) => r.userId).sort()).toEqual(['a', 'b']);
  });

  it('a deleted thread notifies nobody rather than throwing', async () => {
    // A reply and a delete can race. Throwing would fail the reply for the person who made it.
    const db = stubDb({ categoryViewPerm: null, subs: [{ userId: 'a', roles: [] }], threadMissing: true });
    expect(await new NotifyService().recipientsFor(db, target)).toEqual([]);
  });
});

describe('Discord DMs require BOTH a link and an opt-in', () => {
  it('MANDATORY: no opt-in means in-app only', async () => {
    /*
     * A DM lands in somebody's private inbox. Inferring consent from "they linked Discord to sign
     * in" would be putting words in their mouth — they linked it to authenticate.
     */
    const db = stubDb({
      categoryViewPerm: null,
      subs: [{ userId: 'a', roles: [], discordId: '123', notifyForumDm: false }],
    });
    const [r] = await new NotifyService().recipientsFor(db, target);
    expect(r?.wantsDiscordDm).toBe(false);
  });

  it('MANDATORY: opted in but no linked Discord means in-app only', async () => {
    const db = stubDb({
      categoryViewPerm: null,
      subs: [{ userId: 'a', roles: [], discordId: null, notifyForumDm: true }],
    });
    const [r] = await new NotifyService().recipientsFor(db, target);
    expect(r?.wantsDiscordDm).toBe(false);
  });

  it('both present means a DM is wanted', async () => {
    const db = stubDb({
      categoryViewPerm: null,
      subs: [{ userId: 'a', roles: [], discordId: '123', notifyForumDm: true }],
    });
    const [r] = await new NotifyService().recipientsFor(db, target);
    expect(r?.wantsDiscordDm).toBe(true);
    expect(r?.discordId).toBe('123');
  });
});

describe('pruneOnMove — the second half of INV-039', () => {
  it('MANDATORY: removes subscribers the destination excludes', async () => {
    let deleted: unknown = null;
    const db = stubDb({
      categoryViewPerm: FORUM_VIEW_OFFICER,
      subs: [
        { userId: 'member-1', roles: [FORUM_VIEW_MEMBER] },
        { userId: 'officer-2', roles: [FORUM_VIEW_OFFICER] },
      ],
      onDeleteMany: (a) => {
        deleted = a;
      },
    });

    const removed = await new NotifyService().pruneOnMove(db, 't1', 'cat-officers');

    expect(removed).toBe(1);
    expect(deleted).toEqual({ where: { threadId: 't1', userId: { in: ['member-1'] } } });
  });

  it('MANDATORY: a PUBLIC destination prunes nobody, and does not even look', async () => {
    /*
     * A public board excludes nobody, so reading every subscriber's roles to discover that would be
     * work done to reach a foregone conclusion — on the path of an operation an officer is waiting
     * for.
     */
    const findMany = vi.fn();
    const db = { ...stubDb({ categoryViewPerm: null, subs: [] }) } as Record<string, unknown>;
    db['forumSubscription'] = { findMany, deleteMany: vi.fn() };

    const removed = await new NotifyService().pruneOnMove(db as unknown as AclBoundClient, 't1', 'cat-public');

    expect(removed).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns the count, so the mover can be told', async () => {
    // A silent prune means somebody loses a subscription with no idea why they stopped hearing.
    const db = stubDb({
      categoryViewPerm: FORUM_VIEW_OFFICER,
      subs: [
        { userId: 'a', roles: [] },
        { userId: 'b', roles: [] },
      ],
    });
    expect(await new NotifyService().pruneOnMove(db, 't1', 'cat-officers')).toBe(2);
  });
});

describe('the DM allowlist', () => {
  it('MANDATORY: absent means NOBODY, not everybody', async () => {
    /*
     * ★ THE ORDERING THAT MATTERS ★
     *
     * A sender defaulting to "everyone" and narrowed by config is one missing environment variable
     * away from DMing 107 people. This one defaults to silence and is widened deliberately.
     */
    for (const raw of [undefined, '', '   ']) {
      const { all, ids } = parseAllowlist(raw);
      expect(all, String(raw)).toBe(false);
      expect(ids.size, String(raw)).toBe(0);
    }
  });

  it('MANDATORY: an unlisted id is recorded, not sent', async () => {
    const fetchImpl = vi.fn();
    const sender = new GatedDiscordDm('token', '1262447044337864850', fetchImpl as unknown as typeof fetch);

    const attempt = await sender.send('999999999999999999', 'hello');

    expect(attempt.sent).toBe(false);
    expect(attempt.suppressedBecause).toMatch(/allowlist/i);
    // And crucially, no request was made at all.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('MANDATORY: the gate runs BEFORE any request is built', async () => {
    // A guard that runs after the request is built is one refactor from being skipped, and you
    // cannot unsend a DM to a hundred people.
    const fetchImpl = vi.fn();
    const sender = new GatedDiscordDm('token', undefined, fetchImpl as unknown as typeof fetch);

    await sender.send('1262447044337864850', 'hello');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends to a listed id, opening a channel with exactly one recipient', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body === undefined ? null : JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'chan-1' }),
      } as unknown as Response;
    });

    const sender = new GatedDiscordDm('token', '1262447044337864850', fetchImpl as unknown as typeof fetch);
    const attempt = await sender.send('1262447044337864850', 'hello');

    expect(attempt.sent).toBe(true);
    expect(calls[0]?.body).toEqual({ recipient_id: '1262447044337864850' });
    expect(calls[1]?.url).toContain('/channels/chan-1/messages');
  });

  it('`*` permits everybody, which is the production setting once somebody decides that', async () => {
    const { all } = parseAllowlist('*');
    expect(all).toBe(true);
  });

  it('ignores malformed entries rather than trusting them', async () => {
    const { ids } = parseAllowlist('1262447044337864850, not-an-id, 42, <@everyone>');
    expect([...ids]).toEqual(['1262447044337864850']);
  });

  it('records every attempt, which is the reviewable evidence', async () => {
    const sender = new GatedDiscordDm('token', '111111111111111111', undefined as unknown as typeof fetch);
    await sender.send('222222222222222222', 'one');
    await sender.send('333333333333333333', 'two');

    const attempts = sender.attempts();
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => !a.sent)).toBe(true);
    // The content is kept so the owner can see WHAT would have been sent, not just to whom.
    expect(attempts.map((a) => a.content)).toEqual(['one', 'two']);
  });

  it('a missing bot token suppresses rather than throwing', async () => {
    const sender = new GatedDiscordDm(undefined, '*');
    const attempt = await sender.send('111111111111111111', 'x');
    expect(attempt.sent).toBe(false);
    expect(attempt.suppressedBecause).toMatch(/token/i);
  });

  it('a Discord outage suppresses rather than failing the reply', async () => {
    /*
     * A notification that did not arrive by DM still exists in-app. Taking a reply request down
     * because Discord was briefly unreachable would be the wrong trade.
     */
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    const sender = new GatedDiscordDm('token', '*', fetchImpl as unknown as typeof fetch);

    const attempt = await sender.send('111111111111111111', 'x');
    expect(attempt.sent).toBe(false);
    expect(attempt.suppressedBecause).toMatch(/unreachable/i);
  });
});

describe('the DM text', () => {
  it('names the thread and links to it', () => {
    const text = replyDmText('How to join', '/guides/how-to-join', 'https://45-63-35-93.sslip.io');
    expect(text).toContain('How to join');
    expect(text).toContain('https://45-63-35-93.sslip.io/guides/how-to-join');
  });

  it('MANDATORY: does not name the member who replied (INV-048 habit)', () => {
    // A DM is not a broadcast, but the habit is worth keeping — and who replied is visible the
    // moment they open it.
    const text = replyDmText('A thread', '/x', 'https://example.test');
    expect(text).not.toMatch(/CMDR|replied by|from /i);
  });

  it('says why they received it and how to stop', () => {
    // A notification with no way to turn it off is the reason people mute bots entirely.
    const text = replyDmText('A thread', '/x', 'https://example.test');
    expect(text).toMatch(/watching/i);
    expect(text).toMatch(/Settings/);
  });
});
