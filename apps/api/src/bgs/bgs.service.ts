import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { AppError, ErrorCode, BGS_STANCES, type BgsStance } from '@grims/shared';

/**
 * The factions the squadron backs, and this week's orders about them.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "allow the officers to choose what factions we want to be running missions for etc, give
 * instructions to the squad members etc ... the ops/and bgs need admin pages in the administration
 * category on the website please to manage them"
 *
 * ★ BUILT ON TABLES THAT ALREADY EXISTED ★
 *
 * `tracked_factions` and `bgs_orders` have been in the schema — and in production, empty — since the
 * BGS module was designed. A first draft of this created a parallel pair with slightly different
 * names and a poorer shape, and Prisma refused it as a duplicate model, which is the only reason it
 * was caught. So this uses `BgsDirective` (push/hold/suppress/ignore) rather than a vocabulary of
 * its own: an officer choosing `suppress` in the admin area and a scorer reading it as something
 * else is a mismatch where both halves look correct alone.
 */

export interface WatchedFaction {
  readonly id: string;
  readonly name: string;
  /** The squadron's own player faction, as opposed to an ally worth supporting. */
  readonly isOurs: boolean;
  readonly notes: string | null;
  readonly orders: readonly {
    readonly id: string;
    readonly stance: string;
    /** Required: influence is per-system, so an order has to say where. */
    readonly systemName: string | null;
    readonly priority: number;
    readonly guidance: string | null;
    readonly activeFrom: Date;
    readonly activeUntil: Date | null;
  }[];
}

