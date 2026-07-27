import type { PrismaClient } from '@grims/db';
import type { PrivacySettings, ProfileSource } from './profile.serializer.js';

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
    bio: true,
    timezone: true,
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
    userRoles: { select: { role: { select: { name: true } } } },
  };

  #toRow(u: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    timezone: string;
    joinedAt: Date;
    status: string;
    privacySettings: Partial<PrivacySettings> | null;
    cmdrVerifications: Array<{ cmdrName: string }>;
    userRoles: Array<{ role: { name: string } }>;
  }): MemberRow {
    return {
      source: {
        id: u.id,
        handle: u.handle,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        timezone: u.timezone,
        joinedAt: u.joinedAt,
        status: u.status,
        ranks: u.userRoles.map((r) => r.role.name),
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
