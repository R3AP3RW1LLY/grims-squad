import type { IRoleSyncStore, AuditEntry, GrantSource } from './role-sync.service.js';

export class InMemoryRoleSyncStore implements IRoleSyncStore {
  readonly audit: AuditEntry[] = [];
  readonly invalidated: string[] = [];
  readonly #mappings = new Map<string, string>();
  readonly #grants: Array<{ userId: string; roleKey: string; source: GrantSource }> = [];

  addMapping(discordRoleId: string, roleKey: string) {
    this.#mappings.set(discordRoleId, roleKey);
  }
  grantSync(userId: string, roleKey: string, source: GrantSource) {
    this.#grants.push({ userId, roleKey, source });
  }
  /** Test helper mirroring a pre-existing grant of any source. */
  grant(userId: string, roleKey: string, source: GrantSource = 'discord'): Promise<void> {
    this.#grants.push({ userId, roleKey, source });
    return Promise.resolve();
  }
  rolesOf(userId: string): string[] {
    return this.#grants.filter((g) => g.userId === userId).map((g) => g.roleKey);
  }
  sourceOf(userId: string, roleKey: string): GrantSource | undefined {
    return this.#grants.find((g) => g.userId === userId && g.roleKey === roleKey)?.source;
  }

  async mappings(): Promise<ReadonlyMap<string, string>> {
    return this.#mappings;
  }
  async discordGrants(userId: string): Promise<readonly string[]> {
    // ONLY discord-sourced. A fake that returned every grant would let the
    // "sync revokes the webmaster role" bug pass its own test.
    return this.#grants
      .filter((g) => g.userId === userId && g.source === 'discord')
      .map((g) => g.roleKey);
  }
  async heldGrants(userId: string): Promise<readonly string[]> {
    // EVERY source, unlike discordGrants above — that distinction is the fix for the re-grant loop.
    return this.#grants.filter((g) => g.userId === userId).map((g) => g.roleKey);
  }
  async revoke(userId: string, roleKey: string): Promise<void> {
    const i = this.#grants.findIndex(
      (g) => g.userId === userId && g.roleKey === roleKey && g.source === 'discord',
    );
    if (i >= 0) this.#grants.splice(i, 1);
  }
  async writeAudit(entry: AuditEntry): Promise<void> {
    this.audit.push(entry);
  }
  async invalidatePermissions(userId: string): Promise<void> {
    this.invalidated.push(userId);
  }
}
