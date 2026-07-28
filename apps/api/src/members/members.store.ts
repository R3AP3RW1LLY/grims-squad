import type { PrismaClient } from '@grims/db';
import type { PrivacySettings, ProfileSource } from './profile.serializer.js';
import { SNAPSHOT_EVENT_TYPES, type SnapshotEvent } from './commander-snapshot.js';

export interface MemberRow {
  readonly source: ProfileSource;
  readonly privacy: Partial<PrivacySettings> | null;
}

export interface MembersStore {
  byHandle(handle: string): Promise<MemberRow | null>;
  roster(): Promise<MemberRow[]>;
  privacyOf(userId: string): Promise<Partial<PrivacySettings> | null>;
  savePrivacy(userId: string, patch: Partial<PrivacySettings>): Promise<PrivacySettings>;
  handleOf(userId: string): Promise<string | null>;
  /** Latest journal event of each interesting type, for the roster cards. */
  snapshotEvents(userIds: readonly string[]): Promise<SnapshotEvent[]>;
  /** Every guild role we know the name and colour of, keyed by snowflake. */
  discordRoleCatalogue(): Promise<Map<string, DiscordRoleInfo>>;
}

/** One Discord role, as Discord defines it. */
export interface DiscordRoleInfo {
  readonly name: string;
  readonly colour: string | null;
  readonly position: number;
  readonly hoist: boolean;
}

/**
 * Reads only what a profile needs.
 *
 * Every query names its columns. `select` rather than the whole row is not a
 * micro-optimisation here: it means a column added to User later — an address,
 * a phone number, an internal note — cannot reach the serializer at all, so
 * INV-027 does not quietly depend on someone remembering to exclude it.
 */
export class PrismaMembersStore implements MembersStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  static readonly #SELECT = {
    id: true,
    handle: true,
    displayName: true,
    avatarUrl: true,
    avatarStoredHash: true,
    bio: true,
    timezone: true,
    lastPlayingAt: true,
    joinedAt: true,
    status: true,
    privacySettings: {
      select: {
        showLocation: true,
        showCredits: true,
        showFleet: true,
        showActivity: true,
        showOnPublicRoster: true,
        showOnLeaderboard: true,
      },
    },
    cmdrVerifications: {
      where: { revokedAt: null },
      select: { cmdrName: true },
      orderBy: { verifiedAt: 'desc' as const },
      take: 1,
    },
    discordIdentity: { select: { guildRoles: true } },
    userRoles: {
      select: { role: { select: { name: true, colour: true, rankOrder: true } } },
      // Highest first, so a card showing only the top one shows the top one.
      orderBy: { role: { rankOrder: 'desc' as const } },
    },
  };

  #toRow(u: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    avatarStoredHash: string | null;
    bio: string | null;
    timezone: string;
    lastPlayingAt: Date | null;
    joinedAt: Date;
    status: string;
    privacySettings: Partial<PrivacySettings> | null;
    cmdrVerifications: Array<{ cmdrName: string }>;
    discordIdentity: { guildRoles: string[] } | null;
    userRoles: Array<{ role: { name: string; colour: string | null; rankOrder: number } }>;
  }): MemberRow {
    return {
      source: {
        id: u.id,
        handle: u.handle,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        avatarStoredHash: u.avatarStoredHash,
        bio: u.bio,
        timezone: u.timezone,
        lastPlayingAt: u.lastPlayingAt,
        joinedAt: u.joinedAt,
        status: u.status,
        ranks: u.userRoles.map((r) => ({ name: r.role.name, colour: r.role.colour })),
        // Snowflakes only. Names and colours are resolved separately, from the
        // cached guild roles — see `discordRoleCatalogue`.
        guildRoleIds: u.discordIdentity?.guildRoles ?? [],
        cmdrName: u.cmdrVerifications[0]?.cmdrName ?? null,
        // location, credits and fleet arrive with cAPI (P1.8, blocked on
        // Frontier). Absent here means absent from the response, which is the
        // correct behaviour rather than a placeholder to fill in.
      },
      privacy: u.privacySettings,
    };
  }

  async byHandle(handle: string): Promise<MemberRow | null> {
    const u = await this.#db.user.findFirst({
      where: { handle, status: { not: 'banned' } },
      select: PrismaMembersStore.#SELECT,
    });
    return u === null ? null : this.#toRow(u as never);
  }

  async roster(): Promise<MemberRow[]> {
    const rows = await this.#db.user.findMany({
      where: { status: 'active' },
      select: PrismaMembersStore.#SELECT,
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((u) => this.#toRow(u as never));
  }

  /**
   * The latest journal event of each interesting type, per member.
   *
   * ★ NARROWED IN SQL, NOT IN MEMORY ★
   *
   * `distinct` on (userId, eventType) with a descending sort becomes DISTINCT ON
   * in Postgres, so the database returns one row per pair rather than every
   * event ever ingested. At a hundred members with months of history that is the
   * difference between six rows and tens of thousands.
   */
  async snapshotEvents(userIds: readonly string[]): Promise<SnapshotEvent[]> {
    if (userIds.length === 0) return [];

    return this.#db.telemetryEvent.findMany({
      where: { userId: { in: [...userIds] }, eventType: { in: [...SNAPSHOT_EVENT_TYPES] } },
      select: { userId: true, eventType: true, occurredAt: true, payload: true },
      orderBy: [{ userId: 'asc' }, { eventType: 'asc' }, { occurredAt: 'desc' }],
      distinct: ['userId', 'eventType'],
    });
  }

  /**
   * The guild's roles, by snowflake.
   *
   * ★ ONE QUERY FOR THE WHOLE PAGE ★
   *
   * A guild has a few dozen roles and a roster has a hundred members, so
   * fetching the catalogue ONCE and resolving in memory is a single small read
   * — whereas joining per member would multiply it by the roster.
   *
   * Roles Discord has since deleted simply are not in the map, and a member
   * still carrying one shows nothing for it rather than an id.
   */
  async discordRoleCatalogue(): Promise<Map<string, DiscordRoleInfo>> {
    const rows = await this.#db.discordRole.findMany({
      select: { discordRoleId: true, name: true, colour: true, position: true, hoist: true },
    });

    return new Map(
      rows.map((r) => [
        r.discordRoleId,
        { name: r.name, colour: r.colour, position: r.position, hoist: r.hoist },
      ]),
    );
  }

  async privacyOf(userId: string): Promise<Partial<PrivacySettings> | null> {
    return (await this.#db.privacySetting.findUnique({
      where: { userId },
      select: {
        showLocation: true,
        showCredits: true,
        showFleet: true,
        showActivity: true,
        showOnPublicRoster: true,
        showOnLeaderboard: true,
      },
    })) as Partial<PrivacySettings> | null;
  }

  async savePrivacy(userId: string, patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    // Upsert because the row is created lazily — a member who has never opened
    // settings has none, and their first change must not 404.
    const saved = await this.#db.privacySetting.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
      select: {
        showLocation: true,
        showCredits: true,
        showFleet: true,
        showActivity: true,
        showOnPublicRoster: true,
        showOnLeaderboard: true,
      },
    });
    return saved as PrivacySettings;
  }

  async handleOf(userId: string): Promise<string | null> {
    const u = await this.#db.user.findUnique({ where: { id: userId }, select: { handle: true } });
    return u?.handle ?? null;
  }
}
