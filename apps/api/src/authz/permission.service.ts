import {
  type PermissionMask,
  NO_PERMISSIONS,
  computeEffectiveMask,
  type AccountStatus,
} from '@grims/shared';

/**
 * P1.3 — the permission engine.
 *
 *   effective = OR(role masks) AND NOT deny_mask, and nothing else grants.
 *
 * The actual bit arithmetic lives in `computeEffectiveMask` in @grims/shared,
 * which is SSOT-owned and drift-checked. This class is only responsible for
 * loading the inputs, caching the answer, and throwing the cache away at the
 * right moments — which is where the bugs actually live.
 */

export const PERM_CACHE_TTL_SEC = 300;
const CACHE_KEY = (userId: string): string => `perm:${userId}`;

export interface PermissionInputs {
  readonly status: AccountStatus;
  readonly roleMasks: readonly PermissionMask[];
  readonly denyMask: PermissionMask;
}

export interface IPermissionStore {
  /** Returns null when the user does not exist. */
  loadInputs(userId: string): Promise<PermissionInputs | null>;
  /** Closes live sockets so an established connection cannot outlive a ban. */
  dropUserSockets(userId: string): Promise<void>;
}

export interface IPermissionCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class PermissionService {
  constructor(
    private readonly store: IPermissionStore,
    private readonly cache: IPermissionCache,
  ) {}

  async effectiveMask(userId: string): Promise<PermissionMask> {
    // A cache failure must degrade to a slower CORRECT answer. Returning a
    // default in either direction would be wrong: zero locks everyone out
    // during a Redis blip, and anything else grants what was never granted.
    try {
      const hit = await this.cache.get(CACHE_KEY(userId));
      if (hit !== null) return BigInt(hit);
    } catch {
      /* fall through to the store */
    }

    const inputs = await this.store.loadInputs(userId);
    // Unknown user resolves to nothing. "No roles found, therefore unrestricted"
    // is how a deleted account becomes a superuser.
    if (inputs === null) return NO_PERMISSIONS;

    const mask = computeEffectiveMask(inputs.roleMasks, inputs.denyMask, inputs.status);

    // Only an ACTIVE account's mask is cached. Caching zero for a suspended
    // account is harmless in itself, but it puts a value under a key that a
    // later reactivation has to remember to bust — and it costs nothing to
    // recompute a zero.
    if (inputs.status === 'active') {
      try {
        await this.cache.set(CACHE_KEY(userId), mask.toString(), PERM_CACHE_TTL_SEC);
      } catch {
        /* a cache we cannot write is still a correct answer */
      }
    }
    return mask;
  }

  /**
   * True only when EVERY requested bit is held.
   *
   * An empty request answers FALSE. `has(user, 0n)` is almost always a
   * permission constant that failed to resolve at the call site, and answering
   * "yes, you hold no permissions" turns that mistake into an open door.
   */
  async has(userId: string, required: PermissionMask): Promise<boolean> {
    if (required === NO_PERMISSIONS) return false;
    return ((await this.effectiveMask(userId)) & required) === required;
  }

  async invalidate(userId: string): Promise<void> {
    try {
      await this.cache.del(CACHE_KEY(userId));
    } catch {
      /* a stale entry expires within PERM_CACHE_TTL_SEC regardless */
    }
  }

  /**
   * A ban that takes five minutes to bite is not a ban, and an already-open
   * WebSocket never re-checks its own authorization — so both the cache and the
   * live sockets go.
   */
  async onStatusChanged(userId: string, _newStatus: AccountStatus): Promise<void> {
    await this.invalidate(userId);
    await this.store.dropUserSockets(userId);
  }

  async onGuildMemberRemoved(userId: string): Promise<void> {
    await this.invalidate(userId);
    await this.store.dropUserSockets(userId);
  }

  async onRolesChanged(userId: string): Promise<void> {
    await this.invalidate(userId);
  }
}
