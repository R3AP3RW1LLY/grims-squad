import { describe, it, expect } from 'vitest';
import { withPrincipal, type AclPrincipal } from './acl-extension.js';

/**
 * Who can see which thread (INV-002).
 *
 * ★ WHY THIS FILE IS SEPARATE FROM acl-extension.int.spec.ts ★
 *
 * ForumThread is the only ACL-governed model whose visibility moves in BOTH
 * directions, and the two directions have opposite failure modes:
 *
 *   isPublic          NARROWS. Broken open ⇒ the internet reads a members' thread.
 *   ForumThreadGrant  WIDENS.  Broken open ⇒ a member reads the officers' board.
 *
 * A widening rule is the more dangerous of the two — it is the only thing in the
 * forum that lets somebody past a category ACL they do not satisfy — so it gets the
 * larger share of the assertions below.
 *
 * ★ THESE ASSERT ON THE WHERE CLAUSE THAT REACHES THE DATABASE ★
 *
 * Not on rows returned by a stub. The property that matters is that the predicate is
 * attached BEFORE the query runs, because a rule applied after fetching leaks
 * through `count`, `aggregate` and `groupBy` even when the row list looks right.
 * So the stub records what it was asked and the tests read that.
 */

/** Captures the args the extension hands to the underlying query. */
function capturing(): {
  client: unknown;
  seen: () => Record<string, unknown> | undefined;
} {
  let captured: Record<string, unknown> | undefined;

  /*
   * A stand-in for `$extends`. The real client's version is an overloaded callable
   * whose argument type is not `unknown`, which is exactly the mismatch that left
   * `withPrincipal` uncallable for weeks — so this stub deliberately mimics the
   * SHAPE the extension uses rather than pretending to be a PrismaClient.
   */
  const client = {
    $extends(args: unknown) {
      const a = args as {
        query: {
          $allModels: {
            $allOperations: (ctx: {
              model?: string;
              operation: string;
              args: Record<string, unknown>;
              query: (x: Record<string, unknown>) => Promise<unknown>;
            }) => Promise<unknown>;
          };
        };
      };
      const run = a.query.$allModels.$allOperations;
      return {
        forumThread: {
          findMany: (callerArgs: Record<string, unknown> = {}) =>
            run({
              model: 'ForumThread',
              operation: 'findMany',
              args: callerArgs,
              query: async (finalArgs) => {
                captured = finalArgs;
                return [];
              },
            }),
          count: (callerArgs: Record<string, unknown> = {}) =>
            run({
              model: 'ForumThread',
              operation: 'count',
              args: callerArgs,
              query: async (finalArgs) => {
                captured = finalArgs;
                return 0;
              },
            }),
        },
      };
    },
  };

  return { client, seen: () => captured };
}

/** The `where` the database would actually receive for `findMany`. */
async function whereFor(
  principal: AclPrincipal,
  callerArgs: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { client, seen } = capturing();
  const bound = withPrincipal(client, principal) as {
    forumThread: { findMany: (a?: Record<string, unknown>) => Promise<unknown> };
  };
  await bound.forumThread.findMany(callerArgs);
  return (seen()?.['where'] ?? {}) as Record<string, unknown>;
}

const PUBLIC_CAT = 'cat-public';
const MEMBERS_CAT = 'cat-members';

/** Signed in, sees the public and members boards, NOT the officers board. */
const member: AclPrincipal = {
  userId: 'user-1',
  mask: 0n,
  visibleIds: { ForumCategory: new Set([PUBLIC_CAT, MEMBERS_CAT]) },
};

/** Not signed in. Sees only the public board. */
const anon: AclPrincipal = {
  userId: null,
  mask: 0n,
  visibleIds: { ForumCategory: new Set([PUBLIC_CAT]) },
};

describe('an anonymous visitor', () => {
  it('MANDATORY @INV-002: needs the category public AND the thread published', async () => {
    const where = await whereFor(anon);

    // Both conditions in one object — an implicit AND. Asserted as an exact shape
    // because "either" instead of "both" is the entire bug this guards against, and
    // it would be invisible in a test that only checked `isPublic` was mentioned.
    expect(where).toEqual({ categoryId: { in: [PUBLIC_CAT] }, isPublic: true });
  });

  it('MANDATORY @INV-002: is never offered a grant clause', async () => {
    /*
     * A grant names a USER. Consulting grants for an unauthenticated caller would
     * mean trusting the request to say who it is — and `userId: null` is not a user,
     * so a `{ userId: null }` grant lookup could match a row where the column was
     * somehow null rather than matching nobody.
     */
    expect(JSON.stringify(await whereFor(anon))).not.toContain('grants');
  });

  it('MANDATORY: isPublic cannot reach a category it does not already have', async () => {
    /*
     * ★ THE NARROWING DIRECTION, PROVEN ★
     *
     * The officers board is absent from `visibleIds`, so no value of `isPublic` on
     * any thread can surface it: the predicate constrains categoryId to the resolved
     * set first. This is why `isPublic` was designed to narrow rather than override
     * — an officer cannot publish an officers' thread to the internet by ticking a
     * box.
     */
    const where = await whereFor(anon);
    expect((where['categoryId'] as { in: string[] }).in).not.toContain('cat-officers');
    expect((where['categoryId'] as { in: string[] }).in).toEqual([PUBLIC_CAT]);
  });
});

