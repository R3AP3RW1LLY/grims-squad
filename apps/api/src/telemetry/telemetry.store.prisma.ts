import type { PrismaClient, TelemetryCategory } from '@grims/db';
import { JOURNAL_EVENTS, type JournalCategory, type JournalEventName } from '@grims/shared';
import type { PairingStore, DeviceTokenRecord } from './pairing.service.js';
import type { IngestStore } from './journal-ingest.service.js';

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

/**
 * The consent category each journal event is stored under.
 *
 * ★ WHY NOT ONE CATEGORY FOR ALL JOURNAL DATA ★
 *
 * Consent is per-category (INV-013), so a category is only meaningful if a
 * member can predict what lands in it. Filing "did they play", "what rank are
 * they" and "what ships do they own" together would make the choice
 * all-or-nothing — and the one thing we actually need, did they play, is by far
 * the least revealing of the three. Split apart, a member can satisfy the
 * promotion rule WITHOUT also sharing what they did while playing.
 *
 * ★ DERIVED, NOT RESTATED ★
 *
 * The allowlist already labels every event (`JOURNAL_EVENTS`). This translates
 * those labels to the database enum rather than re-deciding per event name, so
 * adding an event to the allowlist cannot land it in the wrong bucket — it
 * inherits whatever its label maps to.
 *
 * Typed as a total Record, so adding a label to the allowlist without deciding
 * where it belongs fails to COMPILE. There is no runtime fallback because there
 * is no case for one to catch.
 */
const CATEGORY_BY_LABEL: Record<JournalCategory, TelemetryCategory> = {
  // The promotion input, and nothing else. Kept alone deliberately.
  session: 'session',
  // What a commander IS, rather than what they did.
  ranks: 'profile',
  squadron: 'profile',
  // What they own. `ship` is the current one, `fleet` is all of them; the
  // distinction matters to the app and not to consent.
  ship: 'fleet',
  fleet: 'fleet',
};

function categoryFor(eventType: string): TelemetryCategory {
  const label = JOURNAL_EVENTS[eventType as JournalEventName];
  /*
   * Unreachable via the service, which rejects anything off the allowlist
   * before reaching a store. Guarded anyway, and toward the NARROWEST category:
   * if the two filters were ever bypassed, an unclassified event must reveal as
   * little as possible rather than defaulting wide.
   */
  return label === undefined ? 'session' : CATEGORY_BY_LABEL[label];
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
        category: categoryFor(r.eventType),
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
