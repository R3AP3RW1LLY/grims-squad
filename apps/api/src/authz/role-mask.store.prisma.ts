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
 * ★ `toFixed(0)`, NEVER `toString()` — AND THIS FILE GOT IT WRONG ★
 *
 * `perm_mask` is `numeric(40,0)`, because the permission set is a bitmask far past 2^53 and a
 * double would round the high bits away silently. Prisma hands it back as a Decimal.
 *
 * Decimal.toString() switches to EXPONENTIAL notation at 1e21, and the real masks here are about
 * 1.198e21 — just over the line. So `BigInt(decimal.toString())` throws on every role that grants
 * anything, and succeeds on every role that grants nothing.
 *
 * This shipped with `toString()` and a catch that turned the failure into a mask of zero. It was
 * reported within the hour: "im viewing as the Galactic Admiral role, and its showing me the same
 * view as a cadet would see". Both previewed as nothing — Galactic Admiral because its mask threw
 * and was swallowed, Cadet because its mask genuinely IS zero. Two unrelated causes, one identical
 * symptom, and not a single error logged anywhere.
 *
 * Every other reader in this codebase already used `toFixed(0)`; `grant.service.ts` even carries a
 * comment explaining exactly this trap. The catch is gone as well — failing closed is right,
 * failing closed SILENTLY is what made a broken preview look like a working one.
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

    return { name: role.name, mask: BigInt(role.permMask.toFixed(0)) };
  }
}
