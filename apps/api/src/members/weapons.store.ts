import { PrismaClient } from '@grims/db';

/**
 * What the squadron carries on foot.
 *
 * ★ SQUADRON OWNER'S LIST: "SuitLoadout weapons chart" ★
 *
 * ★ NOTHING WAS COLLECTING IT ★
 *
 * `SuitLoadout` was not in the journal registry at all, so the ingest had no category for it and
 * every one ever sent was discarded — `telemetry_events` held zero. It is now a declared, optional,
 * separately-refusable category (`onfoot`), which is why this can exist.
 *
 * That also means the chart is EMPTY until members run a version of the app that sends it and
 * actually go on foot. That is not a fault to hide behind a spinner — the page says so.
 */

export interface WeaponUse {
  /** The weapon, as Frontier names it in English. */
  readonly name: string;
  /** How many distinct members carry it. The headline number. */
  readonly members: number;
  /** How many loadouts it appears in, across everybody. */
  readonly loadouts: number;
}

export interface SuitUse {
  readonly name: string;
  readonly members: number;
}

export interface WeaponsChart {
  readonly weapons: readonly WeaponUse[];
  readonly suits: readonly SuitUse[];
  /** Members who have reported any on-foot loadout at all. The denominator. */
  readonly members: number;
}

export class WeaponsStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async chart(): Promise<WeaponsChart> {
    /*
     * ★ COUNTED BY MEMBER, NOT BY EVENT ★
     *
     * A commander who edits one loadout six times in an evening sends six events. Counting rows
     * would report their rifle as six times more popular than a weapon carried by six different
     * people — and the whole question this chart answers is "what does the squadron use", which is
     * a question about people.
     *
     * So the distinct member count is the headline, and the loadout count sits behind it for
     * anybody who wants to know whether one weapon dominates a member's own builds too.
     */
    const weapons = await this.#db.$queryRawUnsafe<
      Array<{ name: string; members: bigint; loadouts: bigint }>
    >(
      `SELECT COALESCE(m->>'ModuleName_Localised', m->>'ModuleName')  AS name,
              COUNT(DISTINCT e.user_id)                               AS members,
              COUNT(*)                                                AS loadouts
         FROM telemetry_events e
         -- The weapon list. A loadout with no modules contributes nothing rather than a null row.
         CROSS JOIN LATERAL jsonb_array_elements(e.payload->'Modules') AS m
        WHERE e.event_type = 'SuitLoadout'
          AND jsonb_typeof(e.payload->'Modules') = 'array'
          AND COALESCE(m->>'ModuleName_Localised', m->>'ModuleName') IS NOT NULL
        GROUP BY 1
        ORDER BY members DESC, loadouts DESC
        LIMIT 40`,
    );

    const suits = await this.#db.$queryRawUnsafe<Array<{ name: string; members: bigint }>>(
      `SELECT COALESCE(payload->>'SuitName_Localised', payload->>'SuitName') AS name,
              COUNT(DISTINCT user_id)                                        AS members
         FROM telemetry_events
        WHERE event_type = 'SuitLoadout'
          AND COALESCE(payload->>'SuitName_Localised', payload->>'SuitName') IS NOT NULL
        GROUP BY 1
        ORDER BY members DESC
        LIMIT 12`,
    );

    const [total] = await this.#db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(DISTINCT user_id) AS n FROM telemetry_events WHERE event_type = 'SuitLoadout'`,
    );

    return {
      weapons: weapons.map((w) => ({
        name: w.name,
        members: Number(w.members),
        loadouts: Number(w.loadouts),
      })),
      suits: suits.map((s) => ({ name: s.name, members: Number(s.members) })),
      members: Number(total?.n ?? 0),
    };
  }
}
