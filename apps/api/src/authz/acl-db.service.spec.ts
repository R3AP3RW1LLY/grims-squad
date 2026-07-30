import { describe, it, expect, beforeEach } from 'vitest';
import { AclDbService } from './acl-db.service.js';

/**
 * INV-002, tested through the APPLICATION's binding rather than the extension.
 *
 * ★ WHY THIS FILE EXISTS AT ALL ★
 *
 * INV-002 was already "covered". Its test — `packages/db/acl-extension.int.spec.ts`
 * — calls `withPrincipal` directly and asserts the predicate filters. That test
 * is correct and it proved the wrong thing: it demonstrates the extension works
 * WHEN APPLIED, and says nothing about whether anything applies it. Nothing did.
 * `withPrincipal` had zero callers in `apps/` while the invariant was reported
 * as met.
 *
 * So this test starts from the thing a route would actually hold — an
 * `AclDbService` — and asserts the client it hands back is filtered. If somebody
 * later deletes the binding inside `AclDbService`, the extension's own test still
 * passes and THIS one fails, which is the whole point.
 *
 * ★ WHY A FAKE CLIENT RATHER THAN A REAL DATABASE ★
 *
 * `withPrincipal` merges a `where` fragment into the args before they reach
 * Prisma. What must be asserted is that the fragment IS THERE, and a fake client
 * that records the args it received shows that directly. A real database would
 * demonstrate the same thing through row counts, one abstraction further away,
 * and `acl-extension.int.spec.ts` already does that against real Postgres.
 *
 * The two tests are complementary and neither is redundant: that one proves the
 * predicate is correct SQL, this one proves the application puts it there.
 */

/** Records what Prisma was asked, so the merged predicate can be inspected. */
function fakePrisma(categories: Array<{ id: string; viewPerm: bigint | null }>) {
  const seen: Array<{ model: string; op: string; args: unknown }> = [];

  const client = {
    seen,
    /*
     * `$extends` is implemented the way Prisma's is: it returns a NEW client
     * whose reads pass through the supplied `query` hooks. Hand-rolled because
     * the point is to observe what the hooks did to the args.
     */
    $extends(ext: {
      query: { $allModels: { $allOperations: (o: unknown) => unknown } };
    }) {
      const hook = ext.query.$allModels.$allOperations;
      const call = (model: string, op: string) => async (args: unknown) =>
        hook({
          model,
          operation: op,
          args,
          query: async (finalArgs: unknown) => {
            seen.push({ model, op, args: finalArgs });
            return [];
          },
        });

      return {
        seen,
        forumCategory: {
          findMany: call('ForumCategory', 'findMany'),
          count: call('ForumCategory', 'count'),
        },
        knowledgeChunk: { findMany: call('KnowledgeChunk', 'findMany') },
        loadout: { findMany: call('Loadout', 'findMany') },
        // A model with NO acl. Must pass through untouched.
        user: { findMany: call('User', 'findMany') },
      };
    },
    // What `resolveVisibleCategoryIds` reads to build the visible set.
    forumCategory: {
      findMany: async () =>
        categories.map((c) => ({
          id: c.id,
          viewPerm:
            c.viewPerm === null ? null : { toFixed: () => c.viewPerm!.toString() },
        })),
    },
  };

  return client;
}

const OFFICER_BIT = 1n << 4n;

/** Only ever asked for a mask; never for anything else. */
const permissions = (mask: bigint) => ({ effectiveMask: async () => mask });

const CATEGORIES = [
  { id: 'public-cat', viewPerm: null },
  { id: 'officer-cat', viewPerm: OFFICER_BIT },
];

/** The `where` the extension merged in, for the model under test. */
function whereFor(seen: Array<{ model: string; args: unknown }>, model: string): unknown {
  const row = seen.find((s) => s.model === model);
  return (row?.args as { where?: unknown } | undefined)?.where;
}

