import type { PrismaClient } from '@grims/db';
import type { PairingStore, DeviceTokenRecord } from './pairing.service.js';
import type { IngestStore } from './journal-ingest.service.js';
import type { ConsentStore, OptOutState } from './consent.service.js';

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
   * Records that the member's journal is being written right now.
   *
   * A bare timestamp rather than a session row: presence is a question with a
   * five-minute answer, and modelling sessions would mean deciding when one
   * ENDS — which the journal never says, because a game that crashes writes no
   * goodbye.
   */
  async markPlaying(userId: string, at: Date): Promise<void> {
    await this.#db.user.update({ where: { id: userId }, data: { lastPlayingAt: at } });
  }

  /**
   * Clears presence the moment the game closes.
   *
   * Null rather than an old timestamp: every reader asks "within the last five
   * minutes", and null answers that correctly without any reader needing to
   * know a stop signal exists.
   */
  async markStopped(userId: string): Promise<void> {
    await this.#db.user.update({ where: { id: userId }, data: { lastPlayingAt: null } });
  }

  /**
   * How many rows this member has contributed, and since when.
   *
   * ★ TWO QUERIES, NOT A GROUP BY ★
   *
   * `count` is answered from an index; the oldest row is one `ORDER BY … LIMIT
   * 1` on the same index. Aggregating min() alongside the count would scan the
   * member's whole history, which for somebody who has been running the app for
   * a year is tens of thousands of rows every time the app polls.
   */
  async contribution(userId: string): Promise<{ storedEvents: number; firstEventAt: Date | null }> {
    const [storedEvents, oldest] = await Promise.all([
      this.#db.telemetryEvent.count({ where: { userId } }),
      this.#db.telemetryEvent.findFirst({
        where: { userId },
        select: { occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);

    return { storedEvents, firstEventAt: oldest?.occurredAt ?? null };
  }

  /**
   * What this member has switched OFF (INV-013, amended 2026-07-29).
   *
   * ★ NO ROW MEANS KEEP EVERYTHING, WHICH IS THE REVERSE OF BEFORE ★
   *
   * Under the old opt-in model an absent row meant "consented to nothing".
   * Under opt-out it means "declined nothing" — a member who has never opened
   * their settings gets the default, and the default is everything.
   *
   * That inversion is the reason the migration backfills: reading old
   * opt-in rows as an empty opt-out list would have switched on collection
   * people had specifically refused.
   */
  async telemetryOptOuts(
    userId: string,
  ): Promise<{ categories: readonly string[]; events: readonly string[] }> {
    const privacy = await this.#db.privacySetting.findUnique({
      where: { userId },
      select: { telemetryOptOutCategories: true, telemetryOptOutEvents: true },
    });

    return {
      categories: privacy?.telemetryOptOutCategories ?? [],
      events: privacy?.telemetryOptOutEvents ?? [],
    };
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

  async read(userId: string): Promise<OptOutState> {
    const privacy = await this.#db.privacySetting.findUnique({
      where: { userId },
      select: { telemetryOptOutCategories: true, telemetryOptOutEvents: true },
    });

    // No row means nothing declined, which under opt-out means everything is
    // kept — the reverse of what an absent row used to mean.
    return {
      categories: privacy?.telemetryOptOutCategories ?? [],
      events: privacy?.telemetryOptOutEvents ?? [],
    };
  }

  /**
   * Upsert, because a member may never have touched their privacy settings.
   * Every other toggle on that row defaults conservatively, so creating it here
   * grants nothing beyond what was asked for.
   */
  async write(userId: string, state: OptOutState): Promise<void> {
    await this.#db.privacySetting.upsert({
      where: { userId },
      create: {
        userId,
        telemetryOptOutCategories: state.categories as never,
        telemetryOptOutEvents: [...state.events],
      },
      update: {
        telemetryOptOutCategories: state.categories as never,
        telemetryOptOutEvents: [...state.events],
      },
    });
  }

  /**
   * Deletes every stored event in these categories.
   *
   * A real DELETE, not a soft flag. "Purge" that leaves the rows in place with a
   * column set is not what a member asked for, and it is not what the constraint
   * says either.
   */
  async purgeCategories(userId: string, categories: readonly string[]): Promise<number> {
    const result = await this.#db.telemetryEvent.deleteMany({
      where: { userId, category: { in: categories as never } },
    });
    return result.count;
  }

  /**
   * Deletes every stored event with these names.
   *
   * The finer scope. A member who declines `Bounty` alone keeps the rest of the
   * combat category, so purging by category here would delete data they did not
   * ask to lose — which is worse than not purging at all, because it is
   * irreversible and they never asked for it.
   */
  async purgeEvents(userId: string, events: readonly string[]): Promise<number> {
    const result = await this.#db.telemetryEvent.deleteMany({
      where: { userId, eventType: { in: [...events] } },
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
