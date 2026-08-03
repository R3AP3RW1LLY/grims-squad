import type { PrismaClient } from '@grims/db';
import { AppError, ErrorCode, Permission } from '@grims/shared';

/**
 * Fleet carriers helping with a build.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we also need a way to add fleet carriers to the project like raven colonial does", and
 * "squadron carriers too".
 *
 * ★ THE HOLD COMES FROM THE MARKET MIRROR, NOT FROM A JOURNAL ★
 *
 * The obvious design reads the carrier's cargo out of its owner's journal. It is the wrong one, and
 * measurably so:
 *
 *   - It only works for the ONE member whose PC is running the app. A squadron's carriers belong to
 *     several people, and the one hauling for the build is rarely the one with the app open.
 *   - The journal reports transfers as DELTAS, so a member who moves cargo with the app closed
 *     leaves the total permanently wrong.
 *   - It cannot see a carrier before it is attached, so nobody could search for one.
 *
 * A carrier's market is public. EDDN carries it, our mirror already holds 24,525 of them, and a
 * carrier being used for a build is exactly a carrier with tens of thousands of tonnes of steel on
 * its market. Measured against the real mirror: 7BB7 at Synuefe VS-L c10-3 is holding 50,785 t of
 * Steel, HOLV 43,086 t of Titanium. That is the feature, already in the database.
 *
 * ★ WHICH MEANS THE READING HAS AN AGE, AND IT IS NEVER HIDDEN ★
 *
 * A carrier is the one station that can be somewhere else tomorrow, so a six-month-old reading of
 * its hold is worth much less than a six-month-old reading of a starport's. Every figure here
 * carries the timestamp it was seen at, and the page prints it.
 */

/** What one carrier is holding of the things a build wants. */
export interface CarrierHold {
  readonly commodity: string;
  readonly tonnes: number;
  readonly seenAt: Date | null;
}

export interface AttachedCarrier {
  readonly marketId: string;
  readonly name: string;
  readonly callsign: string | null;
  readonly isSquadron: boolean;
  readonly addedBy: string | null;
  /** Where it was when somebody last looked. Null when the mirror has never seen it. */
  readonly systemName: string | null;
  readonly seenAt: Date | null;
  readonly holds: readonly CarrierHold[];
  /** Everything it holds of what this build wants, added up. */
  readonly totalTonnes: number;
}

/** A carrier somebody could attach, found by callsign or name. */
export interface CarrierMatch {
  readonly marketId: string;
  readonly name: string;
  readonly systemName: string;
  readonly seenAt: Date | null;
  /** How many of the build's commodities it is carrying, so the useful ones sort first. */
  readonly matchingCommodities: number;
  readonly matchingTonnes: number;
}

const CARRIER_TYPE = 'Drake-Class Carrier';

/**
 * ★ `station_key` IS `"<systemAddress>/<stationName>"`, NOT `"<marketId>/…"` ★
 *
 * This code read the first segment as a market id, and it is not one. Found by attaching a real
 * carrier and watching the wrong name come back: HOLV went in and JHT-25Z came out, because both
 * are parked in the same system and both keys begin with that system's address.
 *
 * The consequence was much worse than a wrong label. Matching `"<firstSegment>/%"` selects EVERY
 * CARRIER IN THAT SYSTEM — one system address in our mirror carries ninety-four of them, and one
 * commodity appears on twenty separate rows under a single first segment. A build would have been
 * told it had twenty times the cargo it had, which is exactly the kind of number somebody cancels a
 * shopping trip over.
 *
 * The market id lives in the galaxy catalogue alongside the key, so that is where it is read from.
 * Nothing here derives an identity from a string it does not own.
 */
const CARRIER_STATION = `
  SELECT ext_key, name, data->>'marketId' AS market_id
    FROM knowledge_items
   WHERE source = 'galaxy' AND kind = 'station' AND data->>'type' = '${CARRIER_TYPE}'`;

