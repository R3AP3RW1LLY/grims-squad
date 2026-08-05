import { describe, it, expect, vi } from 'vitest';
import { ErrorCode, Permission } from '@grims/shared';
import { RecruitmentService } from './recruitment.service.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * The recruitment tracker (P2.7).
 *
 * ★ THE SCOPE WAS A DECISION, NOT AN OMISSION ★
 *
 * Owner: "In-app tracks, Inara/in-game stay primary." So applications arrive through Inara and the
 * in-game squadron screen — as the joining guides say — and this records and works them.
 *
 * That is why there is no test for a public form or for Turnstile. P2.7's acceptance lists both,
 * and both describe a front door the owner deliberately did not want; building them would have
 * contradicted the guides just approved. The parts of that acceptance which apply either way are
 * each covered below and labelled.
 */

const RECRUITER = Permission.MEMBER_MANAGE;

function stubDb(over: Record<string, unknown> = {}) {
  const audit: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const db = {
    user: { findUnique: async () => ({ id: 'u1', handle: 'newcmdr' }) },
    application: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: vi.fn(async () => ({ id: 'app-1', state: 'submitted' })),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        updates.push(a.data);
        return {};
      }),
      groupBy: async () => [],
    },
    auditLog: {
      create: (a: { data: Record<string, unknown> }) => {
        audit.push(a.data);
        return a;
      },
    },
    $transaction: async (ops: unknown[]) => ops,
    ...over,
  };

  return { db: db as unknown as AclBoundClient, audit, updates };
}

