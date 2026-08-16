import { describe, expect, it } from 'vitest';
import { Permission } from '@grims/shared';
import { withPrincipal, type AclPrincipal } from './acl-extension.js';

/**
 * Who can see a build the squadron gave up on (INV-002).
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "abandond projects should be hidden to all other members except the project owner please."
 *
 * ★ WHY THIS IS TESTED AT THE PREDICATE AND NOT ON RETURNED ROWS ★
 *
 * The same reason `thread-visibility.spec.ts` is: a rule applied AFTER fetching leaks through
 * `count`, `aggregate` and `groupBy` even when the row list looks right. A member who cannot see an
 * abandoned project must also not be able to learn it exists from a total that is one larger than
 * the list they were shown.
 *
 * So these read the `where` clause that actually reaches the database.
 *
 * ★ THE SPECIFIC MISTAKE BEING GUARDED AGAINST ★
 *
 * Folding the abandonment test into the visibility OR list. It reads as the obvious simplification
 * — one list instead of two — and it is a leak: `visibility: 'public'` would then satisfy the
 * abandonment clause on its own, and every abandoned public build would be readable by anybody,
 * signed in or not.
 */

/** Captures the args the extension hands to the underlying query. */
function capturing(): {
  client: unknown;
  seen: () => Record<string, unknown> | undefined;
} {
  let captured: Record<string, unknown> | undefined;

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
        colonyProject: {
          findMany: (callerArgs: Record<string, unknown> = {}) =>
            run({
              model: 'ColonyProject',
              operation: 'findMany',
              args: callerArgs,
              query: async (finalArgs) => {
                captured = finalArgs;
                return [];
              },
            }),
        },
      };
    },
  };

  return { client, seen: () => captured };
}

async function whereFor(principal: AclPrincipal): Promise<Record<string, unknown>> {
  const { client, seen } = capturing();
  const bound = withPrincipal(client, principal) as {
    colonyProject: { findMany: (a?: Record<string, unknown>) => Promise<unknown> };
  };
  await bound.colonyProject.findMany({});
  return (seen()?.['where'] ?? {}) as Record<string, unknown>;
}

/** The clause list that decides abandonment, dug out of the AND the predicate builds. */
function abandonClause(where: Record<string, unknown>): unknown[] {
  const and = where['AND'] as Array<Record<string, unknown>> | undefined;
  if (and === undefined) return [];
  const found = and.find((c) => {
    const or = c['OR'] as Array<Record<string, unknown>> | undefined;
    return or?.some((x) => 'abandonedAt' in x) === true;
  });
  return (found?.['OR'] as unknown[] | undefined) ?? [];
}

const member: AclPrincipal = { userId: 'member-1', mask: 0n };
const officer: AclPrincipal = { userId: 'officer-1', mask: Permission.COLONY_MANAGE };
const anonymous: AclPrincipal = { userId: null, mask: 0n };

describe('the abandonment clause reaches the database', () => {
  it('★ MANDATORY: an ordinary member only ever matches unabandoned projects, or their own ★', async () => {
    const clause = abandonClause(await whereFor(member));

    expect(clause).toContainEqual({ abandonedAt: null });
    expect(clause).toContainEqual({ postedById: 'member-1' });
    expect(
      clause,
      'nothing here may match an abandoned project the member did not post',
    ).not.toContainEqual({ abandonedAt: { not: null } });
  });

  it('★ MANDATORY: an officer can see them ★', async () => {
    const clause = abandonClause(await whereFor(officer));

    expect(clause).toContainEqual({ abandonedAt: { not: null } });
  });

  it('★ MANDATORY: an anonymous reader gets no escape hatch at all ★', async () => {
    /*
     * `public` is a member choosing to share a build they are working on. Giving up on it is not a
     * decision to publish that fact to the internet.
     */
    const clause = abandonClause(await whereFor(anonymous));

    expect(clause).toEqual([{ abandonedAt: null }]);
  });

  it('★ MANDATORY: the abandonment test is ANDed, never merged into the visibility list ★', async () => {
    /*
     * THE LEAK THIS FILE EXISTS FOR.
     *
     * One OR list containing both `{ visibility: 'public' }` and `{ abandonedAt: null }` is
     * satisfied by a public project REGARDLESS of whether it was abandoned. It looks like a tidy
     * simplification and it opens every abandoned public build to everybody.
     */
    const where = await whereFor(member);
    const and = where['AND'] as Array<Record<string, unknown>> | undefined;

    expect(and, 'the two questions must be separate clauses').toBeDefined();
    expect(and).toHaveLength(2);

    const visibility = and?.find((c) => {
      const or = c['OR'] as Array<Record<string, unknown>> | undefined;
      return or?.some((x) => 'visibility' in x) === true;
    });
    const visibilityOr = (visibility?.['OR'] ?? []) as Array<Record<string, unknown>>;

    expect(
      visibilityOr.some((x) => 'abandonedAt' in x),
      'abandonment must not appear in the visibility list',
    ).toBe(false);
  });

  it('MANDATORY: an unrelated permission is not enough', async () => {
    // Guards against the mask test being written as "has any permission", which would show
    // abandoned builds to every member holding any role at all.
    const clause = abandonClause(
      await whereFor({ userId: 'member-2', mask: Permission.FORUM_POST_MEMBER }),
    );

    expect(clause).not.toContainEqual({ abandonedAt: { not: null } });
  });
});
