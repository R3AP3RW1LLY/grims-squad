import {
  AppError,
  ErrorCode,
  Permission,
  ALL_PERMISSIONS,
  computeEffectiveMask,
  describePermissions,
  type PermissionName,
} from '@grims/shared';

/**
 * The role editor (P1.7).
 *
 * ★ WHY THE PREVIEW EXISTS ★
 *
 * A permission mask is a 70-bit number. Nobody can look at one and say who it
 * affects. Editing it blind is how somebody grants SITE_CONFIG to eleven people
 * while meaning to let officers pin a thread — and nothing fails, so the
 * mistake stays invisible until it is used.
 *
 * The preview answers the only question that matters before saving: which
 * members gain what, and which lose what. Named, both directions, per member.
 *
 * ★ WHY IT COMPUTES EFFECTIVE MASKS RATHER THAN DIFFING THE ROLE ★
 *
 * Diffing the role's own mask is easy and wrong. A member who holds a bit
 * through a second role loses nothing when it is removed from this one, and a
 * member with that bit in their denyMask gains nothing when it is added.
 * Reporting either would send an officer chasing a change that never happened.
 */

export interface RoleRecord {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly permMask: bigint;
  readonly rankOrder: number;
  /** True for the promotion ladder, false for orthogonal tags like `bgs_team`. */
  readonly isHierarchical: boolean;
}

export interface HolderRecord {
  readonly userId: string;
  readonly handle: string;
  /** Masks of this member's OTHER roles. Needed to compute what actually changes. */
  readonly otherRoleMasks: readonly bigint[];
  readonly denyMask: bigint;
}

export interface AffectedMember {
  readonly userId: string;
  readonly handle: string;
  readonly gains: PermissionName[];
  readonly losses: PermissionName[];
}

export interface MaskPreview {
  readonly roleId: string;
  readonly roleName: string;
  readonly before: string;
  readonly after: string;
  readonly affected: AffectedMember[];
  readonly unchanged: boolean;
  /** True when the change hands out something that is effectively total control. */
  readonly dangerous: boolean;
  readonly warnings: string[];
}

export interface RoleAdminStore {
  listRoles(): Promise<RoleRecord[]>;
  roleById(id: string): Promise<RoleRecord | null>;
  holdersOf(roleId: string): Promise<HolderRecord[]>;
  saveMask(roleId: string, mask: bigint): Promise<void>;
  invalidatePermissions(userId: string): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Permissions that amount to total control, and are worth stopping on.
 *
 * SITE_CONFIG is bit 63 and can change anything including who else holds it.
 * ROLE_MANAGE can grant itself the rest. AI_TOOLS_ADMIN can turn off the
 * safeguards on a system that writes to the database on a member's behalf.
 */
const DANGEROUS: ReadonlyArray<[PermissionName, string]> = [
  ['SITE_CONFIG', 'total control of the site, including who else holds it'],
  ['ROLE_MANAGE', 'the ability to grant every other permission, including this one'],
  ['AI_TOOLS_ADMIN', 'control of the AI tool safeguards'],
];

export class RoleAdminService {
  constructor(private readonly store: RoleAdminStore) {}

  listRoles(): Promise<RoleRecord[]> {
    return this.store.listRoles();
  }

  /**
   * What WOULD change. Writes nothing — an officer has to be able to look at
   * the consequences of a change they then decide not to make.
   */
  async previewMaskChange(roleId: string, newMask: bigint): Promise<MaskPreview> {
    const role = await this.#role(roleId);
    const holders = await this.store.holdersOf(roleId);

    const affected: AffectedMember[] = [];
    for (const h of holders) {
      // EFFECTIVE, both sides. Anything less misreports the two cases that
      // actually catch people out: a bit held via another role, and a bit the
      // member's denyMask removes anyway.
      const before = computeEffectiveMask([...h.otherRoleMasks, role.permMask], h.denyMask);
      const after = computeEffectiveMask([...h.otherRoleMasks, newMask], h.denyMask);
      if (before === after) continue;

      affected.push({
        userId: h.userId,
        handle: h.handle,
        gains: describePermissions(after & ~before),
        losses: describePermissions(before & ~after),
      });
    }

    // Only bits actually being ADDED are worth warning about, and only when
    // somebody is actually affected — warning on a change that moves nobody
    // trains people to click through the warning.
    const added = newMask & ~role.permMask;
    const warnings: string[] = [];
    for (const [name, why] of DANGEROUS) {
      if ((added & Permission[name]) !== 0n && affected.length > 0) {
        warnings.push(
          `This grants ${name} to ${affected.length} member${affected.length === 1 ? '' : 's'} — ${why}.`,
        );
      }
    }

    return {
      roleId: role.id,
      roleName: role.name,
      // Decimal strings. A mask above 2^53 loses precision as a JSON number
      // (INV-006), and this is the response an admin UI reads.
      before: role.permMask.toString(),
      after: newMask.toString(),
      affected,
      unchanged: role.permMask === newMask,
      dangerous: warnings.length > 0,
      warnings,
    };
  }

  async saveMask(roleId: string, newMask: bigint, actorId: string): Promise<MaskPreview> {
    if ((newMask & ~ALL_PERMISSIONS) !== 0n) {
      /*
       * Bits that are not permissions. A typo'd literal, or a value pasted from
       * somewhere else, would set bits nothing currently checks — and then a
       * future release assigns one of those bits to a real permission and
       * everyone holding this role silently acquires it. Rejecting now is the
       * only point at which this is cheap.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That mask contains bits that are not valid permissions.',
      );
    }

    const preview = await this.previewMaskChange(roleId, newMask);
    if (preview.unchanged) return preview;

    await this.store.saveMask(roleId, newMask);

    /*
     * Bust the cache for EVERY holder, not only those whose effective mask
     * changed. The two differ when a member is unaffected today because of a
     * second role — and if that second role is edited moments later, a stale
     * entry computed from the old mask is still sitting there. Busting a few
     * extra keys costs one recomputation each.
     */
    for (const h of await this.store.holdersOf(roleId)) {
      await this.store.invalidatePermissions(h.userId);
    }

    await this.store.writeAudit({
      actorId,
      action: 'role.mask.update',
      targetType: 'role',
      targetId: roleId,
      before: { permMask: preview.before },
      after: {
        permMask: preview.after,
        // WHO it moved, not just the number. Six months on, "the mask went from
        // 20 to 52" tells nobody anything; the list of people is actionable.
        affected: preview.affected.map((a) => ({
          handle: a.handle,
          gains: a.gains,
          losses: a.losses,
        })),
      },
    });

    return preview;
  }

  async #role(roleId: string): Promise<RoleRecord> {
    const role = await this.store.roleById(roleId);
    if (role === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Role not found.');
    return role;
  }
}