describe('a duplicate is refused WITH ITS CURRENT STATUS', () => {
  it('MANDATORY @P2.7: names the state, not just "duplicate"', async () => {
    /*
     * The "with its status" half is the useful part. An officer recording somebody who applied last
     * week should be told "already interviewing" — which answers their next question — rather than
     * "duplicate", which sends them to go and look.
     */
    const { db } = stubDb({
      application: {
        findUnique: async () => ({ id: 'app-1', state: 'interviewing' }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });

    await expect(
      new RecruitmentService().record(db, 'u1', {}, 'officer-1', RECRUITER),
    ).rejects.toThrow(/already has an application, currently "interviewing"/);
  });

  it('a REJECTED application does not bar a reapplication', async () => {
    /*
     * People reapply. A permanent bar from one rejection is not a policy anybody chose, and it would
     * be an odd one to arrive at by accident through a uniqueness check.
     */
    const recorded: Array<Record<string, unknown>> = [];
    const { db } = stubDb({
      application: {
        findUnique: async () => ({ id: 'app-1', state: 'rejected' }),
        create: vi.fn(),
        update: vi.fn(async (a: { data: Record<string, unknown> }) => {
          recorded.push(a.data);
          return { id: 'app-1', state: 'submitted' };
        }),
      },
    });

    await expect(
      new RecruitmentService().record(db, 'u1', { whyUs: 'again' }, 'officer-1', RECRUITER),
    ).resolves.toMatchObject({ state: 'submitted' });

    // And it starts CLEAN: the old decision is history, not a live fact.
    expect(recorded[0]).toMatchObject({ decidedById: null, decidedAt: null, probationEndsAt: null });
  });
});

describe('approval sets probation to decidedAt + 30 days', () => {
  it('MANDATORY @P2.7: exactly thirty days, computed from the decision', async () => {
    const { db } = stubDb({
      application: {
        findUnique: async () => ({ id: 'app-1', state: 'interviewing', userId: 'u1' }),
        update: vi.fn(async () => ({})),
      },
    });

    const before = Date.now();
    const out = await new RecruitmentService().decide(
      db,
      'app-1',
      'approved',
      'Good fit',
      'officer-1',
      RECRUITER,
    );

    expect(out.probationEndsAt).not.toBeNull();
    const days = (new Date(out.probationEndsAt as string).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('a REJECTION sets no probation', async () => {
    const { db } = stubDb({
      application: {
        findUnique: async () => ({ id: 'app-1', state: 'submitted', userId: 'u1' }),
        update: vi.fn(async () => ({})),
      },
    });

    const out = await new RecruitmentService().decide(
      db,
      'app-1',
      'rejected',
      'Not now',
      'officer-1',
      RECRUITER,
    );
    expect(out.probationEndsAt).toBeNull();
  });

  it('moving to INTERVIEWING records no decider — it is progress, not a verdict', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const { db } = stubDb({
      application: {
        findUnique: async () => ({ id: 'app-1', state: 'submitted', userId: 'u1' }),
        update: vi.fn(async (a: { data: Record<string, unknown> }) => {
          recorded.push(a.data);
          return {};
        }),
      },
    });

    await new RecruitmentService().decide(db, 'app-1', 'interviewing', null, 'officer-1', RECRUITER);
    expect(recorded[0]).not.toHaveProperty('decidedById');
  });
});

describe('the ownership predicate', () => {
  it('MANDATORY @P2.7: ownership is in the WHERE clause, not a check afterwards', async () => {
    /*
     * P2.7 says another applicant's returns "404, not 403". A 403 confirms the other application
     * exists — and confirming that a named person applied is exactly what an applicant should not be
     * able to find out.
     *
     * Making ownership part of the query means "not yours" and "not there" take the same path and
     * therefore give the same answer. Asserted on the WHERE, because that is the difference.
     */
    const findFirst = vi.fn(async () => null);
    const { db } = stubDb({ application: { findFirst } });

    const result = await new RecruitmentService().mine(db, 'me');

    expect(result).toBeNull();

    /*
     * Read through a typed helper rather than indexing `mock.calls[0]?.[0]`.
     *
     * A `vi.fn` with no declared parameters infers an EMPTY TUPLE, so index 0 does not exist on it
     * and the strict typecheck refuses it (TS2493) — invisible to `vitest run`, which is why CI
     * caught this class of thing before and the memory says to run `pnpm typecheck`.
     */
    const call = findFirst.mock.calls[0] as unknown as [{ where: { userId: string } }] | undefined;
    expect(call?.[0]).toMatchObject({ where: { userId: 'me' } });
  });

  it('MANDATORY: an applicant is never told WHICH officer decided', async () => {
    /*
     * An applicant learning who rejected them turns a squadron decision into a personal one. The
     * officer-facing queue carries it; this does not.
     */
    const { db } = stubDb({
      application: {
        findFirst: async () => ({
          id: 'app-1',
          userId: 'me',
          state: 'rejected',
          createdAt: new Date(),
          decidedAt: new Date(),
          probationEndsAt: null,
          user: { handle: 'me', displayName: 'Me' },
          decidedBy: { handle: 'officerwhosaidno' },
        }),
      },
    });

    const mine = await new RecruitmentService().mine(db, 'me');
    expect(mine?.decidedByHandle).toBeNull();
    expect(JSON.stringify(mine)).not.toContain('officerwhosaidno');
  });
});

describe('every decision is audited (INV-009)', () => {
  it('MANDATORY: a decision writes an audit row with real before/after', async () => {
    const { db, audit } = stubDb({
      application: {
        findUnique: async () => ({ id: 'app-1', state: 'submitted', userId: 'u1' }),
        update: vi.fn(async () => ({})),
      },
    });

    await new RecruitmentService().decide(
      db,
      'app-1',
      'approved',
      'Good fit',
      'officer-1',
      RECRUITER,
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: 'officer-1',
      action: 'recruitment.approved',
      targetType: 'application',
      before: { state: 'submitted' },
    });
    expect((audit[0]?.['after'] as { state: string }).state).toBe('approved');
  });

  it('a decided application is not silently re-decided', async () => {
    /*
     * Reopening is legitimate — an appeal, a mistake — but it should start from `record`, so the
     * history shows a new application rather than a state that changed twice with no explanation.
     */
    const { db } = stubDb({
      application: {
        findUnique: async () => ({ id: 'app-1', state: 'approved', userId: 'u1' }),
        update: vi.fn(),
      },
    });

    await expect(
      new RecruitmentService().decide(db, 'app-1', 'rejected', 'changed', 'officer-1', RECRUITER),
    ).rejects.toThrow(/already "approved"/);
  });
});

describe('the funnel', () => {
  it('MANDATORY: no decisions yet reports NULL, not 0%', async () => {
    /*
     * 0% and "nothing decided yet" mean completely different things to whoever reads it, and showing
     * the first for the second makes recruitment look broken on the day it starts.
     */
    const { db } = stubDb({
      application: { groupBy: async () => [{ state: 'submitted', _count: { state: 3 } }] },
    });

    const report = await new RecruitmentService().funnel(db, RECRUITER);
    expect(report.submitted).toBe(3);
    expect(report.approvalRate).toBeNull();
  });

  it('computes a rate once there are decisions', async () => {
    const { db } = stubDb({
      application: {
        groupBy: async () => [
          { state: 'approved', _count: { state: 3 } },
          { state: 'rejected', _count: { state: 1 } },
        ],
      },
    });

    const report = await new RecruitmentService().funnel(db, RECRUITER);
    expect(report.approvalRate).toBe(0.75);
  });
});

describe('only a recruiter', () => {
  it('MANDATORY: every officer-facing method refuses without MEMBER_MANAGE', async () => {
    const svc = new RecruitmentService();
    const { db } = stubDb();

    for (const [name, run] of [
      ['record', () => svc.record(db, 'u1', {}, 'x', 0n)],
      ['decide', () => svc.decide(db, 'app-1', 'approved', null, 'x', 0n)],
      ['queue', () => svc.queue(db, 0n)],
      ['funnel', () => svc.funnel(db, 0n)],
    ] as const) {
      await expect(run(), name).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    }
  });

  it('but an applicant can read their OWN without it', async () => {
    // `mine` is deliberately ungated: it is scoped to the caller by the query itself.
    const { db } = stubDb();
    await expect(new RecruitmentService().mine(db, 'me')).resolves.toBeNull();
  });
});
