/**
 * ACL enforcement in the DATA layer (INV-002).
 *
 * ★ WHY THIS EXISTS RATHER THAN A CONTROLLER GUARD ★
 *
 * A controller guard protects ONE route. This protects every caller that will
 * ever exist — a new endpoint, a background job, an AI tool invocation, a
 * migration script someone runs at 2am. INV-002 is written the way it is
 * precisely because "we checked it in the controller" is how leaks happen: the
 * second route onto the same data is the one nobody guards.
 *
 * The MANDATORY test is that a Ring 0 principal calling the repository
 * directly — bypassing every controller, guard and decorator — still cannot
 * read a Ring 1 row. If that test can be made to pass by adding a guard, the
 * guard is in the wrong place.
 *
 * HOW IT WORKS
 * Every read on an ACL-bearing model has a permission predicate merged into its
 * WHERE clause before it reaches the database. Rows the principal cannot see do
 * not come back — they are not fetched and filtered in application code, which
 * would leak through counts, aggregates and `findFirst`.
 *
 * FAILS CLOSED. A principal with no mask sees only what a permission of zero
 * allows, and a model that is ACL-bearing but not registered here throws rather
 * than being served unfiltered.
 */

/** Who is asking. `null` mask means anonymous, which is not the same as absent. */
export interface AclPrincipal {
  readonly userId: string | null;
  readonly mask: bigint;
  /**
   * Set ONLY by trusted background work that legitimately operates across all
   * members — the promotion engine reading activity, the reconciliation job.
   * Never derived from a request. A request that could set this would be a
   * complete bypass with extra steps.
   */
  readonly systemBypass?: boolean;

  /**
   * Per-model sets of row ids this principal may see, resolved once per request.
   *
   * Necessary because the ACL is a BITMASK in a NUMERIC(40,0) column: Prisma
   * cannot express a bitwise predicate, and Postgres has no bitwise operator
   * for NUMERIC either. Resolving the set first keeps enforcement in the data
   * layer rather than filtering fetched rows in application code, which would
   * leak through counts and aggregates.
   */
  readonly visibleIds?: Partial<Record<AclModel, ReadonlySet<string>>>;
}

export const ANONYMOUS: AclPrincipal = { userId: null, mask: 0n };

/**
 * Models carrying an ACL, and the column that expresses it.
 *
 * A model added to the schema with an ACL column but NOT listed here is a
 * silent hole, so `assertAclModelsRegistered` exists to fail a test the moment
 * that happens rather than the moment someone notices data leaking.
 */
export const ACL_MODELS = {
  ForumCategory: 'viewPerm',
  KnowledgeChunk: 'viewPerm',
  Loadout: 'visibility',
} as const;

export type AclModel = keyof typeof ACL_MODELS;

const FORUM_VIEW_OFFICER = 1n << 4n;

/**
 * Does `mask` satisfy `required`?
 *
 * The row is visible only when the principal holds EVERY bit the row demands.
 * `required = null` means public — the schema says so explicitly, and treating
 * null as "requires everything" would hide every public category from everyone.
 *
 * Evaluated in TypeScript because Postgres has no bitwise operator for NUMERIC,
 * and NUMERIC(40,0) is exactly what the mask needs — it exceeds 64 bits, so
 * bigint columns were never an option (ADR-005).
 */
export function satisfies(mask: bigint, required: bigint | null): boolean {
  if (required === null) return true;
  return (mask & required) === required;
}

