import { AppError, ErrorCode, composeNickname, humanizeCommanderName, MAX_NICK } from '@grims/shared';
import type { PrismaClient } from '@grims/db';

/**
 * Who wears what, and who is allowed to choose.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "add a step to onboarding that allows them to overide their discord server nickname ... if an
 * officer overrides their name, then this is the name that stays as their discord nickname it
 * should not change from that unless they change it."
 *
 * Asked who may hold one, the owner chose: "Officers, and anyone an officer grants it to."
 *
 * ★ THE RIGHT IS COMPUTED, THE GRANT IS STORED ★
 *
 * Being an officer is not a column here — it is read from the rank they hold, so somebody promoted
 * this morning can choose their name this afternoon without anybody running a backfill, and
 * somebody stepping down loses the ability to change it without an officer remembering to revoke
 * anything.
 *
 * `nicknameOverrideAllowed` is only for the other half: a member who is not an officer and has been
 * granted it anyway. That one has to be stored, because there is nothing to derive it from.
 *
 * ★ WHAT HAPPENS TO A NAME THEY ALREADY CHOSE, IF THE RIGHT GOES AWAY ★
 *
 * Nothing, here. The override stays in the column and stops being honoured, because the sweep asks
 * this service whether they may hold one. Deleting it on demotion would be tidier and would also
 * silently rename somebody as a side effect of a role change nobody connected to their name.
 */

/** Below this rank order is a leadership appointment. Squadron Leader is 60; Cadet is 100. */
const OFFICER_CEILING = 100;

export interface NicknameState {
  /** What they wear now, or would wear. */
  readonly nickname: string | null;
  /** What the convention would give them, or null with no verified name. */
  readonly convention: string | null;
  /** Their own choice, or null when they follow the convention. */
  readonly override: string | null;
  /** `web`, `discord`, or null. */
  readonly source: string | null;
  /** Whether they may set one at all. */
  readonly mayOverride: boolean;
  /** True when they hold no verified Inara name — the nudge, not a rename. */
  readonly unverified: boolean;
}

export class NicknameService {
  constructor(
    private readonly db: PrismaClient,
    /**
     * Sets the guild nickname. Null when the bot is not configured, which is the ordinary state in
     * a development environment and must not make choosing a name fail.
     */
    private readonly guild: {
      readonly guildId: string;
      set(guildId: string, discordId: string, nick: string): Promise<{ ok: boolean; reason: string | null }>;
    } | null = null,
  ) {}

  /**
   * Writes a chosen nickname to the guild.
   *
   * ★ WHY THIS EXISTS AT ALL ★
   *
   * The nightly sweep SKIPS anybody holding an override, which is the whole point of one. So if
   * nothing wrote it here, a member would choose their name, see it confirmed, and find the old one
   * still in the member list forever — the feature would appear to work and do nothing.
   *
   * Never throws. The guild owner cannot be renamed by a bot, a member above the bot's role cannot
   * either, and Discord rate limits; none of those are reasons to lose the member's choice, which
   * is already recorded by the time this runs.
   */
  async pushToGuild(userId: string, nickname: string | null): Promise<{ ok: boolean; reason: string | null }> {
    if (this.guild === null) return { ok: false, reason: 'Discord is not configured here.' };
    if (nickname === null || nickname.trim() === '') {
      return { ok: false, reason: 'There is no name to set yet.' };
    }

    try {
      const identity = await this.db.discordIdentity.findFirst({
        where: { userId },
        select: { discordId: true },
      });
      if (identity === null) return { ok: false, reason: 'No Discord account is linked.' };

      const result = await this.guild.set(this.guild.guildId, identity.discordId, nickname);
      if (result.ok) {
        // Our stored copy moves with it, or the next check reads the old value and disagrees with
        // the guild about what this member is called.
        await this.db.discordIdentity
          .updateMany({ where: { userId }, data: { guildNick: nickname } })
          .catch(() => undefined);
      }
      return result;
    } catch {
      // Deliberately opaque: the failing call carries a bot token, and upstream error payloads
      // have a habit of echoing request context.
      return { ok: false, reason: 'Discord could not be reached just now.' };
    }
  }

