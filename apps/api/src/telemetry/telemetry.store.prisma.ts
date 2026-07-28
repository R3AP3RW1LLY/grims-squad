import type { PrismaClient } from '@grims/db';
import type { PairingStore, DeviceTokenRecord } from './pairing.service.js';
import type { IngestStore } from './journal-ingest.service.js';
import type { ConsentStore } from './consent.service.js';

export class PrismaPairingStore implements PairingStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async create(userId: string, label: string, tokenHash: string): Promise<DeviceTokenRecord> {
    return (await this.#db.deviceToken.create({
      data: { userId, label, tokenHash, scopes: ['telemetry:write'] },
    })) as DeviceTokenRecord;
  }

  async findByHash(tokenHash: string): Promise<DeviceTokenRecord | null> {
    // Looked up BY HASH, so the plaintext never has to be stored or compared.
    return (await this.#db.deviceToken.findUnique({
      where: { tokenHash },
    })) as DeviceTokenRecord | null;
  }

  async listFor(userId: string): Promise<DeviceTokenRecord[]> {
    return (await this.#db.deviceToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })) as DeviceTokenRecord[];
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.#db.deviceToken.updateMany({ where: { id }, data: { revokedAt: at } });
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.#db.deviceToken.updateMany({ where: { id }, data: { lastUsedAt: at } });
  }

  async countActiveFor(userId: string): Promise<number> {
    return this.#db.deviceToken.count({ where: { userId, revokedAt: null } });
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

export class PrismaIngestStore implements IngestStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  /**
   * Inserts, skipping anything already present.
   *
   * `skipDuplicates` leans on the unique index over `eventKey`, so dedupe
   * happens in the DATABASE rather than by reading first and then writing.
   * A read-then-write would race two devices sending the same journal, and the
   * loser would be a lost event rather than a harmless duplicate.
   */
  async insertIgnoringDuplicates(
    rows: ReadonlyArray<{
      userId: string;
      deviceTokenId: string;
      category: string;
      eventType: string;
      occurredAt: Date;
      payload: Record<string, unknown>;
      eventKey: string;
    }>,
  ): Promise<number> {
    const result = await this.#db.telemetryEvent.createMany({
      data: rows.map((r) => ({
        userId: r.userId,
        deviceTokenId: r.deviceTokenId,
        category: r.category as never,
        eventType: r.eventType,
        occurredAt: r.occurredAt,
        payload: r.payload as never,
        eventKey: r.eventKey,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * The categories this member has opted into. Empty by default (INV-013).
   */
  async consentedCategories(userId: string): Promise<readonly string[]> {
    const privacy = await this.#db.privacySetting.findUnique({
      where: { userId },
      select: { telemetryConsent: true },
    });
    // No row means no consent. Defaults are conservative by design, and a member
    // who has never opened their privacy settings has not agreed to anything.
    return privacy?.telemetryConsent ?? [];
  }

  /**
   * Records that the member played this month.
   *
   * ★ SETS A FLAG, NEVER INCREMENTS ★
   *
   * That is what makes a re-send free: the uploader retries without advancing
   * its offset, so the same LoadGame arrives repeatedly and must cost nothing.
   *
   * `observed`, not `assumed` — a journal event is direct evidence, and the
   * distinction is load-bearing (D26): an assumption must never be displayed
   * beside real evidence as though it were the same thing.
   */
  async markGameActivityObserved(userId: string, month: Date, at: Date): Promise<void> {
    const identity = await this.#db.discordIdentity.findUnique({
      where: { userId },
      select: { discordId: true },
    });
    // Activity rows are keyed by Discord snowflake, because the bot records
    // them for guild members who may never have signed in here.
    if (identity === null) return;

    await this.#db.memberActivityMonth.upsert({
      where: { discordId_month: { discordId: identity.discordId, month } },
      create: {
        discordId: identity.discordId,
        month,
        userId,
        gameActivity: 'observed',
        gameCheckedAt: at,
      },
      update: { userId, gameActivity: 'observed', gameCheckedAt: at },
    });
  }
}

export class PrismaConsentStore implements ConsentStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async read(userId: string): Promise<readonly string[]> {
    const privacy = await this.#db.privacySetting.findUnique({
      where: { userId },
      select: { telemetryConsent: true },
    });
    return privacy?.telemetryConsent ?? [];
  }

  /**
   * Upsert, because a member may never have touched their privacy settings.
   * Every other toggle on that row defaults conservatively, so creating it here
   * grants nothing beyond what was asked for.
   */
  async write(userId: string, categories: readonly string[]): Promise<void> {
    await this.#db.privacySetting.upsert({
      where: { userId },
      create: { userId, telemetryConsent: categories as never },
      update: { telemetryConsent: categories as never },
    });
  }

  /**
   * Deletes every stored event in these categories.
   *
   * A real DELETE, not a soft flag. "Purge" that leaves the rows in place with a
   * column set is not what a member asked for, and it is not what the constraint
   * says either.
   */
  async purge(userId: string, categories: readonly string[]): Promise<number> {
    const result = await this.#db.telemetryEvent.deleteMany({
      where: { userId, category: { in: categories as never } },
    });
    return result.count;
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
