import { PrismaClient, withPrincipal, resolveVisibleCategoryIds, ANONYMOUS } from '@grims/db';
import type { AclPrincipal } from '@grims/db';
import type { PermissionService } from './permission.service.js';

/**
 * The ONLY sanctioned way to read an ACL-bearing model (INV-002).
 *
 * ★ WHY THIS DID NOT EXIST, AND WHY THAT WAS SERIOUS ★
 *
 * `withPrincipal` was written, correct, fails closed, and had a passing test —
 * and had ZERO callers. INV-002 says a query made on a member's behalf must not
 * return rows whose `viewPerm` their mask does not satisfy, *enforced in the
 * data layer*. Its test called the extension directly, which proves the
 * extension works when applied and says nothing at all about whether it is.
 *
 * So the invariant was reported as covered while nothing enforced it. Nothing
 * leaked, because every ACL-bearing table is still empty — but the first forum
 * category P2 creates would have been served unfiltered. Found by the P1 exit
 * panel, 2026-07-29 (finding P1-1).
 *
 * ★ EXPLICIT, NOT REQUEST-SCOPED ★
 *
 * The obvious alternative is a `Scope.REQUEST` provider, so every repository
 * silently receives a bound client. Rejected: request scoping cascades — every
 * class that injects it, and everything injecting those, becomes request-scoped
 * too — and it makes the binding invisible at the call site. A reader cannot
 * tell a filtered query from an unfiltered one, which is exactly the property
 * that let the gap survive the first time.
 *
 * Here the caller must name whose behalf it acts on. `forCaller(userId)` reads
 * as what it is, and `forSystem()` is a word you have to type deliberately.
 *
 * ★ THE PLAIN CLIENT IS STILL AVAILABLE, AND THAT IS FINE ★
 *
 * `PrismaClient` remains injectable for the ninety-odd models that carry no ACL.
 * What must not happen is an ACL-bearing model being read through it — which is
 * what `acl-usage.spec.ts` exists to prevent, statically, for code that does not
 * exist yet.
 */
/**
 * A Prisma client that provably went through `AclDbService`.
 *
 * ★ WHY A BRANDED TYPE AND NOT JUST A CONVENTION ★
 *
 * `acl-usage.spec.ts` catches an ACL-bearing model read through an INJECTED
 * client, statically, by name. It cannot tell whether a client received as a
 * PARAMETER is bound — and a service that takes `db: PrismaClient` and reads
 * `db.forumCategory` looks identical whether the caller passed a bound client or
 * the plain one.
 *
 * So the type carries the proof. A function declaring `db: AclBoundClient` cannot
 * be handed a raw `PrismaClient` — that is a compile error, not a review
 * comment. The brand is phantom: nothing is added at runtime, and the only way to
 * obtain one is from a method on this class.
 *
 * The static guard and this are complementary. The brand stops the wrong client
 * being PASSED; the guard stops an ACL model being read from an injected client
 * with no parameter involved at all.
 */
declare const aclBound: unique symbol;
export type AclBoundClient = PrismaClient & { readonly [aclBound]: true };

export class AclDbService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * A client bound to a member.
   *
   * `userId` undefined means an unauthenticated caller — which is a real
   * principal (`ANONYMOUS`, mask 0) and not an error. A public category has
   * `viewPerm = null` and stays visible; everything else does not.
   */
  async forCaller(userId: string | undefined): Promise<AclBoundClient> {
    if (userId === undefined) return this.#bind(ANONYMOUS);

    /*
     * The mask comes from the SESSION's user id, resolved server-side through
     * PermissionService — never from anything on the request. A caller who
     * could nominate their own mask would have a complete bypass with extra
     * steps, which is why `AclPrincipal.mask` is not something any handler
     * accepts as a parameter.
     */
    const mask = await this.permissions.effectiveMask(userId);
    return this.#bind({ userId, mask });
  }

  /**
   * A client that sees everything, for trusted background work.
   *
   * ★ NAMED SO IT CANNOT BE REACHED BY ACCIDENT ★
   *
   * The promotion engine reading activity across the whole squadron, and the
   * nightly reconciliation, legitimately operate across all members. That is a
   * different thing from a request, and it has to look different in the source.
   *
   * `reason` is required and is not decoration: it appears at every call site,
   * so a bypass cannot be introduced without writing down why. There is no
   * default value on purpose.
   */
  forSystem(reason: string): AclBoundClient {
    if (reason.trim() === '') {
      // A blank reason means somebody reached for this without thinking about
      // it, which is the only way this method becomes dangerous.
      throw new Error('forSystem() requires a reason — it bypasses every ACL.');
    }
    /*
     * Synchronous, unlike `forCaller`, and the asymmetry is real rather than an
     * oversight: a member binding must first READ (id, viewPerm) to resolve the
     * visible set, and a system binding has nothing to resolve because it sees
     * everything. Making this async to match would promise a database round trip
     * that does not happen.
     */
    return withPrincipal(this.prisma, { userId: null, mask: 0n, systemBypass: true }) as AclBoundClient;
  }

  /**
   * Resolves the visible-id sets and binds.
   *
   * ★ WHY THE IDS ARE RESOLVED HERE ★
   *
   * The ACL is a bitmask in `NUMERIC(40,0)`. Prisma cannot express a bitwise
   * predicate and Postgres has no bitwise operator for NUMERIC, so the visible
   * set is resolved first and the predicate becomes `id IN (...)`. That keeps
   * the filter in the DATABASE — counts, aggregates and `groupBy` are filtered
   * too, rather than rows being fetched and discarded in application code where
   * a count would still leak how many exist.
   *
   * One cheap read of (id, viewPerm) per binding. Forum categories number in
   * the dozens, not the millions.
   *
   * `KnowledgeChunk` is deliberately NOT resolved: it will hold millions of rows
   * at P8 and materialising every id would be absurd. With no entry in
   * `visibleIds` the extension's predicate matches nothing, so it fails CLOSED
   * until P8 gives it Postgres row-level security. A chunk table that returns
   * nothing is a P8 problem; one that returns everything is a breach.
   */
  /**
   * The category ids a caller may see, for the ONE place that cannot use the bound client.
   *
   * ★ WHY THIS IS EXPOSED AT ALL ★
   *
   * Full-text search needs `ts_rank` and the generated `search_tsv` column, which Prisma cannot
   * express — so it is `$queryRaw`, and a raw query BYPASSES the extension that silently protects
   * every other read in the forum.
   *
   * Rather than let the search service resolve visibility for itself — a second answer to "what can
   * this caller see", which is how two answers drift apart — it asks here, and the SAME resolver
   * that feeds the extension's predicate feeds the SQL.
   *
   * Named awkwardly on purpose. `visibleCategoryIdsFor` is not a thing to reach for casually, and a
   * reader who finds it in a new file should ask why that file cannot use the bound client instead.
   */
  async visibleCategoryIdsFor(userId: string | undefined): Promise<string[]> {
    const mask = userId === undefined ? 0n : await this.permissions.effectiveMask(userId);
    return [...(await resolveVisibleCategoryIds(this.prisma, mask))];
  }

  async #bind(base: AclPrincipal): Promise<AclBoundClient> {
    const visibleIds = {
      ForumCategory: await resolveVisibleCategoryIds(this.prisma, base.mask),
    };

    /*
     * The single cast that mints the brand. Everything downstream is checked by
     * the compiler from here, which is why this is the only one.
     */
    return withPrincipal(this.prisma, { ...base, visibleIds }) as AclBoundClient;
  }
}
