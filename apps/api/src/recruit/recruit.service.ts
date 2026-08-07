import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import {
  AppError,
  ErrorCode,
  canMintInvite,
  milestonePoints,
  RECRUIT_MILESTONES,
  type MintRefusal,
  type RecruitMilestone,
} from '@grims/shared';

/**
 * A member's own invite, and the people who came through it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "a unique discord invite link for all members that are inara veriefied in our platform! ... we
 * want to encourage our playerbase to beable to invite people into the squadron!"
 *
 * ★ ONE LINK PER MEMBER, FOR EVER ★
 *
 * Minting twice returns the same code rather than creating a second door. Discord keeps every
 * invite until somebody deletes it, so a member clicking the button twice would otherwise leave an
 * orphan in the guild that still works and credits nobody — and the guild already carries
 * twenty-odd hand-made invites without us adding more.
 */

/** What a refusal means, in words a member can act on. */
const REFUSAL_TEXT: Record<MintRefusal, string> = {
  permission:
    'Recruiting has been switched off for your account. An officer can turn it back on.',
  /*
   * The most important of the three: this member is one action away from being able to recruit,
   * and the sentence should read as an invitation rather than a refusal.
   */
  inara:
    'Add your Inara API key in Commander Management first — a verified commander is what lets us hand you the squadron’s front door.',
  rank: 'Recruiting opens at Cadet, which is one qualifying month. Not long now.',
};

export interface RecruitStatus {
  /** The invite URL, when they have one. Null when they cannot mint or have not yet. */
  readonly link: string | null;
  readonly canMint: boolean;
  /** Why not, in words. Null when they can. */
  readonly blockedBecause: string | null;
  readonly recruits: readonly {
    readonly name: string;
    readonly joinedAt: Date;
    readonly milestones: readonly RecruitMilestone[];
    readonly points: number;
  }[];
  readonly totalPoints: number;
}

@Injectable()
export class RecruitService {
  constructor(
    private readonly db: PrismaClient,
    @Inject('DISCORD_BOT_TOKEN') private readonly botToken: string,
    @Inject('DISCORD_GUILD_ID') private readonly guildId: string,
    @Inject('DISCORD_INVITE_CHANNEL_ID') private readonly channelId: string,
  ) {}

  /** Everything the member's recruit page needs, in one read. */
  async status(userId: string, mask: bigint): Promise<RecruitStatus> {
    const [gate] = await this.db.$queryRawUnsafe<
      Array<{ verified: boolean; rank_order: number | null; code: string | null }>
    >(
      `SELECT
         EXISTS (SELECT 1 FROM inara_links il
                  WHERE il.user_id = u.id AND il.verified_at IS NOT NULL) AS verified,
         (SELECT max(r.rank_order)
            FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id) AS rank_order,
         (SELECT ri.code FROM recruit_invites ri
           WHERE ri.user_id = u.id AND ri.revoked_at IS NULL) AS code
       FROM users u WHERE u.id = $1::uuid`,
      userId,
    );

    const verdict = canMintInvite({
      mask,
      inaraVerified: gate?.verified === true,
      rankOrder: gate?.rank_order ?? null,
    });

    const rows = await this.db.$queryRawUnsafe<
      Array<{ name: string; joined_at: Date; milestones: string[]; points: number }>
    >(
      `SELECT
         COALESCE(u.display_name, g.username, j.discord_id) AS name,
         j.joined_at,
         COALESCE(array_agg(m.milestone) FILTER (WHERE m.milestone IS NOT NULL), '{}') AS milestones,
         COALESCE(sum(m.points), 0)::int AS points
       FROM recruit_joins j
       LEFT JOIN users u ON u.id = j.user_id
       LEFT JOIN discord_guild_members g ON g.discord_id = j.discord_id
       LEFT JOIN recruit_milestones m ON m.discord_id = j.discord_id
      WHERE j.recruiter_id = $1::uuid AND j.voided_at IS NULL
      GROUP BY j.discord_id, u.display_name, g.username, j.joined_at
      ORDER BY j.joined_at DESC
      LIMIT 200`,
      userId,
    );

    return {
      link: gate?.code == null ? null : `https://discord.gg/${gate.code}`,
      canMint: verdict.allowed,
      blockedBecause: verdict.reason === null ? null : REFUSAL_TEXT[verdict.reason],
      recruits: rows.map((r) => ({
        name: r.name,
        joinedAt: r.joined_at,
        // Ordered by the ladder rather than by the array's arrival order, so the page can draw a
        // progression rather than a bag.
        milestones: RECRUIT_MILESTONES.filter((m) => r.milestones.includes(m)),
        points: r.points,
      })),
      totalPoints: rows.reduce((n, r) => n + r.points, 0),
    };
  }

