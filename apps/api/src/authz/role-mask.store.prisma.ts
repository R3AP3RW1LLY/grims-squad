import type { PrismaClient } from '@grims/db';
import type { PermissionMask } from '@grims/shared';
import type { IRoleMaskLookup } from './view-as.service.js';

/**
 * What a role grants, by id, for the rank preview.
 *
 * ★ NOT CACHED, AND THAT IS FINE ★
 *
 * It runs only on requests carrying a preview cookie — one officer checking a page, not the hundred
 * and seventeen members going about their day. A cache here would be an invalidation problem in
 * exchange for saving a primary-key lookup on a table of a dozen rows.
 *
 * ★ WHY THE MASK IS PARSED FROM A STRING ★
 *
 * `perm_mask` is `numeric(40,0)`, because the permission set is a bitmask far past 2^53 and a
 * double would round the high bits away silently — granting or revoking permissions nobody touched.
 * Prisma hands it back as a Decimal, so it is stringified and re-read as a BigInt.
 */
export class PrismaRoleMaskStore implements IRoleMaskLookup {
  constructor(private readonly db: PrismaClient) {}

  async find(roleId: string): Promise<{ name: string; mask: PermissionMask } | null> {
    /*
     * Matched on id OR key. The roles page works in ids; a human writing one by hand reaches for
     * "cadet". Accepting both costs one predicate and removes a class of "nothing happened".
     */
    const role = await this.db.role.findFirst({
      where: { OR: [{ id: roleId }, { key: roleId }] },
      select: { name: true, permMask: true },
    });
    if (role === null) return null;

    try {
      return { name: role.name, mask: BigInt(role.permMask.toString()) };
    } catch {
      // A mask that will not parse is not a reason to grant anything.
      return { name: role.name, mask: 0n };
    }
  }
}
