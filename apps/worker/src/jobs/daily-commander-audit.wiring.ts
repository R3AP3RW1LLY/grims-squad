import type { PrismaClient } from '@grims/db';
import { notifyMembers, notifySquadron } from '@grims/db';
import { notificationNudge } from '../lib/live-notify.js';
import type { DiscordAdapter, InaraAdapter } from '@grims/ed-clients';
import type { TokenCipher } from '@grims/shared/server';
import { rankForDisplay, LEADERSHIP_CEILING } from '@grims/shared';
import type {
  AuditStore,
  AuditSource,
  AuditableCommander,
  NicknameSetter,
} from './daily-commander-audit.js';

export class PrismaAuditStore implements AuditStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly cipher: TokenCipher,
  ) {}

  /**
   * Every verified commander, with everything the sweep needs in one read.
   *
   * Four queries rather than one join, because the join would be a five-table
   * fan-out to produce a hundred rows — and the role mapping and guild member
   * cache are small enough to resolve in memory.
   */
  async listCommanders(): Promise<AuditableCommander[]> {
    const verifications = await this.db.cmdrVerification.findMany({
      where: { isVerified: true, revokedAt: null },
      select: { userId: true, cmdrName: true },
      // One row per member. Verifications are a HISTORY, and asking Inara twice
      // about the same person spends a limited budget to learn one thing.
      distinct: ['userId'],
      orderBy: [{ userId: 'asc' }, { verifiedAt: 'desc' }],
    });

    const userIds = verifications.map((v) => v.userId);

    const [identities, links, mappings] = await Promise.all([
      this.db.discordIdentity.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, discordId: true, guildNick: true },
      }),
      this.db.inaraLink.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, apiKeyEnc: true },
      }),
      this.db.roleMapping.findMany({
        where: { role: { isHierarchical: true } },
        select: { discordRoleId: true, role: { select: { name: true, rankOrder: true } } },
      }),
    ]);

    const identityByUser = new Map(identities.map((i) => [i.userId, i]));
    const rankByRoleId = new Map(mappings.map((m) => [m.discordRoleId, m.role]));

    /*
     * The roles a member WEARS, from the guild cache — not their granted
     * internal roles. Grants only appear after reconciliation for an account
     * that exists, and most of the squadron has neither, so reading grants
     * would leave almost everybody with no rank prefix at all.
     */
    const members = await this.db.discordGuildMember.findMany({
      where: { discordId: { in: identities.map((i) => i.discordId) } },
      select: { discordId: true, roles: true, nick: true },
    });
    const memberByDiscordId = new Map(members.map((m) => [m.discordId, m]));

    /*
     * Who has chosen their own nickname.
     *
     * Read for everybody in one query rather than per member: the sweep already makes one Inara
     * request per commander and is the slowest job on the platform — adding a round trip per person
     * to read one nullable column would be the cheapest possible way to make it slower.
     */
    const overrides = new Map(
      (
        await this.db.user.findMany({
          where: { id: { in: userIds }, nicknameOverride: { not: null } },
          select: { id: true, nicknameOverride: true },
        })
      ).map((u) => [u.id, u.nicknameOverride]),
    );

    const keyByUser = new Map(
      links.flatMap((l) => {
        try {
          // Buffer.from(...), not .toString('utf8') on the raw value: Prisma 6
          // maps Bytes to Uint8Array, whose toString takes NO encoding argument
          // and would yield a comma-separated list of byte values.
          const plain = this.cipher.decrypt(
            Buffer.from(l.apiKeyEnc).toString('utf8'),
            `inara-key:${l.userId}`,
          );
          return [[l.userId, plain] as const];
        } catch {
          // A key that will not decrypt is one we cannot use. Skipped rather
          // than thrown: one damaged row must not stop the sweep, and the
          // member falls back to the public lookup.
          return [];
        }
      }),
    );

    return verifications.map((v) => {
      const identity = identityByUser.get(v.userId);
      const member =
        identity === undefined ? undefined : memberByDiscordId.get(identity.discordId);

      const held = (member?.roles ?? []).flatMap((id) => {
        const r = rankByRoleId.get(id);
        return r === undefined ? [] : [r];
      });

      return {
        userId: v.userId,
        cmdrName: v.cmdrName,
        discordId: identity?.discordId ?? null,
        apiKey: keyByUser.get(v.userId) ?? null,
        // The guild cache is fresher than our identity row — the bot updates it
        // on every GuildMemberUpdate — so it wins where both have a value.
        currentNick: member?.nick ?? identity?.guildNick ?? null,
        rank: rankForDisplay(held, LEADERSHIP_CEILING),
        // Null for almost everybody. Set means the sweep leaves their nickname entirely alone.
        nicknameOverride: overrides.get(v.userId) ?? null,
      };
    });
  }

  async recordSquadron(
    userId: string,
    reported: string | null,
    matched: boolean,
    at: Date,
  ): Promise<void> {
    /*
     * ★ THE NIGHTLY AUDIT'S HALF OF THE CONFIRM PATH — READ BEFORE WRITE ★
     *
     * Squadron owner, 2026-08-04: nothing in the catalogue left unwired. The audit re-checks
     * EVERYONE nightly, so unlike the twenty-minute sweep its input is not a transition list —
     * the transition has to be observed here, by reading whether the squadron half was
     * unconfirmed before this write confirms it. Without the guard, every verified member would
     * be re-congratulated at 00:15, nightly, forever.
     */
    const wasUnconfirmed = matched
      ? (await this.db.cmdrVerification.findFirst({
          where: { userId, isVerified: true, revokedAt: null, squadronVerifiedAt: null },
          select: { userId: true },
        })) !== null
      : false;

    await this.db.cmdrVerification.updateMany({
      where: { userId, isVerified: true, revokedAt: null },
      data: {
        inaraSquadron: reported,
        // Set AND cleared. A member who leaves must stop showing as confirmed;
        // a one-way flag would leave last month's departure looking current.
        squadronVerifiedAt: matched ? at : null,
        squadronCheckedAt: at,
      },
    });

    if (wasUnconfirmed && matched) {
      /*
       * ★ MIRRORED IN apps/api/src/cmdr/inara-link.store.prisma.ts AND inara-sync.ts —
       * KEEP THE COPY IDENTICAL ★ Failure swallowed: the member IS verified either way.
       */
      try {
        await notifyMembers(
          this.db,
          [userId],
          {
            kind: 'verification.confirmed',
            title: 'Your commander is fully verified',
            body: 'Inara confirms your commander and your squadron membership. Every member area is open to you.',
            link: '/settings/commander',
          },
          notificationNudge,
        );

        const member = await this.db.user.findUnique({
          where: { id: userId },
          select: { displayName: true, handle: true },
        });
        const name = member?.displayName ?? member?.handle ?? 'A new member';

        await notifySquadron(
          this.db,
          {
            kind: 'member.verified',
            title: `${name} is verified — welcome them aboard`,
            body: 'Their commander and squadron membership are confirmed.',
            actorUserId: userId,
          },
          notificationNudge,
        );
      } catch {
        // See above: the verification stands whether or not the bell rang.
      }
    }
  }

  async rememberNickname(discordId: string, nickname: string): Promise<void> {
    // Both caches, or the next sweep reads the OLD value, sees a mismatch it
    // just fixed, and renames again — every night, forever.
    await Promise.all([
      this.db.discordIdentity.updateMany({ where: { discordId }, data: { guildNick: nickname } }),
      this.db.discordGuildMember.updateMany({ where: { discordId }, data: { nick: nickname } }),
    ]);
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    /*
     * `before` and `after` are built conditionally rather than passed as
     * `?? undefined`. Under exactOptionalPropertyTypes an explicit `undefined`
     * is not the same as an absent key, and Prisma's generated input type
     * refuses it — correctly, since "this column is absent from the write" and
     * "write undefined to this column" are different instructions.
     */
    const before = entry['before'];
    const after = entry['after'];

    await this.db.auditLog.create({
      data: {
        actorId: null,
        actorType: 'system',
        action: String(entry['action']),
        targetType: (entry['targetType'] as string | undefined) ?? null,
        targetId: (entry['targetId'] as string | undefined) ?? null,
        ...(before === undefined || before === null ? {} : { before: before as object }),
        ...(after === undefined || after === null ? {} : { after: after as object }),
      },
    });
  }
}

export class AdapterAuditSource implements AuditSource {
  constructor(private readonly inara: InaraAdapter) {}

  async ownSquadron(apiKey: string): Promise<{ squadronName: string | null } | null> {
    const identity = await this.inara.getOwnIdentity(apiKey);
    return identity === null ? null : { squadronName: identity.squadronName };
  }

  /**
   * Public profiles, thirty to a request.
   *
   * Members without a key of their own are the cheap case: they batch, so a
   * hundred of them cost four requests rather than a hundred.
   */
  async publicSquadrons(names: readonly string[]) {
    const profiles = await this.inara.getCommanderProfiles(names);
    return new Map(
      [...profiles].map(([name, p]) => [
        name,
        p === null ? null : { squadronName: p.squadronName },
      ]),
    );
  }
}

export class AdapterNicknameSetter implements NicknameSetter {
  constructor(
    private readonly discord: DiscordAdapter,
    private readonly guildId: string,
  ) {}

  async set(discordId: string, nickname: string) {
    return this.discord.setMemberNickname(this.guildId, discordId, nickname);
  }
}
