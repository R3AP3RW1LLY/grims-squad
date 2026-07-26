import type { IIdempotencyStore, IdempotencyRow } from './idempotency.service.js';

export class InMemoryIdempotencyStore implements IIdempotencyStore {
  readonly rows: IdempotencyRow[] = [];

  async find(userId: string, endpoint: string, key: string): Promise<IdempotencyRow | null> {
    // Matches on all THREE parts, mirroring the composite primary key. A fake
    // that matched on `key` alone would let the R8 bypass pass its own test.
    return (
      this.rows.find((r) => r.userId === userId && r.endpoint === endpoint && r.key === key) ?? null
    );
  }

  async insert(row: IdempotencyRow): Promise<void> {
    this.rows.push(row);
  }
}