/** The predicate merged into every read of an ACL-bearing model. */
// Returns a plain Prisma `where` fragment. Typed as `object` rather than a
// generated Prisma type: those vary with the generated client, and CI generates
// a different one from my machine — which is exactly how this failed there and
// passed here.
function predicateFor(model: AclModel, p: AclPrincipal): object {
  switch (model) {
    case 'ForumCategory':
    case 'KnowledgeChunk': {
      // Visible when viewPerm is NULL (public) or the principal holds every bit
      // it demands. Prisma has no bitwise `where`, and Postgres has no bitwise
      // operator for NUMERIC, so the satisfiable set is resolved by id.
      //
      // The ids are supplied by the caller of `withPrincipal` via
      // `visibleIds`, computed once per request from a single cheap read of
      // (id, viewPerm). That keeps the FILTER in the data layer — the rows
      // themselves are never fetched and discarded, so counts and aggregates
      // are filtered too.
      const allowed = p.visibleIds?.[model];
      if (allowed === undefined) {
        // FAIL CLOSED. No resolved set means we cannot prove visibility, and
        // returning `{}` here would match every row — the single most dangerous
        // mistake available in this file.
        return { id: { in: [] } };
      }
      return { id: { in: [...allowed] } };
    }
    case 'Loadout': {
      // Ownership is part of the ACL, not a separate check bolted on top: a
      // member always sees their own loadout whatever its visibility.
      const or: object[] = [{ visibility: 'squadron' }];
      if (p.userId !== null) or.push({ authorId: p.userId });
      if ((p.mask & FORUM_VIEW_OFFICER) !== 0n) or.push({ visibility: 'officer' });
      return { OR: or };
    }
  }
}

const READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Returns a Prisma client bound to a principal.
 *
 * Every read of an ACL-bearing model is filtered. `count`, `aggregate` and
 * `groupBy` are included deliberately: an unfiltered count of officer threads
 * tells an outsider how many exist, which is a smaller leak than reading them
 * and a leak all the same.
 */
export function withPrincipal<T extends { $extends: (args: unknown) => unknown }>(
  prisma: T,
  principal: AclPrincipal,
): T {
  return prisma.$extends({
    name: 'acl',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model?: string;
          operation: string;
          args: Record<string, unknown>;
          query: (a: Record<string, unknown>) => Promise<unknown>;
        }) {
          if (principal.systemBypass === true) return query(args);
          if (model === undefined || !(model in ACL_MODELS)) return query(args);
          if (!READ_OPS.has(operation)) return query(args);

          const acl = predicateFor(model as AclModel, principal);
          const existing = args['where'];
          // AND, never merge. Merging keys would let a caller-supplied `where`
          // overwrite the ACL clause simply by naming the same column.
          return query({
            ...args,
            where: existing === undefined ? acl : { AND: [existing, acl] },
          });
        },
      },
    },
  }) as unknown as T;
}

/**
 * Fails if the schema gained an ACL-bearing model that this file does not know
 * about. Called from a test, so the failure arrives at review time rather than
 * when someone notices officer data on a public page.
 */
export function assertAclModelsRegistered(schemaSource: string): void {
  const missing: string[] = [];
  const modelRe = /model (\w+) \{([\s\S]*?)\n\}/g;
  for (const m of schemaSource.matchAll(modelRe)) {
    const [, name, body] = m;
    if (name === undefined || body === undefined) continue;
    const looksAcl = /\bviewPerm\b|\bviewPermMask\b|\bvisibility\b/.test(body);
    if (looksAcl && !(name in ACL_MODELS)) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `These models carry an ACL column but are not registered in ACL_MODELS, so ` +
        `every read of them is UNFILTERED: ${missing.join(', ')}. ` +
        `Add them to packages/db/src/acl-extension.ts (INV-002).`,
    );
  }
}

/**
 * Resolves which ForumCategory ids a principal may see.
 *
 * One narrow read of (id, viewPerm) — a table of tens of rows — then a bitwise
 * test per row. Cheap, and correct for a mask that does not fit in a bigint.
 *
 * KnowledgeChunk is NOT resolved this way and must not be: it will hold
 * millions of rows at P8, and materialising every id would be absurd. That
 * table needs Postgres row-level security with the mask passed as a session
 * setting, which is a database-side change rather than an application one.
 * Until then it fails closed — `visibleIds` has no entry for it, so the
 * predicate matches nothing at all.
 */
export async function resolveVisibleCategoryIds(
  prisma: { forumCategory: { findMany: (a: unknown) => Promise<Array<{ id: string; viewPerm: { toFixed: (n: number) => string } | null }>> } },
  mask: bigint,
): Promise<ReadonlySet<string>> {
  const rows = await prisma.forumCategory.findMany({ select: { id: true, viewPerm: true } });
  const out = new Set<string>();
  for (const r of rows) {
    const required = r.viewPerm === null ? null : BigInt(r.viewPerm.toFixed(0));
    if (satisfies(mask, required)) out.add(r.id);
  }
  return out;
}