describe('INV-002 — the application binds the data-layer ACL', () => {
  let prisma: ReturnType<typeof fakePrisma>;

  beforeEach(() => {
    prisma = fakePrisma(CATEGORIES);
  });

  it('MANDATORY @INV-002: a Ring 0 caller cannot read a Ring 1 category', async () => {
    const svc = new AclDbService(prisma as never, permissions(0n) as never);
    const db = (await svc.forCaller('ring-0-member')) as unknown as {
      forumCategory: { findMany: (a: unknown) => Promise<unknown> };
      seen: Array<{ model: string; args: unknown }>;
    };

    await db.forumCategory.findMany({});

    /*
     * The public category is visible and the officer one is not. Asserted on the
     * predicate rather than on returned rows, because that is where enforcement
     * lives — filtering after the fetch would still leak through `count`.
     */
    expect(whereFor(db.seen, 'ForumCategory')).toEqual({ id: { in: ['public-cat'] } });
  });

  it('MANDATORY @INV-002: an officer CAN read the Ring 1 category', async () => {
    // The mirror case. Without it, a binding that filtered everything to nothing
    // would pass the test above while breaking the product.
    const svc = new AclDbService(prisma as never, permissions(OFFICER_BIT) as never);
    const db = (await svc.forCaller('officer')) as unknown as {
      forumCategory: { findMany: (a: unknown) => Promise<unknown> };
      seen: Array<{ model: string; args: unknown }>;
    };

    await db.forumCategory.findMany({});

    const where = whereFor(db.seen, 'ForumCategory') as { id: { in: string[] } };
    expect([...where.id.in].sort()).toEqual(['officer-cat', 'public-cat']);
  });

  it('MANDATORY @INV-002: count is filtered too, not just findMany', async () => {
    // An unfiltered count of officer categories tells an outsider how many
    // exist. A smaller leak than reading them, and a leak all the same.
    const svc = new AclDbService(prisma as never, permissions(0n) as never);
    const db = (await svc.forCaller('ring-0-member')) as unknown as {
      forumCategory: { count: (a: unknown) => Promise<unknown> };
      seen: Array<{ model: string; args: unknown }>;
    };

    await db.forumCategory.count({});

    expect(whereFor(db.seen, 'ForumCategory')).toEqual({ id: { in: ['public-cat'] } });
  });

  it('MANDATORY @INV-002: an anonymous caller gets the anonymous principal, not a bypass', async () => {
    const svc = new AclDbService(prisma as never, permissions(0n) as never);
    const db = (await svc.forCaller(undefined)) as unknown as {
      forumCategory: { findMany: (a: unknown) => Promise<unknown> };
      seen: Array<{ model: string; args: unknown }>;
    };

    await db.forumCategory.findMany({});

    expect(whereFor(db.seen, 'ForumCategory')).toEqual({ id: { in: ['public-cat'] } });
  });

  /*
   * ★ THE FAIL-CLOSED CASE THAT MATTERS MOST AT P8 ★
   *
   * KnowledgeChunk is deliberately never resolved — it will hold millions of
   * rows. With no entry in `visibleIds` the extension must match NOTHING. A
   * table that returns nothing is a P8 problem to solve with row-level security;
   * one that returns everything is a breach.
   */
  it('MANDATORY @INV-002: an unresolved ACL model fails CLOSED, matching no rows', async () => {
    const svc = new AclDbService(prisma as never, permissions(OFFICER_BIT) as never);
    const db = (await svc.forCaller('officer')) as unknown as {
      knowledgeChunk: { findMany: (a: unknown) => Promise<unknown> };
      seen: Array<{ model: string; args: unknown }>;
    };

    await db.knowledgeChunk.findMany({});

    expect(whereFor(db.seen, 'KnowledgeChunk')).toEqual({ id: { in: [] } });
  });

  it('leaves a model with no ACL untouched', async () => {
    // The binding must not quietly filter the ninety-odd models that carry no
    // ACL, or every ordinary query would silently return nothing.
    const svc = new AclDbService(prisma as never, permissions(0n) as never);
    const db = (await svc.forCaller('member')) as unknown as {
      user: { findMany: (a: unknown) => Promise<unknown> };
      seen: Array<{ model: string; args: unknown }>;
    };

    await db.user.findMany({ where: { handle: 'grim' } });

    expect(whereFor(db.seen, 'User')).toEqual({ handle: 'grim' });
  });

  describe('forSystem', () => {
    it('refuses a blank reason', () => {
      const svc = new AclDbService(prisma as never, permissions(0n) as never);
      expect(() => svc.forSystem('')).toThrow(/reason/i);
      expect(() => svc.forSystem('   ')).toThrow(/reason/i);
    });

    it('accepts a stated reason', () => {
      const svc = new AclDbService(prisma as never, permissions(0n) as never);
      expect(() => svc.forSystem('promotion engine reads activity for every member')).not.toThrow();
    });

    /*
     * ★ THE FAILURE THIS CATCHES IS SILENT AND BACKWARDS ★
     *
     * `forSystem` passes `systemBypass: true` and NO `visibleIds`. The extension
     * honours the bypass and returns unfiltered — but if that check were ever
     * removed, the missing `visibleIds` would make the predicate `{ id: { in: [] } }`
     * and every background job would quietly read NOTHING. The promotion engine
     * would report zero eligible members and look like it was working.
     *
     * So the bypass is asserted directly rather than trusted.
     */
    it('MANDATORY @INV-002: a system client is genuinely unfiltered, not filtered to nothing', async () => {
      const svc = new AclDbService(prisma as never, permissions(0n) as never);
      const db = svc.forSystem('promotion engine reads activity for every member') as unknown as {
        forumCategory: { findMany: (a: unknown) => Promise<unknown> };
        seen: Array<{ model: string; args: unknown }>;
      };

      await db.forumCategory.findMany({ where: { slug: 'ops' } });

      // The caller's own `where` survives untouched, and no id filter is added.
      expect(whereFor(db.seen, 'ForumCategory')).toEqual({ slug: 'ops' });
    });
  });
});
