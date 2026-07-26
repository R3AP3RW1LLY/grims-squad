import type { AccountStatus, PermissionMask } from '@grims/shared';
import type { IPermissionStore, IPermissionCache, PermissionInputs } from './permission.service.js';
import type { IWebmasterStore, AuditEntry } from './webmaster.js';

interface FakeRole {
  key: string;
  mask: PermissionMask;
  isHierarchical: boolean;
  discordMappings: string[];
}

interface FakeGrant {
  userId: string;
  roleKey: string;
  source: 'discord' | 'manual' | 'system';
  grantedBy: string | null;
}

/** In-memory store satisfying both the permission and webmaster ports. */
export class InMemoryPermissionStore implements IPermissionStore, IWebmasterStore {
  readonly roles = new Map<string, FakeRole>();
  readonly users = new Map<string, { status: AccountStatus; denyMask: PermissionMask }>();
  readonly grants: FakeGrant[] = [];
  readonly audit: AuditEntry[] = [];
  readonly droppedSockets: string[] = [];
  reads = 0;

  addRole(key: string, mask: PermissionMask, isHierarchical = true, discordMappings: string[] = []) {
    this.roles.set(key, { key, mask, isHierarchical, discordMappings });
  }
  role(key: string) {
    return this.roles.get(key);
  }
  mappingsFor(key: string) {
    return this.roles.get(key)?.discordMappings ?? [];
  }
  addUser(userId: string, status: AccountStatus, denyMask: PermissionMask = 0n) {
    this.users.set(userId, { status, denyMask });
  }
  setStatus(userId: string, status: AccountStatus) {
    const u = this.users.get(userId);
    if (u !== undefined) u.status = status;
  }
  grant(userId: string, roleKey: string, source: FakeGrant['source'] = 'discord') {
    this.grants.push({ userId, roleKey, source, grantedBy: null });
  }
  revoke(userId: string, roleKey: string) {
    const i = this.grants.findIndex((g) => g.userId === userId && g.roleKey === roleKey);
    if (i >= 0) this.grants.splice(i, 1);
  }
  rolesOf(userId: string): string[] {
    return this.grants.filter((g) => g.userId === userId).map((g) => g.roleKey);
  }
  grantSource(userId: string, roleKey: string) {
    return this.grants.find((g) => g.userId === userId && g.roleKey === roleKey)?.source;
  }

  // ------------------------------------------------------- IPermissionStore
  async loadInputs(userId: string): Promise<PermissionInputs | null> {
    this.reads += 1;
    const u = this.users.get(userId);
    if (u === undefined) return null;
    const roleMasks = this.rolesOf(userId).map((k) => this.roles.get(k)?.mask ?? 0n);
    return { status: u.status, roleMasks, denyMask: u.denyMask };
  }

  async dropUserSockets(userId: string): Promise<void> {
    this.droppedSockets.push(userId);
  }

  // -------------------------------------------------------- IWebmasterStore
  async userStatus(userId: string): Promise<AccountStatus | null> {
    return this.users.get(userId)?.status ?? null;
  }
  async hasRole(userId: string, roleKey: string): Promise<boolean> {
    return this.rolesOf(userId).includes(roleKey);
  }
  async grantRole(
    userId: string,
    roleKey: string,
    source: FakeGrant['source'],
    grantedBy: string | null,
  ): Promise<void> {
    this.grants.push({ userId, roleKey, source, grantedBy });
  }
  async revokeRole(userId: string, roleKey: string): Promise<void> {
    this.revoke(userId, roleKey);
  }
  async countActiveHolders(roleKey: string): Promise<number> {
    return this.grants.filter(
      (g) => g.roleKey === roleKey && this.users.get(g.userId)?.status === 'active',
    ).length;
  }
  async writeAudit(entry: AuditEntry): Promise<void> {
    this.audit.push(entry);
  }
}

/** Cache fake with a switch to simulate Redis being unreachable. */
export class FakeCache implements IPermissionCache {
  readonly entries = new Map<string, { value: string; ttlSec: number }>();
  #broken = false;

  breakIt() {
    this.#broken = true;
  }

  async get(key: string): Promise<string | null> {
    if (this.#broken) throw new Error('redis unreachable');
    return this.entries.get(key)?.value ?? null;
  }
  async set(key: string, value: string, ttlSec: number): Promise<void> {
    if (this.#broken) throw new Error('redis unreachable');
    this.entries.set(key, { value, ttlSec });
  }
  async del(key: string): Promise<void> {
    if (this.#broken) throw new Error('redis unreachable');
    this.entries.delete(key);
  }
}
