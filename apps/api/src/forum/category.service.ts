import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Forum categories — the shape of the board, and who may see each part of it.
 *
 * ★ EVERY READ COMES FROM A BOUND CLIENT, NEVER `PrismaClient` ★
 *
 * The caller hands in a client already bound to a principal by `AclDbService`
 * (INV-002). This service never resolves permissions for a read and never
 * touches the plain client — `acl-usage.spec.ts` fails the build if it does.
 *
 * That is why "a Ring 0 user cannot see, COUNT, or infer a Ring 1 category" is
 * not a check written here: it is a property of the client that was passed in. A
 * check here would be a second place to get it wrong, and the first route onto
 * the data that forgot it would leak.
 *
 * ★ POSTING REQUIRES A DISCORD MEMBERSHIP — squadron owner, 2026-07-29 ★
 *
 * "all forum users must be in our discord." That is enforced structurally rather
 * than by a check in this file: the only way to hold an account is Discord OAuth
 * against the guild, and `ForumThread.authorId` / `ForumPost.authorId` are NOT
 * NULL with a required relation to `users`. There is no representation for an
 * anonymous author, so there is nothing to guard.
 *
 * Category VISIBILITY stays a per-category decision (`viewPerm`), because the
 * schema has always supported a public-readable category and removing that would
 * be a schema change made on an inference. Posting is the thing that requires
 * membership.
 */

/** A category as the caller is allowed to see it. */
export interface CategoryView {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly position: number;
  readonly isLocked: boolean;
  /** Whether THIS caller may start a thread here. Computed, never a raw mask. */
  readonly canPost: boolean;
}

export interface CategoryInput {
  readonly slug: string;
  readonly name: string;
  readonly description?: string | null;
  readonly parentId?: string | null;
  readonly viewPerm?: bigint | null;
  readonly postPerm?: bigint | null;
  readonly position?: number;
}

/**
 * The decimal columns come back as Prisma Decimal; this is the one conversion.
 *
 * Via `toFixed(0)`, never `Number(...)`. The mask is NUMERIC(40,0) precisely
 * because it exceeds 64 bits, and a JS number would silently lose the high bits
 * — which reads as a permission check quietly passing.
 */
function maskOf(v: { toFixed: (n: number) => string } | null): bigint | null {
  return v === null ? null : BigInt(v.toFixed(0));
}

/** Does `mask` hold every bit `required` demands? A null requirement is public. */
export function satisfiesMask(mask: bigint, required: bigint | null): boolean {
  if (required === null) return true;
  return (mask & required) === required;
}

/**
 * Is `child` at least as restrictive as `parent`?
 *
 * ★ A CHILD CANNOT BE MORE PERMISSIVE THAN ITS PARENT ★
 *
 * Otherwise an officers-only parent could hold a public child, and that child
 * would be readable by anybody who guessed its slug — while the tree it hangs
 * from says the whole branch is private. The category LIST would be filtered
 * correctly and the direct URL would not, which is the worst combination: it
 * looks right on the page that people check.
 *
 * "At least as restrictive" means the child demands EVERY bit the parent does,
 * and may demand more. A null parent is public and accepts any child. A null
 * child under a non-null parent is strictly more permissive, and is refused.
 */
export function isAtLeastAsRestrictive(child: bigint | null, parent: bigint | null): boolean {
  if (parent === null) return true;
  if (child === null) return false;
  return (child & parent) === parent;
}

/**
 * Slugs appear in URLs and in `@@unique([categoryId, slug])`.
 *
 * Refused rather than transformed. A slug silently rewritten is a slug the caller
 * did not choose, and the link they shared afterwards would 404.
 */
export function assertSlug(slug: string): void {
  if (slug.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      'A slug is lowercase letters, numbers and single hyphens, up to 64 characters.',
    );
  }
}

function requireModerator(mask: bigint): void {
  if ((mask & Permission.FORUM_MODERATE) !== Permission.FORUM_MODERATE) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot change the board layout.');
  }
}

export class CategoryService {
  /**
   * The categories this caller may see, in display order.
   *
   * Flat rather than nested: the client draws the tree from `parentId`. A nested
   * response would have to decide what to do when a visible child hangs off an
   * invisible parent — which cannot happen, because `isAtLeastAsRestrictive`
   * makes a visible child imply a visible parent, but a flat list does not
   * DEPEND on that being true. For something ACL-filtered, the shape that
   * survives a mistake is the better one.
   */
  async list(db: AclBoundClient, callerMask: bigint): Promise<CategoryView[]> {
    const rows = await db.forumCategory.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        parentId: true,
        slug: true,
        name: true,
        description: true,
        position: true,
        isLocked: true,
        postPerm: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      slug: r.slug,
      name: r.name,
      description: r.description,
      position: r.position,
      isLocked: r.isLocked,
      /*
       * A BOOLEAN, and the raw `postPerm` never leaves the server. Sending the
       * mask would tell a member exactly which bit they are missing, which is a
       * map of the permission model handed to anybody curious enough to open the
       * network tab.
       */
      canPost: !r.isLocked && satisfiesMask(callerMask, maskOf(r.postPerm)),
    }));
  }

  /**
   * One category by slug, or NOT FOUND.
   *
   * ★ 404, NEVER 403 ★
   *
   * The bound client returns nothing for a category the caller cannot see, so
   * this is indistinguishable from a slug that does not exist (INV-024). A 403
   * would confirm the category is real, and "which private categories exist" is
   * itself information worth withholding.
   */
  async bySlug(db: AclBoundClient, slug: string, callerMask: bigint): Promise<CategoryView> {
    const visible = await this.list(db, callerMask);
    const found = visible.find((c) => c.slug === slug);
    if (found === undefined) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Category not found.');
    }
    return found;
  }

  /**
   * Creates a category. Requires FORUM_MODERATE.
   *
   * The permission is checked against the caller's mask HERE because this is a
   * write: the ACL extension filters reads, and a write has no row to filter.
   */
  async create(db: AclBoundClient, input: CategoryInput, callerMask: bigint): Promise<{ id: string }> {
    requireModerator(callerMask);
    assertSlug(input.slug);

    const parentPerm = await this.#parentViewPerm(db, input.parentId ?? null);
    const viewPerm = input.viewPerm ?? null;

    if (!isAtLeastAsRestrictive(viewPerm, parentPerm)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'A category cannot be more permissive than the one it sits under. Anybody who cannot see the parent must not be able to see this.',
      );
    }

    return db.forumCategory.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        viewPerm: viewPerm === null ? null : viewPerm.toString(),
        postPerm:
          input.postPerm === null || input.postPerm === undefined
            ? null
            : input.postPerm.toString(),
        position: input.position ?? 0,
      },
      select: { id: true },
    });
  }

  /**
   * The parent's view mask, read through the BOUND client.
   *
   * So a moderator cannot attach a child to a parent they themselves cannot see
   * — the parent simply is not found. Deliberate: it stops a lower-tier
   * moderator hanging a category off an invisible branch, where they could not
   * then moderate whatever appeared in it.
   */
  async #parentViewPerm(db: AclBoundClient, parentId: string | null): Promise<bigint | null> {
    if (parentId === null) return null;

    const parent = await db.forumCategory.findUnique({
      where: { id: parentId },
      select: { viewPerm: true },
    });
    if (parent === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Parent category not found.');
    }
    return maskOf(parent.viewPerm);
  }
}
