import type { PrismaClient } from '@prisma/client';
import type { DiscordAdapter } from '@grims/ed-clients';
import type { RankApplier } from '@grims/shared';

/**
 * Applies a rank change in Discord (P1 — rank progression).
 *
 * ★ WHY DISCORD AND NOT JUST OUR DATABASE ★
 *
 * Ladder ranks are mapped to Discord roles so reconciliation can learn who
 * holds what without 108 people being entered by hand. That makes Discord the
 * thing reconciliation trusts — so a promotion recorded only here would be
 * handed straight back on the next nightly run, and the member would end up
 * holding both ranks, violating `single_rank`.
 *
 * ★ ORDER WITHIN THE CHANGE ★
 *
 * ADD the new rank, then REMOVE the old one. If the process dies between them
 * the member briefly holds two ranks, which is untidy and self-corrects on the
 * next run. The other order leaves them holding NONE, which reads to everyone
 * in the guild as a demotion — and to the reconciler as a member with no rank
 * at all.
 */
export class DiscordRankApplier implements RankApplier {
  readonly #db: PrismaClient;
  readonly #discord: DiscordAdapter;
  readonly #guildId: string;

  constructor(db: PrismaClient, discord: DiscordAdapter, guildId: string) {
    this.#db = db;
    this.#discord = discord;
    this.#guildId = guildId;
  }

  /**
   * The Discord role id for a platform rank NAME.
   *
   * Read from role_mappings, never from source — snowflakes live in data
   * (INV-008), and a rank whose Discord role was recreated needs a mapping edit
   * rather than a deploy.
   */
  async #discordRoleFor(rankName: string): Promise<string | null> {
    const m = await this.#db.roleMapping.findFirst({
      where: { role: { name: rankName } },
      select: { discordRoleId: true },
    });
    return m?.discordRoleId ?? null;
  }

  async #discordIdFor(userId: string): Promise<string | null> {
    const i = await this.#db.discordIdentity.findUnique({
      where: { userId },
      select: { discordId: true },
    });
    return i?.discordId ?? null;
  }

  async applyRank(userId: string, fromRank: string, toRank: string): Promise<void> {
    const discordId = await this.#discordIdFor(userId);
    if (discordId === null) {
      // No linked Discord account. THROWS rather than skipping quietly: the
      // engine treats a throw as "do not write our row either", which keeps
      // both sides consistent and puts the member in the failed list where
      // somebody will see them.
      throw new Error(`No linked Discord account for user ${userId}.`);
    }

    const toRoleId = await this.#discordRoleFor(toRank);
    if (toRoleId === null) {
      throw new Error(`No Discord role mapped for rank "${toRank}".`);
    }

    // NEW RANK FIRST. See the note above on why this order and not the other.
    await this.#discord.addRoleToMember(this.#guildId, discordId, toRoleId);

    const fromRoleId = await this.#discordRoleFor(fromRank);
    if (fromRoleId !== null && fromRoleId !== toRoleId) {
      await this.#discord.removeRoleFromMember(this.#guildId, discordId, fromRoleId);
    }
  }
}

/**
 * The Discord role ids this job may touch: exactly the ten ladder ranks, read
 * from the database.
 *
 * The adapter refuses any role outside its grantable list, and that ceiling is
 * OURS rather than Discord's — the bot sits above every leadership role in the
 * guild, so Discord's own hierarchy check would happily let it hand out
 * Galactic Admiral. Deriving the list from the mappings means the promotion job
 * can move somebody between Cadet and Grand Master General and can do nothing
 * else whatsoever, including on the day somebody widens the mappings table for
 * an unrelated reason.
 */
export async function ladderRoleIds(db: PrismaClient): Promise<string[]> {
  const rows = await db.roleMapping.findMany({
    // rank_order >= 100 is the ladder; leadership roles are 10..60 and
    // Webmaster is 1000. Matching on the ORDER rather than on names means a
    // renamed rank keeps working and a new leadership role never slips in.
    where: { role: { rankOrder: { gte: 100, lt: 1000 } } },
    select: { discordRoleId: true },
  });
  return rows.map((r) => r.discordRoleId);
}
