import { describe, it, expect } from 'vitest';
import { Permission, ErrorCode } from '@grims/shared';
import { GrantService } from './grant.service.js';

/**
 * Who the @mention autocomplete is allowed to offer.
 *
 * ★ THE RULE, AND WHY IT IS NOT "EVERYBODY" ★
 *
 * Mentioning somebody who cannot read the thread does NOTHING: the notification fan-out re-checks
 * the mask at send time (INV-039), so the mention is dropped. On the officers' board that is the
 * normal case for most of the roster — so an autocomplete over everybody would spend most of its
 * suggestions on people who will never be told, and the author would never learn why.
 *
 * ★ AND WHY IT IS NOT GATED ON FORUM_MODERATE ★
 *
 * The GRANT autocomplete requires it, because handing somebody access is an admin act. Mentioning
 * is what every member does. The check that does apply is the one that makes the grant service
 * safe: the thread is read through the caller's own bound client, so a thread you cannot see
 * cannot be used to enumerate who can.
 */

const OFFICER = Permission.FORUM_VIEW_OFFICER;

/** Prisma hands back Decimal; only `.toFixed(0)` is safe on it (exponential at 1e21). */
const dec = (v: bigint) => ({ toFixed: () => v.toString() });

function client(opts: {
  /** Null models a thread the caller cannot see: the bound client simply returns nothing. */
  categoryViewPerm?: bigint | null;
  threadVisible?: boolean;
  users?: Array<{
    id: string;
    handle: string;
    displayName: string | null;
    mask: bigint;
    granted?: boolean;
    avatarStoredHash?: string | null;
  }>;
}) {
  const users = opts.users ?? [];
  let lastTake: number | undefined;

  return {
    get lastTake() {
      return lastTake;
    },
    forumThread: {
      findFirst: async () =>
        opts.threadVisible === false
          ? null
          : {
              id: 't1',
              category: {
                viewPerm:
                  opts.categoryViewPerm === undefined || opts.categoryViewPerm === null
                    ? null
                    : dec(opts.categoryViewPerm),
              },
            },
    },
    user: {
      findMany: async ({ take }: { take?: number }) => {
        lastTake = take;
        return users.map((u) => ({
          id: u.id,
          handle: u.handle,
          displayName: u.displayName,
          avatarStoredHash: u.avatarStoredHash ?? null,
          userRoles: [{ role: { permMask: dec(u.mask) } }],
          threadGrantsReceived: u.granted === true ? [{ threadId: 't1' }] : [],
        }));
      },
    },
  };
}

const ROSTER = [
  { id: 'u-off', handle: 'officer_one', displayName: 'Officer One', mask: OFFICER },
  { id: 'u-mem', handle: 'member_one', displayName: 'Member One', mask: 0n },
  { id: 'u-granted', handle: 'guest_one', displayName: 'Guest One', mask: 0n, granted: true },
];

describe('mention candidates', () => {
  describe('who is offered', () => {
    it('MANDATORY: on a restricted board, only people who can read it', async () => {
      const svc = new GrantService();
      const out = await svc.mentionCandidates(client({ categoryViewPerm: OFFICER, users: ROSTER }) as never, 't1', 'one');

      expect(out.map((c) => c.handle).sort()).toEqual(['guest_one', 'officer_one']);
    });

    it('MANDATORY: a per-thread grant is enough, without the category permission', async () => {
      /*
       * The grant system is the one thing in the forum that WIDENS access. Somebody invited to
       * read a specific officers' thread must be mentionable in it — otherwise the invitation
       * works for reading and silently fails for being addressed.
       */
      const svc = new GrantService();
      const out = await svc.mentionCandidates(
        client({ categoryViewPerm: OFFICER, users: [ROSTER[2]!] }) as never,
        't1',
        'guest',
      );
      expect(out).toHaveLength(1);
    });

    it('on an open board, everybody found is offered', async () => {
      const svc = new GrantService();
      const out = await svc.mentionCandidates(client({ categoryViewPerm: null, users: ROSTER }) as never, 't1', 'one');
      expect(out).toHaveLength(3);
    });
  });

  describe('what it will not do', () => {
    it('MANDATORY: a thread the caller cannot see is a 404, not an empty list', async () => {
      /*
       * Cloaked, matching every other forum read. An empty list would be a different answer from
       * "no such thread" and would confirm the thread exists to anybody who compared them.
       */
      const svc = new GrantService();
      await expect(
        svc.mentionCandidates(client({ threadVisible: false }) as never, 't1', 'one'),
      ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_VISIBLE });
    });

    it('MANDATORY: a one-character query searches nothing', async () => {
      // A single letter matches most of a 107-member roster. Refused before the query runs, so
      // holding down a key cannot turn the autocomplete into a roster dump.
      const svc = new GrantService();
      const db = client({ users: ROSTER });
      expect(await svc.mentionCandidates(db as never, 't1', 'o')).toEqual([]);
      expect(db.lastTake).toBeUndefined();
    });

    it('MANDATORY: results are capped', async () => {
      const svc = new GrantService();
      const db = client({ users: ROSTER });
      await svc.mentionCandidates(db as never, 't1', 'one');
      expect(db.lastTake).toBe(10);
    });
  });

  describe('what it returns', () => {
    it('carries an avatar path on our own API, or null', async () => {
      const svc = new GrantService();
      const out = await svc.mentionCandidates(
        client({
          users: [
            { id: 'u-a', handle: 'a_one', displayName: 'A', mask: 0n, avatarStoredHash: 'h' },
            { id: 'u-b', handle: 'b_one', displayName: 'B', mask: 0n },
          ],
        }) as never,
        't1',
        'one',
      );

      expect(out.find((c) => c.handle === 'a_one')?.avatarUrl).toBe('/v1/media/avatars/u-a');
      expect(out.find((c) => c.handle === 'b_one')?.avatarUrl).toBeNull();
    });

    it('MANDATORY: never carries a permission mask', async () => {
      /*
       * The mask is READ here to decide visibility and must not leave. Shipping it would tell any
       * member exactly which bit they are missing — a map of the permission model, handed out
       * through an autocomplete.
       */
      const svc = new GrantService();
      const out = await svc.mentionCandidates(client({ users: ROSTER }) as never, 't1', 'one');

      for (const c of out) {
        expect(Object.keys(c)).toEqual(
          expect.arrayContaining(['userId', 'handle', 'displayName', 'alreadyHasAccess']),
        );
        expect(JSON.stringify(c)).not.toContain('permMask');
        expect(Object.keys(c)).not.toContain('mask');
        expect(Object.keys(c)).not.toContain('userRoles');
      }
    });
  });
});