export class ColonyCarrierService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Carriers matching what somebody typed, ranked by how useful they are to THIS build.
   *
   * A callsign is four characters and there are 24,525 of them, so a name search alone returns
   * noise. Ranking by how much of the build's own shopping list a carrier is holding puts the one
   * they are actually looking for at the top — and makes the search answer a better question than
   * the one asked: not "which carriers are called this" but "which of them can help".
   */
  async search(projectId: string, term: string): Promise<readonly CarrierMatch[]> {
    const q = term.trim();

    /*
     * ★ AN EMPTY SEARCH IS THE MOST USEFUL SEARCH ★
     *
     * Found by using it: with a name required, a member wanting to know "which carriers could help
     * this build" had to guess a four-character callsign out of twenty-four thousand. The question
     * they actually have is the one this can answer best — so an empty box lists the carriers
     * holding the most of what the build still wants, and typing narrows that.
     *
     * The INNER join carries the ranking either way: a carrier holding nothing on the list is not
     * an answer to either question.
     */
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH carriers AS (${CARRIER_STATION})
       SELECT c.market_id, m.station_name, m.system_name,
              max(m.market_seen_at) AS seen_at,
              count(*)::int AS matching,
              sum(m.supply)::bigint AS matching_tonnes
         FROM market_entries m
         JOIN carriers c ON c.ext_key = m.station_key
         JOIN colony_needs n
           ON n.commodity = m.commodity AND n.project_id = $1::uuid AND n.remaining > 0
        WHERE m.supply > 0
          AND ($2 = '' OR m.station_name ILIKE $3)
        GROUP BY c.market_id, m.station_name, m.system_name
        ORDER BY matching_tonnes DESC, m.station_name
        LIMIT 20`,
      projectId,
      q,
      `%${q}%`,
    );

    return rows.map((r) => ({
      marketId: String(r['market_id']),
      name: String(r['station_name']),
      systemName: String(r['system_name']),
      seenAt: (r['seen_at'] as Date | null) ?? null,
      matchingCommodities: Number(r['matching']),
      matchingTonnes: Number(r['matching_tonnes']),
    }));
  }

  /**
   * Attaches a carrier to a build.
   *
   * ★ ANYBODY ON THE PROJECT MAY, WHICH IS THE OWNER'S CHOICE ★
   *
   * "A carrier is attached by ANYBODY on the project who owns it — because a big build is exactly
   * where somebody offers their carrier to a project that is not theirs." Marking it as the
   * SQUADRON'S is the officer's call, because that is a claim about whose it is.
   */
  async attach(input: {
    projectId: string;
    marketId: string;
    isSquadron: boolean;
    callerId: string;
    callerMask: bigint;
  }): Promise<{ marketId: string }> {
    if (!/^\d+$/.test(input.marketId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not a carrier we can identify.');
    }
    if (
      input.isSquadron &&
      (input.callerMask & Permission.COLONY_MANAGE) !== Permission.COLONY_MANAGE
    ) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Only officers can mark a carrier as the squadron’s.',
      );
    }

    const [found] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH carriers AS (${CARRIER_STATION})
       SELECT c.name FROM carriers c WHERE c.market_id = $1 LIMIT 1`,
      input.marketId,
    );

    if (found === undefined) {
      /*
       * Refused rather than stored blind. A carrier nobody has ever uploaded a market for would
       * attach happily and then show an empty hold for ever, which reads as "this carrier is empty"
       * rather than "we have never seen it" — and those are very different things to tell somebody
       * planning a haul.
       */
      throw new AppError(
        // The catalogue has no bare NOT_FOUND. `RESOURCE_NOT_VISIBLE` is the 404 for anything we
        // hold or do not hold, which is exactly what this is.
        ErrorCode.RESOURCE_NOT_VISIBLE,
        'Nobody has reported that carrier’s market yet. Dock at it once and it will appear.',
      );
    }

    const name = String(found['name']);
    // The callsign is what everybody says out loud. It is the whole name for most carriers, and the
    // trailing bracketed part when an owner has titled theirs.
    const callsign = /^([A-Z0-9]{3}-[A-Z0-9]{3})\b/.exec(name)?.[1] ?? name.slice(0, 12);

    await this.db.$executeRawUnsafe(
      `INSERT INTO colony_carriers (project_id, market_id, name, callsign, is_squadron, added_by_id, added_at)
       VALUES ($1::uuid, $2::bigint, $3, $4, $5, $6::uuid, now())
       ON CONFLICT (project_id, market_id) DO UPDATE SET
         name = EXCLUDED.name, callsign = EXCLUDED.callsign, is_squadron = EXCLUDED.is_squadron`,
      input.projectId,
      input.marketId,
      name,
      callsign,
      input.isSquadron,
      input.callerId,
    );

    return { marketId: input.marketId };
  }

  async detach(input: {
    projectId: string;
    marketId: string;
    callerId: string;
    callerMask: bigint;
  }): Promise<void> {
    const [row] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT added_by_id::text AS added_by_id FROM colony_carriers
        WHERE project_id = $1::uuid AND market_id = $2::bigint`,
      input.projectId,
      input.marketId,
    );
    if (row === undefined) return;

    /*
     * Whoever attached it, or an officer. Anybody being able to detach anybody's carrier would let
     * one member quietly remove the twenty thousand tonnes another was counting on.
     */
    const mine = String(row['added_by_id']) === input.callerId;
    const officer = (input.callerMask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE;
    if (!mine && !officer) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Only whoever added that carrier, or an officer, can take it off the build.',
      );
    }

    await this.db.$executeRawUnsafe(
      `DELETE FROM colony_carriers WHERE project_id = $1::uuid AND market_id = $2::bigint`,
      input.projectId,
      input.marketId,
    );
  }

  /**
   * Every carrier on a build, and what each is holding of what the build still wants.
   *
   * ★ ONE QUERY, NOT ONE PER CARRIER ★
   *
   * A big build has half a dozen carriers and twenty-odd outstanding commodities. Asking per
   * carrier is a round trip each; asking per carrier per commodity is over a hundred.
   */
  async forProject(projectId: string): Promise<readonly AttachedCarrier[]> {
    const carriers = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT c.market_id::text AS market_id, c.name, c.callsign, c.is_squadron,
              u.display_name AS added_by
         FROM colony_carriers c
         LEFT JOIN users u ON u.id = c.added_by_id
        WHERE c.project_id = $1::uuid
        ORDER BY c.is_squadron DESC, c.name`,
      projectId,
    );

    if (carriers.length === 0) return [];

    const ids = carriers.map((c) => String(c['market_id']));

    const holds = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH carriers AS (${CARRIER_STATION})
       SELECT c.market_id, m.system_name, m.commodity, m.supply, m.market_seen_at
         FROM market_entries m
         JOIN carriers c ON c.ext_key = m.station_key
         JOIN colony_needs n ON n.commodity = m.commodity
        WHERE m.supply > 0
          AND n.project_id = $1::uuid
          AND n.remaining > 0
          AND c.market_id = ANY($2::text[])
        ORDER BY m.supply DESC`,
      projectId,
      ids,
    );

    const byCarrier = new Map<string, Array<Record<string, unknown>>>();
    for (const h of holds) {
      const key = String(h['market_id']);
      byCarrier.set(key, [...(byCarrier.get(key) ?? []), h]);
    }

    return carriers.map((c) => {
      const marketId = String(c['market_id']);
      const mine = byCarrier.get(marketId) ?? [];

      return {
        marketId,
        name: String(c['name']),
        callsign: c['callsign'] === null ? null : String(c['callsign']),
        isSquadron: c['is_squadron'] === true,
        addedBy: c['added_by'] === null ? null : String(c['added_by']),
        systemName: mine[0] === undefined ? null : String(mine[0]['system_name']),
        // The freshest line we hold for it. A carrier's whole market is uploaded at once, so this
        // dates the reading rather than one commodity of it.
        seenAt: mine.reduce<Date | null>((newest, h) => {
          const at = (h['market_seen_at'] as Date | null) ?? null;
          if (at === null) return newest;
          return newest === null || at > newest ? at : newest;
        }, null),
        holds: mine.map((h) => ({
          commodity: String(h['commodity']),
          tonnes: Number(h['supply']),
          seenAt: (h['market_seen_at'] as Date | null) ?? null,
        })),
        totalTonnes: mine.reduce((sum, h) => sum + Number(h['supply']), 0),
      };
    });
  }
}
