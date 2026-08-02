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
  /*
   * Ship builds from the Shipyard. Same column, different vocabulary: a build is
   * `private`, `squadron` or `public`, where a Loadout is `squadron` or `officer`.
   *
   * Registered the moment the column was added, because `assertAclModelsRegistered`
   * failed the build — which is the whole point of that check. The service methods
   * that read these already filter, and this is the layer that holds for the ones
   * that do not exist yet.
   */
  ShipBuild: 'visibility',
  /*
   * Colonisation projects. The same `private | squadron | public` vocabulary as ShipBuild, and
   * registered here for the same reason: the column exists, so `assertAclModelsRegistered` would
   * fail the build otherwise — which is exactly what that check is for.
   *
   * ★ THE PUBLIC VALUE IS NARROWER THAN IT LOOKS ★
   *
   * Squadron owner, 2026-08-02: "Squadron projects members-only, personal projects publishable by
   * choice." So `public` is only ever legitimate on a `personal` project. That is a rule about
   * WRITES and is enforced in the service, not here — this layer's job is to make sure no reader
   * ever sees a row its visibility forbids, whatever put the value there.
   */
  ColonyProject: 'visibility',
  /*
   * ForumThread carries no ACL COLUMN of its own — it inherits its category's, and
   * is listed here because two things now modify that inheritance in both
   * directions:
   *
   *   isPublic         NARROWS. An anonymous visitor needs the category public AND
   *                    the thread published.
   *   ForumThreadGrant WIDENS. A named user sees one thread inside a category they
   *                    cannot otherwise see.
   *
   * The value below names the inheritance rather than a column, because there is no
   * column to name. Nothing reads these values — `predicateFor` switches on the KEY
   * — so an honest description beats a plausible-looking column that does not exist.
   */
  ForumThread: 'categoryId (inherited) + isPublic + ForumThreadGrant',
  /*
   * The grant rows themselves. Registered because WHO can read a thread is
   * information about that thread: a list of five officers' handles against a thread
   * id tells an outsider the thread exists and who is discussing it, without ever
   * reading a word of it.
   *
   * `GrantService.list` already gates on thread visibility before selecting these,
   * so nothing today is exposed. This is here for the route that does not exist yet
   * — the audit screen, the moderation export, the AI tool — because "the caller
   * checked first" is precisely the guarantee INV-002 declines to rely on.
   */
  ForumThreadGrant: 'inherited from thread',
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
    case 'ForumThreadGrant': {
      /*
       * Reuses the ForumThread predicate through a relation filter, rather than
       * restating it.
       *
       * ★ REUSED, NOT REIMPLEMENTED, DELIBERATELY ★
       *
       * A second copy of "which threads can this principal see" would be a second
       * thing to keep in step, and the copy that drifts is always the one nobody is
       * looking at. Nesting the same object under `thread` means a change to thread
       * visibility applies here automatically — including the fail-closed branch.
       *
       * Note the recursion is one level and terminates: ForumThread's own case never
       * refers back to ForumThreadGrant as a MODEL, only to its `grants` relation.
       */
      return { thread: predicateFor('ForumThread', p) };
    }
    case 'ForumThread': {
      /*
       * ★ NO ID SET, AND THAT IS THE IMPORTANT PART ★
       *
       * ForumCategory resolves to a set of ids because its ACL is a bitmask in a
       * NUMERIC column and neither Prisma nor Postgres can express a bitwise
       * predicate. Threads must NOT be handled that way: categories number in the
       * tens, threads grow without limit, and materialising every visible thread id
       * on every request would get slower for the rest of the project's life.
       *
       * It does not need to. The bitwise work was already done when the category
       * set was resolved, so the thread predicate is expressible as ordinary SQL —
       * an `IN` over the visible categories, plus an `EXISTS` over the grant table.
       * Both are indexed (`forum_threads_category_id…`, `forum_thread_grants_user_id_idx`).
       *
       * ★ FAIL CLOSED FIRST ★
       */
      const cats = p.visibleIds?.['ForumCategory'];
      if (cats === undefined) {
        // No resolved category set means we cannot prove anything about any thread.
        // Returning `{}` here would match every thread in the forum.
        return { id: { in: [] } };
      }
      const visibleCats = [...cats];

      if (p.userId === null) {
        /*
         * ★ ANONYMOUS: BOTH CONDITIONS, NEVER EITHER ★
         *
         * The category must be publicly viewable AND the thread published. Written
         * as a single object — an implicit AND — rather than an `AND: [...]`, so
         * there is no shape here that could be mistaken for the `OR` below.
         *
         * This is the narrowing direction, and it is why `isPublic` cannot leak an
         * officers' thread: `visibleCats` for an anonymous principal contains only
         * categories whose viewPerm is NULL, so ticking `isPublic` on a thread in a
         * gated category widens nothing at all.
         *
         * Note there is no grant clause. A grant names a USER, and an anonymous
         * caller is not one — checking grants here would mean trusting an
         * unauthenticated request to tell us who it is.
         */
        return { categoryId: { in: visibleCats }, isPublic: true };
      }

      /*
       * ★ SIGNED IN: INHERITED ACCESS *OR* AN EXPLICIT GRANT ★
       *
       * `isPublic` deliberately plays no part. It governs the OPEN INTERNET, not
       * members — a member who can see the board can read its drafts, which is what
       * a members' board is for. Applying it here would hide every unpublished guide
       * from the people writing them.
       */
      return {
        OR: [
          { categoryId: { in: visibleCats } },
          /*
           * The widening clause. `some` compiles to an EXISTS correlated subquery,
           * so this costs an index probe rather than a join fan-out, and a thread
           * with fifty grants still returns once.
           *
           * Scoped to `p.userId` and nothing else: a grant is per-person, so there
           * is no aggregate here that could accidentally match a thread granted to
           * somebody else.
           */
          { grants: { some: { userId: p.userId } } },
        ],
      };
    }
    case 'ShipBuild': {
      /*
       * ★ PUBLIC MEANS PUBLIC, INCLUDING TO NOBODY ★
       *
       * Squadron owner, 2026-08-01: "the public page must also be visible along
       * with the builds in them to anyone not signed in."
       *
       * So `public` needs no mask and no session. `squadron` needs a signed-in
       * reader — any of them; there is no rank to it — which is what a non-null
       * userId means here. `private` is the author's alone.
       *
       * Ownership is part of the ACL rather than a check bolted on top: a member
       * always sees their own build whatever its visibility, which is what makes
       * "my builds" work without a bypass.
       */
      const or: object[] = [{ visibility: 'public' }];
      if (p.userId !== null) {
        or.push({ visibility: 'squadron' });
        or.push({ submittedById: p.userId });
      }
      return { OR: or };
    }
    case 'ColonyProject': {
      /*
       * ★ THE SAME SHAPE AS ShipBuild, AND FOR THE SAME REASONS ★
       *
       * Squadron owner, 2026-08-02: "Squadron projects members-only, personal
       * projects publishable by choice."
       *
       * `public` needs no session — that is what publishing a personal project
       * means. `squadron` needs a signed-in reader, any of them. `private` is the
       * poster's alone, and ownership is IN the predicate rather than checked on
       * top, so a member always sees their own project whatever its visibility.
       *
       * The rule that only a PERSONAL project may be public is about writes, and
       * lives in the service. This layer holds whatever value is in the column —
       * which is the correct division: if a bug ever set `public` on a squadron
       * project, the fix belongs at the write, and having this layer quietly
       * disagree with the stored value would hide it instead.
       */
      const or: object[] = [{ visibility: 'public' }];
      if (p.userId !== null) {
        or.push({ visibility: 'squadron' });
        or.push({ postedById: p.userId });
      }
      return { OR: or };
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
export function withPrincipal<T>(prisma: T, principal: AclPrincipal): T {
  /*
   * ★ THE CONSTRAINT USED TO BE `T extends { $extends: (args: unknown) => unknown }`
   *   AND THE REAL CLIENT DID NOT SATISFY IT ★
   *
   * Prisma's `$extends` is an overloaded callable object, and a parameter typed
   * `unknown` is not assignable to its specific argument type — so passing an
   * actual `PrismaClient` failed to compile. The signature was only ever
   * exercised by tests passing a hand-written stub, which satisfied it easily.
   * That is a large part of why this function had no callers: the first person
   * to try wiring it hit a type error and had nothing to compare against.
   *
   * `T` is now unconstrained and the narrowing happens HERE, once, where it can
   * be explained — rather than as a cast at every call site, which is where a
   * cast stops being read.
   */
  const extendable = prisma as unknown as { $extends: (args: unknown) => unknown };
  return extendable.$extends({
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
  /*
   * ★ `unknown` RATHER THAN A HAND-WRITTEN SHAPE, FOR THE SAME REASON AS
   *   `withPrincipal` ★
   *
   * This used to declare `{ forumCategory: { findMany: (a: unknown) => ... } }`,
   * which a hand-written stub satisfies and a real `PrismaClient` does not —
   * Prisma's `findMany` takes a specific args type, and `unknown` is not
   * assignable to it. So this compiled against its test and not against the
   * application, which is a large part of why it had no callers.
   *
   * Narrowed inside, once. The row shape IS asserted below rather than trusted:
   * `viewPerm` arrives as a Prisma `Decimal` and the conversion goes through
   * `toFixed(0)` because `Number(decimal)` would lose precision above 2^53 —
   * and the mask is NUMERIC(40,0) precisely because it exceeds 64 bits.
   */
  prisma: unknown,
  mask: bigint,
): Promise<ReadonlySet<string>> {
  const db = prisma as {
    forumCategory: {
      findMany: (a: { select: { id: true; viewPerm: true } }) => Promise<
        Array<{ id: string; viewPerm: { toFixed: (n: number) => string } | null }>
      >;
    };
  };
  const rows = await db.forumCategory.findMany({ select: { id: true, viewPerm: true } });
  const out = new Set<string>();
  for (const r of rows) {
    const required = r.viewPerm === null ? null : BigInt(r.viewPerm.toFixed(0));
    if (satisfies(mask, required)) out.add(r.id);
  }
  return out;
}