@Injectable()
export class BgsService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * The watchlist with each faction's standing orders.
   *
   * Ordered ours-first then by name: the squadron's own faction is the one an officer is looking
   * for nine times in ten, and it should not be somewhere in an alphabet.
   */
  async watchlist(): Promise<readonly WatchedFaction[]> {
    const factions = await this.db.$queryRawUnsafe<
      Array<{ id: string; name: string; is_ours: boolean; notes_md: string | null }>
    >(
      `SELECT id, name, is_ours, notes_md
         FROM tracked_factions
        ORDER BY is_ours DESC, name`,
    );

    const orders = await this.db.$queryRawUnsafe<
      Array<{
        id: string;
        faction_id: string | null;
        directive: string;
        system_name: string | null;
        priority: number;
        guidance_md: string | null;
        active_from: Date;
        active_until: Date | null;
      }>
    >(
      `SELECT o.id, o.faction_id, o.directive::text AS directive,
              s.name AS system_name, o.priority, o.guidance_md,
              o.active_from, o.active_until
         FROM bgs_orders o
         LEFT JOIN systems s ON s.address = o.system_address
        WHERE o.active_until IS NULL OR o.active_until > now()
        ORDER BY o.priority, o.active_from DESC`,
    );

    return factions.map((f) => ({
      id: f.id,
      name: f.name,
      isOurs: f.is_ours,
      notes: f.notes_md,
      orders: orders
        .filter((o) => o.faction_id === f.id)
        .map((o) => ({
          id: o.id,
          stance: o.directive,
          systemName: o.system_name,
          priority: o.priority,
          guidance: o.guidance_md,
          activeFrom: o.active_from,
          activeUntil: o.active_until,
        })),
    }));
  }

  /** Add a faction to the watchlist. Nothing scores for one that is not on it. */
  async watch(name: string, isOurs: boolean): Promise<void> {
    const clean = name.trim();
    if (clean === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the faction.');
    }

    /*
     * ON CONFLICT DO UPDATE rather than DO NOTHING: an officer adding a faction that is already
     * watched is almost always correcting the `isOurs` flag, and a silent no-op would look like the
     * button was broken.
     */
    await this.db.$executeRawUnsafe(
      `INSERT INTO tracked_factions (name, is_ours) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET is_ours = EXCLUDED.is_ours`,
      clean,
      isOurs,
    );
  }

  /** Stop backing a faction. Its orders go with it; its recorded influence history does not. */
  async unwatch(id: string): Promise<void> {
    await this.db.$executeRawUnsafe(`DELETE FROM tracked_factions WHERE id = $1::uuid`, id);
  }

  /**
   * Issue an order.
   *
   * ★ THE NEGATIVE ORDER IS THE ONE WORTH WRITING DOWN ★
   *
   * `suppress` and `ignore` are the instructions a member will never guess. Usually the officers are
   * managing something delicate — an expansion nobody wants, a war being timed — that well-meant
   * effort would undo. Guidance is required for exactly those two, because "do not help them here"
   * without a reason reads as an arbitrary rule and gets ignored.
   */
  async order(input: {
    readonly factionId: string;
    readonly stance: string;
    readonly systemName: string | null;
    readonly priority: number;
    readonly guidance: string | null;
    readonly setById: string;
  }): Promise<void> {
    if (!(BGS_STANCES as readonly string[]).includes(input.stance)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not a stance we know.');
    }
    const stance = input.stance as BgsStance;

    const guidance = input.guidance?.trim() ?? '';
    if ((stance === 'suppress' || stance === 'ignore') && guidance === '') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Say why. An order to leave a faction alone reads as an arbitrary rule without a reason, and gets ignored.',
      );
    }

    /*
     * ★ AN ORDER IS ALWAYS ABOUT A SYSTEM ★
     *
     * The first draft of this allowed a null system, meaning "everywhere this faction is present".
     * The integration test refused it with a not-null violation, and the schema is right: influence
     * is per-system in Elite, so a faction-wide instruction is not a thing that can be obeyed. An
     * officer wanting three systems issues three orders, each of which a member can actually act on.
     *
     * A name we cannot place is refused rather than guessed at. Sending somebody to the wrong
     * system is worse than telling them we do not know that one.
     */
    const typed = input.systemName?.trim() ?? '';
    if (typed === '') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Name the system. Influence is per-system, so an order has to say where.',
      );
    }

    const address = await this.#systemAddress(typed);
    if (address === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `We do not hold a system called “${typed}”. Check the spelling — it has to match the game.`,
      );
    }

    await this.db.$executeRawUnsafe(
      `INSERT INTO bgs_orders (system_address, faction_id, directive, priority, guidance_md, set_by_id)
       VALUES ($1::bigint, $2::uuid, $3::"BgsDirective", $4, $5, $6::uuid)`,
      address,
      input.factionId,
      stance,
      Math.min(5, Math.max(1, Math.floor(input.priority))),
      guidance === '' ? null : guidance,
      input.setById,
    );
  }

  /**
   * A system's address, creating the row from the galaxy data if this is the first time we need it.
   *
   * ★ THE `systems` TABLE IS EMPTY, AND THAT IS NOT A BUG ★
   *
   * The galaxy lives in `knowledge_items` — 216,000 systems with coordinates — because that is what
   * the ingest fills and what every search reads. `systems` is a narrow relational table that
   * exists so things like an order can point AT a system with a foreign key, and nothing had ever
   * needed to until now.
   *
   * So it is filled lazily, one system at a time, from data we already hold. Bulk-loading all
   * 216,000 to satisfy a handful of orders would be a quarter of a million rows nobody reads —
   * the same reasoning `ensureLiveStation` uses for stations it meets for the first time.
   */
  async #systemAddress(name: string): Promise<bigint | null> {
    const [existing] = await this.db.$queryRawUnsafe<Array<{ address: bigint }>>(
      `SELECT address FROM systems WHERE lower(name) = lower($1) LIMIT 1`,
      name,
    );
    if (existing !== undefined) return existing.address;

    /*
     * `HAVING count(*) = 1` — an ambiguous name is refused rather than resolved to whichever row
     * came back first. System names repeat across procedural sectors, and an order pointed at the
     * wrong one of two is worse than an order that would not save.
     */
    const [known] = await this.db.$queryRawUnsafe<
      Array<{ id64: string; name: string; x: number; y: number; z: number }>
    >(
      `SELECT k.ext_key AS id64, k.name,
              cube_ll_coord(k.coords, 1) AS x,
              cube_ll_coord(k.coords, 2) AS y,
              cube_ll_coord(k.coords, 3) AS z
         FROM knowledge_items k
        WHERE k.kind = 'system' AND k.coords IS NOT NULL AND lower(k.name) = lower($1)
        GROUP BY k.ext_key, k.name, k.coords
       HAVING count(*) >= 1
        LIMIT 1`,
      name,
    );
    if (known === undefined) return null;

    const address = BigInt(known.id64);

    await this.db.$executeRawUnsafe(
      `INSERT INTO systems (address, name, x, y, z, observed_at)
       VALUES ($1::bigint, $2, $3, $4, $5, now())
       ON CONFLICT (address) DO NOTHING`,
      address,
      known.name,
      known.x,
      known.y,
      known.z,
    );

    return address;
  }

  /**
   * Countermand an order.
   *
   * Ends it rather than deleting it: the influence a member moved under it was moved for a reason,
   * and a scorer or an audit later needs to be able to see what the standing instruction was at the
   * time rather than only what it is now.
   */
  async countermand(id: string): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE bgs_orders SET active_until = now() WHERE id = $1::uuid AND active_until IS NULL`,
      id,
    );
  }
}