  /**
   * Whether this member may choose their own nickname.
   *
   * Officer by rank, or granted. Read from the Discord roles they WEAR rather than granted internal
   * roles, matching how the rank prefix and the nightly sweep have always resolved rank: the guild
   * is the authority on who is an officer, and most of the squadron has no reconciled account.
   */
  async mayOverride(userId: string): Promise<boolean> {
    const [user, identity, mappings] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: { nicknameOverrideAllowed: true },
      }),
      this.db.discordIdentity.findFirst({ where: { userId }, select: { discordId: true } }),
      this.db.roleMapping.findMany({
        where: { role: { isHierarchical: true } },
        select: { discordRoleId: true, role: { select: { rankOrder: true } } },
      }),
    ]);

    if (user?.nicknameOverrideAllowed === true) return true;
    if (identity === null) return false;

    const member = await this.db.discordGuildMember.findUnique({
      where: { discordId: identity.discordId },
      select: { roles: true },
    });
    if (member === null) return false;

    const orderByRoleId = new Map(mappings.map((m) => [m.discordRoleId, m.role.rankOrder]));
    return member.roles.some((id) => {
      const order = orderByRoleId.get(id);
      return order !== undefined && order !== null && order < OFFICER_CEILING;
    });
  }

  /** Everything the settings page and the onboarding step need to show. */
  async state(userId: string): Promise<NicknameState> {
    const [user, verification, mayOverride] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: { nicknameOverride: true, nicknameOverrideSource: true },
      }),
      this.db.cmdrVerification.findFirst({
        where: { userId, isVerified: true, revokedAt: null },
        select: { cmdrName: true },
      }),
      this.mayOverride(userId),
    ]);

    const convention =
      verification === null ? null : composeNickname(null, verification.cmdrName);
    const override = user?.nicknameOverride ?? null;

    return {
      nickname: override ?? convention,
      convention,
      override,
      source: user?.nicknameOverrideSource ?? null,
      mayOverride,
      /*
       * The owner's answer for members with no Inara link was "Nudge them, then leave it". This is
       * the nudge: a fact the page can render, not a rename.
       */
      unverified: verification === null,
    };
  }

  /**
   * Sets a member's chosen nickname, or clears it.
   *
   * ★ HUMANIZED EVEN THOUGH IT IS THEIR CHOICE ★
   *
   * An override replaces which NAME they wear, not the house style. `pebblemerchant` still arrives
   * as `Pebblemerchant`, and a callsign still shouts. Letting an override skip the convention would
   * make the one thing the owner called non-negotiable optional for exactly the people asked to set
   * an example.
   */
  async setOverride(userId: string, raw: string | null, source: 'web'): Promise<NicknameState> {
    if (!(await this.mayOverride(userId))) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Your nickname follows your verified Inara name. An officer can grant you an exception.',
      );
    }

    const wanted = raw === null ? '' : humanizeCommanderName(raw).slice(0, MAX_NICK);

    if (wanted === '') {
      await this.db.user.update({
        where: { id: userId },
        data: { nicknameOverride: null, nicknameOverrideAt: null, nicknameOverrideSource: null },
      });
      return this.state(userId);
    }

    await this.db.user.update({
      where: { id: userId },
      data: {
        nicknameOverride: wanted,
        nicknameOverrideAt: new Date(),
        nicknameOverrideSource: source,
      },
    });

    return this.state(userId);
  }

  /**
   * An officer grants or withdraws the right for somebody who is not an officer.
   *
   * Withdrawing does NOT delete a name they already chose — see the note at the top. It stops being
   * honoured because every reader asks `mayOverride` first, and deleting it here would rename
   * somebody as a side effect of a permission change.
   */
  async setAllowed(targetUserId: string, allowed: boolean, actorId: string): Promise<void> {
    const before = await this.db.user.findUnique({
      where: { id: targetUserId },
      select: { nicknameOverrideAllowed: true },
    });

    await this.db.user.update({
      where: { id: targetUserId },
      data: { nicknameOverrideAllowed: allowed },
    });

    /*
     * Audited here rather than in the controller, because this is where the database is. An
     * exception to a rule the owner called non-negotiable is exactly the kind of decision somebody
     * will want to trace back to a person later.
     */
    await this.db.auditLog
      .create({
        data: {
          actorId,
          action: allowed ? 'nickname.exception.granted' : 'nickname.exception.revoked',
          targetType: 'user',
          targetId: targetUserId,
          before: { allowed: before?.nicknameOverrideAllowed ?? false } as never,
          after: { allowed } as never,
        },
      })
      .catch(() => undefined);
  }
}
