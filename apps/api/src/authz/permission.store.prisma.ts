import { PrismaClient } from '@grims/db';
import type { AccountStatus, PermissionMask } from '@grims/shared';
import type { IPermissionStore, PermissionInputs, IPermissionCache } from './permission.service.js';
import type { Redis } from 'ioredis';

/**
 * Loads everything the permission engine needs in ONE query.
 *
 * Status, role masks and the deny mask are read together because they are
 * evaluated together: fetching them separately leaves a window in which a
 * member is banned between the status read and the role read, and the mask is
 * computed from a state that never existed.
 */
export class PrismaPermissionStore implements IPermissionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async loadInputs(userId: string): Promise<PermissionInputs | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        denyMask: true,
        userRoles: { select: { role: { select: { permMask: true } } } },
      },
    });
    if (user === null) return null;

    return {
      status: user.status as AccountStatus,
      // Decimal -> bigint via the string form. Going through Number would cap
      // at 2^53 and silently drop SITE_CONFIG (bit 63) and TELEMETRY_WRITE
      // (bit 70) — the two most and least privileged bits we have.
      roleMasks: user.userRoles.map((ur) => BigInt(ur.role.permMask.toFixed(0)) as PermissionMask),
      denyMask: BigInt(user.denyMask.toFixed(0)) as PermissionMask,
    };
  }

  async dropUserSockets(_userId: string): Promise<void> {
    // No WebSocket layer yet (P2). Deliberately a no-op rather than a throw:
    // a ban must still bust the cache today, and this becomes real when the
    // socket server exists.
  }
}

/** Redis-backed cache. Every method swallows nothing — the service decides. */
export class RedisPermissionCache implements IPermissionCache {
  constructor(private readonly redis: Redis) {}
  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
  async set(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSec);
  }
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
