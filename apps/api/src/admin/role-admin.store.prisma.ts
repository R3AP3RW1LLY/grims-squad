import type { PrismaClient } from '@grims/db';
import type { RoleAdminStore, RoleRecord, HolderRecord } from './role-admin.service.js';
import type { MappingAdminStore, MappingRecord } from './mapping-admin.service.js';

/** The one Redis method these stores need. Typed narrowly rather than importing ioredis. */
export interface CacheBuster {
  del(key: string): Promise<unknown>;
}

/**
 * Shared by both admin stores.
 *
 * The key format is the API's own (`perm:<userId>`, from permission.service.ts).
 * Stated in one place here so two stores cannot drift from it independently —
 * and a bust that misses is indistinguishable from a change that did not save,
 * for up to the cache TTL.
 */
async function bust(redis: CacheBuster | null, userId: string): Promise<void> {
  if (redis === null) return;
  await redis.del(`perm:${userId}`);
}

export class PrismaRoleAdminStore implements RoleAdminStore {
  readonly #db: PrismaClient;
  readonly #redis: CacheBuster | null;

  constructor(db: PrismaClient, redis: CacheBuster | null = null) {
    this.#db = db;
    this.#redis = redis;
  }

  async listRoles(): Promise<RoleRecord[]> {
    const rows = await this.#db.role.findMany({
      select: { id: true, key: true, name: true, permMask: true, rankOrder: true },
      orderBy: { rankOrder: 'asc' },
    });
    return rows.map((r) => ({
      ...r,
      // toFixed(0), never Number(). The mask is NUMERIC(40,0) and exceeds 64
      // bits — SITE_CONFIG alone is 1n<<63n (INV-006, ADR-005).
      permMask: BigInt(r.permMask.toFixed(0)),
    }));
  }

  async roleById(id: string): Promise<RoleRecord | null> {
    const r = await this.#db.role.findUnique({
      where: { id },
      select: { id: true, key: true, name: true, permMask: true, rankOrder: true },
    });
    return r === null ? null : { ...r, permMask: BigInt(r.permMask.toFixed(0)) };
  }

  /**
   * Everyone holding this role, with the masks of their OTHER roles.
   *
   * The other masks are what make the preview truthful: a member who holds a
   * permission through a second role loses nothing when it is removed from this
   * one, and saying otherwise sends an officer chasing a revocation that never
   * happened.
   */
  async holdersOf(roleId: string): Promise<HolderRecord[]> {
    const rows = await this.#db.userRole.findMany({
      where: { roleId },
      select: {
        user: {
          select: {
            id: true,
            handle: true,
            denyMask: true,
            userRoles: { select: { roleId: true, role: { select: { permMask: true } } } },
          },
        },
      },
    });

    return rows.map((r) => ({
      userId: r.user.id,
      handle: r.user.handle,
      otherRoleMasks: r.user.userRoles
        .filter((ur) => ur.roleId !== roleId)
        .map((ur) => BigInt(ur.role.permMask.toFixed(0))),
      denyMask: BigInt(r.user.denyMask.toFixed(0)),
    }));
  }

  async saveMask(roleId: string, mask: bigint): Promise<void> {
    // The mask goes in as a STRING. Prisma accepts a Decimal from a string
    // without loss; a JavaScript number would round anything above 2^53, which
    // is most of the interesting masks.
    await this.#db.role.update({ where: { id: roleId }, data: { permMask: mask.toString() } });
  }

  async invalidatePermissions(userId: string): Promise<void> {
    await bust(this.#redis, userId);
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    await this.#db.auditLog.create({
      data: {
        actorId: entry['actorId'] as string | null,
        actorType: 'user',
        action: String(entry['action']),
        targetType: String(entry['targetType']),
        targetId: String(entry['targetId']),
        before: entry['before'] as never,
        after: entry['after'] as never,
      },
    });
  }
}

export class PrismaMappingAdminStore implements MappingAdminStore {
  readonly #db: PrismaClient;
  readonly #redis: CacheBuster | null;

  constructor(db: PrismaClient, redis: CacheBuster | null = null) {
    this.#db = db;
    this.#redis = redis;
  }

  async list(): Promise<MappingRecord[]> {
    const rows = await this.#db.roleMapping.findMany({
      select: { roleId: true, discordRoleId: true, role: { select: { name: true } } },
    });
    return rows.map((r) => ({
      roleId: r.roleId,
      roleName: r.role.name,
      discordRoleId: r.discordRoleId,
    }));
  }

  async roleName(roleId: string): Promise<string | null> {
    const r = await this.#db.role.findUnique({ where: { id: roleId }, select: { name: true } });
    return r?.name ?? null;
  }

  async findByDiscordRoleId(discordRoleId: string): Promise<MappingRecord | null> {
    const r = await this.#db.roleMapping.findFirst({
      where: { discordRoleId },
      select: { roleId: true, discordRoleId: true, role: { select: { name: true } } },
    });
    return r === null
      ? null
      : { roleId: r.roleId, roleName: r.role.name, discordRoleId: r.discordRoleId };
  }

  async create(roleId: string, discordRoleId: string): Promise<void> {
    await this.#db.roleMapping.create({ data: { roleId, discordRoleId } });
  }

  async remove(roleId: string, discordRoleId: string): Promise<void> {
    // deleteMany, so removing something already gone is not an error. The
    // officer's intent is "this mapping should not exist", and it does not.
    await this.#db.roleMapping.deleteMany({ where: { roleId, discordRoleId } });
  }

  async holdersOfRole(roleId: string): Promise<string[]> {
    const rows = await this.#db.userRole.findMany({ where: { roleId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  async invalidatePermissions(userId: string): Promise<void> {
    await bust(this.#redis, userId);
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    await this.#db.auditLog.create({
      data: {
        actorId: entry['actorId'] as string | null,
        actorType: 'user',
        action: String(entry['action']),
        targetType: String(entry['targetType']),
        targetId: String(entry['targetId']),
        before: entry['before'] as never,
        after: entry['after'] as never,
      },
    });
  }
}