  /**
   * Mint the member's link, or hand back the one they already have.
   *
   * ★ THE GATE IS CHECKED HERE, NOT ONLY ON THE PAGE ★
   *
   * A page that hides the button is a courtesy; this is the rule. The permission, the verification
   * and the rank are all re-read from the database at the moment of minting, because all three can
   * change between a page load and a click — and a revoked recruiter clicking a stale button must
   * not get a link.
   */
  async mint(userId: string, mask: bigint): Promise<{ link: string }> {
    const [gate] = await this.db.$queryRawUnsafe<
      Array<{ verified: boolean; rank_order: number | null; code: string | null }>
    >(
      `SELECT
         EXISTS (SELECT 1 FROM inara_links il
                  WHERE il.user_id = u.id AND il.verified_at IS NOT NULL) AS verified,
         (SELECT max(r.rank_order)
            FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id) AS rank_order,
         (SELECT ri.code FROM recruit_invites ri
           WHERE ri.user_id = u.id AND ri.revoked_at IS NULL) AS code
       FROM users u WHERE u.id = $1::uuid`,
      userId,
    );

    const verdict = canMintInvite({
      mask,
      inaraVerified: gate?.verified === true,
      rankOrder: gate?.rank_order ?? null,
    });
    if (!verdict.allowed) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        REFUSAL_TEXT[verdict.reason ?? 'permission'],
      );
    }

    // Already has one. Returning it is the whole "one link per member, for ever" rule.
    if (gate?.code != null) return { link: `https://discord.gg/${gate.code}` };

    if (this.botToken === '' || this.guildId === '' || this.channelId === '') {
      /*
       * Said plainly rather than swallowed. A recruit page whose button silently does nothing
       * because a channel id is unset looks identical to Discord being down.
       */
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        'Invites are not configured on this server yet. An officer needs to set the invite channel.',
      );
    }

    const res = await fetch(`https://discord.com/api/v10/channels/${this.channelId}/invites`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${this.botToken}`,
        'content-type': 'application/json',
        // Discord shows this in the audit log, which is where an officer will look when they want
        // to know why the guild suddenly has a hundred invites.
        'x-audit-log-reason': `Recruit link for ${userId}`,
      },
      body: JSON.stringify({
        /*
         * Never expires and has no use limit, deliberately. A recruiter's link is a standing thing
         * they put in a signature or a video description — one that quietly stopped working would
         * cost them every recruit after it and tell nobody.
         *
         * `unique` matters most: without it Discord may hand back an EXISTING equivalent invite,
         * and two members would share a code. Attribution counts uses per code, so that would
         * credit one member for the other's recruits.
         */
        max_age: 0,
        max_uses: 0,
        unique: true,
      }),
    });

    if (!res.ok) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        'Discord would not create the invite. An officer should check the bot’s permissions.',
      );
    }

    const body = (await res.json()) as { code?: unknown };
    const code = typeof body.code === 'string' ? body.code : null;
    if (code === null) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Discord sent back an invite we could not read.');
    }

    /*
     * ON CONFLICT DO NOTHING, then read back. Two clicks in the same second would otherwise both
     * insert — and the loser would have created a real Discord invite that no row points at,
     * leaving an orphan in the guild that works and credits nobody.
     */
    await this.db.$executeRawUnsafe(
      `INSERT INTO recruit_invites (user_id, code) VALUES ($1::uuid, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      userId,
      code,
    );

    const [saved] = await this.db.$queryRawUnsafe<Array<{ code: string }>>(
      `SELECT code FROM recruit_invites WHERE user_id = $1::uuid`,
      userId,
    );

    return { link: `https://discord.gg/${saved?.code ?? code}` };
  }

  /** What each rung of the ladder is worth, for the page to explain itself. */
  ladder(): ReadonlyArray<{ milestone: RecruitMilestone; points: number }> {
    return RECRUIT_MILESTONES.map((milestone) => ({
      milestone,
      points: milestonePoints(milestone),
    }));
  }
}