describe('a signed-in member', () => {
  it('MANDATORY @INV-002: sees inherited categories OR an explicit grant', async () => {
    const where = await whereFor(member);

    expect(where).toEqual({
      OR: [
        { categoryId: { in: [PUBLIC_CAT, MEMBERS_CAT] } },
        { grants: { some: { userId: 'user-1' } } },
      ],
    });
  });

  it('MANDATORY: the grant clause is scoped to THIS user and nothing else', async () => {
    /*
     * The one clause in the forum that widens access past a category ACL. If it ever
     * matched on thread alone — `{ grants: { some: {} } }` — then granting one
     * person access would show the thread to everybody, and the symptom would be
     * indistinguishable from "the grant worked".
     */
    const where = await whereFor(member);
    const or = where['OR'] as Array<Record<string, unknown>>;
    const grantClause = or.find((c) => 'grants' in c);

    expect(grantClause).toEqual({ grants: { some: { userId: 'user-1' } } });
  });

  it('is NOT filtered by isPublic', async () => {
    // isPublic governs the open internet. Applying it to members would hide every
    // unpublished guide from the people writing it.
    expect(JSON.stringify(await whereFor(member))).not.toContain('isPublic');
  });
});

describe('failing closed', () => {
  it('MANDATORY @INV-002: no resolved category set matches NOTHING', async () => {
    /*
     * The most dangerous line available in the ACL file is a bare `return {}` on
     * this path: it matches every row. A principal with no resolved set must see an
     * empty forum, not the whole one.
     */
    const where = await whereFor({ userId: 'user-1', mask: 0n });
    expect(where).toEqual({ id: { in: [] } });
  });

  it('MANDATORY: an empty visible-category set still yields a grant path, not everything', async () => {
    // An empty SET is different from an ABSENT set: the resolution ran and found
    // nothing inherited. A grant may still apply, and nothing else may.
    const where = await whereFor({
      userId: 'user-1',
      mask: 0n,
      visibleIds: { ForumCategory: new Set() },
    });
    expect(where).toEqual({
      OR: [{ categoryId: { in: [] } }, { grants: { some: { userId: 'user-1' } } }],
    });
  });
});

describe('a caller-supplied where cannot displace the ACL', () => {
  it('MANDATORY @INV-002: the two are ANDed, never merged', async () => {
    /*
     * Merging keys would let a caller reopen the forum by naming the same column —
     * `where: { categoryId: { in: ['cat-officers'] } }` would simply overwrite the
     * ACL clause. ANDing makes a hostile `where` narrower, never wider.
     */
    const where = await whereFor(member, {
      where: { categoryId: { in: ['cat-officers'] } },
    });

    expect(where['AND']).toBeDefined();
    const [caller, acl] = where['AND'] as Array<Record<string, unknown>>;
    expect(caller).toEqual({ categoryId: { in: ['cat-officers'] } });
    expect(acl).toEqual({
      OR: [
        { categoryId: { in: [PUBLIC_CAT, MEMBERS_CAT] } },
        { grants: { some: { userId: 'user-1' } } },
      ],
    });
  });

  it('MANDATORY @INV-002: count is filtered too', async () => {
    /*
     * An unfiltered count of officer threads tells an outsider how many exist. That
     * is a smaller leak than reading them and a leak all the same — and it is the
     * one that survives a review focused on "can they read the rows".
     */
    const { client, seen } = capturing();
    const bound = withPrincipal(client, anon) as {
      forumThread: { count: (a?: Record<string, unknown>) => Promise<unknown> };
    };
    await bound.forumThread.count();

    expect(seen()?.['where']).toEqual({
      categoryId: { in: [PUBLIC_CAT] },
      isPublic: true,
    });
  });
});

describe('the system bypass', () => {
  it('is not reachable from a request-derived principal', async () => {
    /*
     * `systemBypass` exists for the promotion engine and the reconciliation job.
     * Asserted here because ForumThread is now the model with the most to lose from
     * it: a request that could set this would read the officers' board unfiltered.
     *
     * The guarantee is structural rather than checked at runtime — nothing that
     * parses a request constructs an AclPrincipal — so what this pins is that the
     * flag does what it says, and `acl-usage.spec.ts` pins that every caller of
     * `forSystem` states a reason.
     */
    const where = await whereFor({ userId: null, mask: 0n, systemBypass: true });
    expect(where).toEqual({});
  });
});
