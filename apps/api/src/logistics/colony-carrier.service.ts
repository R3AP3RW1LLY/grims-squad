import type { PrismaClient } from '@grims/db';
import { commodityCategories } from './commodity-categories.js';
import {
  AppError,
  CARRIER_STATION_TYPES,
  CALLSIGN_LENGTH,
  ErrorCode,
  Permission,
  formatCallsign,
  normaliseCallsign,
} from '@grims/shared';

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

/**
 * What a carrier's hold DECLARES it is carrying, per commodity — the two sources the market
 * mirror cannot see. `journal` rows are written by the owner's companion app from what it watched;
 * `manual` rows are typed by crew. See the merge rule on `effectiveTonnes`.
 */
export interface DeclaredCargo {
  readonly commodity: string;
  readonly tonnes: number;
  readonly source: 'journal' | 'manual';
  /** Who typed a manual figure. Null for journal rows — the app writes those, not a person. */
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
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
  /**
   * The game's own tonnage aboard the WHOLE carrier, from `CarrierStats`.
   *
   * ★ NOT THE SAME NUMBER AS `totalTonnes`, AND THE DIFFERENCE IS THE POINT ★
   *
   * `totalTonnes` is what we have SEEN of what this build wants. This is everything aboard,
   * whether we have witnessed it or not and whether the build wants it or not. The gap between
   * them is the honest measure of how much of the hold nobody has watched — which is what turns
   * "one commodity" from a manifest into a sample.
   *
   * Null until the owner has opened carrier management at least once with the app running.
   */
  readonly wholeHoldTonnes: number | null;
  /** When the game reported that figure. A stale total still beats none, and this says how stale. */
  readonly wholeHoldAt: Date | null;
  /** Journal-watched and hand-declared cargo, alongside the mirror's sell orders above. */
  readonly declared: readonly DeclaredCargo[];
}

/**
 * ★ THE MERGE RULE, IN ONE PLACE ★
 *
 * Three sources can speak about one commodity in one hold, and they are not equals:
 *
 *   manual   a crew member's own hand. The only source that can say "this figure is wrong",
 *            so it wins outright — including a manual ZERO, which retires a stale claim.
 *   journal  what the owner's app actually watched move. A floor: it misses whatever moved
 *            while the app was closed.
 *   mirror   the carrier's public sell orders. Also a floor: staged cargo is exactly the
 *            cargo that is not on sale.
 *
 * Two floors argue by size — the larger is the better floor — and the hand beats both. Exported
 * pure so the rule is spec-tested without a database, and so nobody re-derives it in a component.
 */
export function effectiveTonnes(sources: {
  readonly manual: number | null;
  readonly journal: number | null;
  readonly mirror: number | null;
}): number {
  if (sources.manual !== null) return Math.max(0, sources.manual);
  return Math.max(0, sources.journal ?? 0, sources.mirror ?? 0);
}

/**
 * What the attached carriers effectively cover, per commodity — the merge rule applied per
 * (carrier, commodity) and summed across carriers. Pure: it reads only what `forProject` already
 * fetched, so the detail read costs no extra query and a spec can hold the arithmetic still.
 */
export function carrierCover(
  carriers: ReadonlyArray<Pick<AttachedCarrier, 'holds' | 'declared'>>,
): Record<string, number> {
  const cover: Record<string, number> = {};

  for (const carrier of carriers) {
    const commodities = new Set<string>([
      ...carrier.holds.map((h) => h.commodity),
      ...carrier.declared.map((d) => d.commodity),
    ]);

    for (const commodity of commodities) {
      const manual = carrier.declared.find((d) => d.source === 'manual' && d.commodity === commodity);
      const journal = carrier.declared.find(
        (d) => d.source === 'journal' && d.commodity === commodity,
      );
      const mirror = carrier.holds.find((h) => h.commodity === commodity);

      const tonnes = effectiveTonnes({
        manual: manual?.tonnes ?? null,
        journal: journal?.tonnes ?? null,
        mirror: mirror?.tonnes ?? null,
      });
      if (tonnes > 0) cover[commodity] = (cover[commodity] ?? 0) + tonnes;
    }
  }

  return cover;
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
 *
 * ★ AND THE TYPE IS MATCHED AGAINST BOTH VOCABULARIES ★
 *
 * This used to read `data->>'type' = 'Drake-Class Carrier'` and nothing else, which is how the
 * owner's own carrier became unfindable — see `@grims/shared/carrier`. The list is bound as a
 * parameter so a future query cannot quietly hard-code one spelling again.
 */
function carrierStation(typesParam: number, extraWhere = ''): string {
  return `
  SELECT ext_key, name, data->>'marketId' AS market_id, data->>'system' AS system_name
    FROM knowledge_items
   WHERE source = 'galaxy' AND kind = 'station'
     AND data->>'type' = ANY($${typesParam}::text[])
     AND data->>'marketId' IS NOT NULL
     ${extraWhere}`;
}

/**
 * ★ ONE CARRIER IS ONE MARKET ID, AND IT HAS MORE THAN ONE CATALOGUE ROW ★
 *
 * The catalogue is keyed `"<systemAddress>/<name>"`, so a carrier gets a NEW row every time it
 * jumps and keeps the old one for ever. 1,881 carriers in the dev mirror hold two or more keys, and
 * the owner's W8K-W1Y is one of them: `1310721196/W8K-W1Y` in HIP 23585 and `5031789105826/W8K-W1Y`
 * in Hyades Sector XJ-Z c18, both market id 3713238272.
 *
 * The market mirror keeps rows under both keys, so joining naively counts the hold TWICE — 6,600 t
 * of CMM Composite at the new berth plus 14,520 t at the old one reads as 21,120 t of a commodity
 * the carrier holds 6,600 t of. That is the same class of over-count the note above is about,
 * arrived at from the other direction, and it survived because both figures look plausible.
 *
 * A carrier has ONE hold, and the truthful reading of it is the one seen most recently. So every
 * query here collapses a market id to a SINGLE key — the one whose market we last saw, falling back
 * to the key itself when no market has ever been reported under either.
 */
const FRESHEST_KEY = `
      LEFT JOIN LATERAL (
        SELECT max(e.market_seen_at) AS seen_at
          FROM market_entries e
         WHERE e.station_key = c.ext_key
      ) f ON true`;

export class ColonyCarrierService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Carriers matching what somebody typed, ranked by how useful they are to THIS build.
   *
   * ★ TWO DIFFERENT QUESTIONS, AND THEY NEED DIFFERENT QUERIES ★
   *
   * "Which carriers could help this build" and "where is W8K-W1Y" are not the same question, and
   * one query answering both is what broke the second one.
   *
   * The old query drove from `market_entries` and INNER JOINed the build's outstanding needs, then
   * filtered by name. That is right for the blank search — a carrier holding nothing on the list is
   * not an answer to "who can help" — and wrong for a callsign, because it silently required the
   * named carrier to ALREADY be selling something this specific build wants. A member typing their
   * own callsign got an empty result that read as "no such carrier".
   *
   * So a callsign search drives from the CATALOGUE and treats the hold as an outer join. A carrier
   * the galaxy data knows is an answer to "where is W8K-W1Y" whether or not anybody has reported
   * its market — the declared-hold feature exists precisely so the crew can type what is aboard.
   */
  async search(projectId: string, term: string): Promise<readonly CarrierMatch[]> {
    const typed = term.trim();
    return typed === ''
      ? this.#bestCarrying(projectId)
      : this.#byCallsign(projectId, typed);
  }

  /**
   * ★ AN EMPTY SEARCH IS THE MOST USEFUL SEARCH ★
   *
   * Found by using it: with a name required, a member wanting to know "which carriers could help
   * this build" had to guess a callsign out of forty-eight thousand. The question they actually
   * have is the one this can answer best — so an empty box lists the carriers holding the most of
   * what the build still wants.
   *
   * Kept exactly as it was, INNER joins and all, with one correction: the aggregate is per
   * catalogue KEY, and a carrier that has jumped has several. The rows are collapsed to one per
   * market id afterwards, so a moved carrier is listed once at its newest berth rather than twice
   * with its hold split across two systems.
   */
  async #bestCarrying(projectId: string): Promise<readonly CarrierMatch[]> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH carriers AS (${carrierStation(2)}),
            per_key AS (
              SELECT c.market_id, c.ext_key, m.station_name, m.system_name,
                     max(m.market_seen_at) AS seen_at,
                     count(*)::int AS matching,
                     sum(m.supply)::bigint AS matching_tonnes
                FROM market_entries m
                JOIN carriers c ON c.ext_key = m.station_key
                JOIN colony_needs n
                  ON n.commodity = m.commodity AND n.project_id = $1::uuid AND n.remaining > 0
               WHERE m.supply > 0
               GROUP BY c.market_id, c.ext_key, m.station_name, m.system_name
            ),
            newest AS (
              SELECT DISTINCT ON (market_id) *
                FROM per_key
               ORDER BY market_id, seen_at DESC NULLS LAST, ext_key
            )
       SELECT market_id, station_name AS name, system_name, seen_at, matching, matching_tonnes
         FROM newest
        ORDER BY matching_tonnes DESC, station_name
        LIMIT 20`,
      projectId,
      CARRIER_STATION_TYPES,
    );

    return rows.map((r) => this.#match(r));
  }

  /**
   * One carrier, by the identifier nobody can change.
   *
   * ★ THE SEARCH IS AGAINST THE CATALOGUE NAME, NOT THE MARKET MIRROR'S ★
   *
   * Every carrier's catalogue name IS its callsign: 48,360 of the 48,360 carrier rows in the dev
   * mirror match `XXX-XXX` exactly, with nothing before or after. So a complete callsign is an
   * EQUALITY match, which rides `knowledge_items_name_idx` instead of scanning, and a partial one
   * falls back to a contains match on the trigram index for somebody still typing.
   *
   * Both forms of what a person might type resolve to the same thing before they reach here:
   * `w8k-w1y`, `W8KW1Y` and ` W8K-W1Y ` are one carrier. See `normaliseCallsign`.
   */
  async #byCallsign(projectId: string, typed: string): Promise<readonly CarrierMatch[]> {
    const chars = normaliseCallsign(typed);

    /*
     * Nothing usable in what was typed at all — a term made entirely of punctuation. Refused as an
     * empty result rather than by running a match on '' that would return the whole galaxy.
     */
    if (chars === '') return [];

    const complete = chars.length === CALLSIGN_LENGTH;
    const where = complete
      ? // The dashed form is how it is stored; the bare form is the safety net for a source that
        // ever writes one without. Both are equalities, so both use the index.
        `AND name IN ($3, $4)`
      : `AND name ILIKE $3`;

    /*
     * ★ THE PARTIAL PATTERN CARRIES THE DASH BACK, AND BOTH REASONS MATTER ★
     *
     * The value arrives here with the dash stripped, and the stored name has one — so a raw
     * `%W8KW1%` matches nothing at all, however much of the right callsign was typed. Putting it
     * back via `formatCallsign` is what makes a half-typed callsign find anything.
     *
     * It is also 2,000x faster. `replace(name, '-', '')` would be equally correct and cannot use
     * the trigram index on `name`: measured on the dev mirror, 3,024ms against 1.4ms. A search that
     * takes three seconds per keystroke is a search nobody finishes typing.
     */
    const params: unknown[] = complete
      ? [projectId, CARRIER_STATION_TYPES, formatCallsign(chars), chars]
      : [projectId, CARRIER_STATION_TYPES, `%${formatCallsign(chars)}%`];

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH carriers AS (${carrierStation(2, where)}),
            keys AS (
              SELECT DISTINCT ON (c.market_id)
                     c.market_id, c.ext_key, c.name, c.system_name
                FROM carriers c${FRESHEST_KEY}
               ORDER BY c.market_id, f.seen_at DESC NULLS LAST, c.ext_key
            )
       SELECT k.market_id, k.name, k.system_name, h.seen_at,
              COALESCE(h.matching, 0)::int AS matching,
              COALESCE(h.matching_tonnes, 0)::bigint AS matching_tonnes
         FROM keys k
         /*
          * LEFT, and this is the whole fix. An INNER join here is what made a real carrier report
          * as "no such carrier" whenever its market was unreported or held nothing on this build's
          * list. A carrier we hold in the catalogue is an answer; what is aboard it is a separate
          * fact, and zero of it is a fact rather than an absence of one.
          */
         LEFT JOIN LATERAL (
           SELECT max(m.market_seen_at) AS seen_at,
                  count(*)::int AS matching,
                  sum(m.supply)::bigint AS matching_tonnes
             FROM market_entries m
             JOIN colony_needs n
               ON n.commodity = m.commodity AND n.project_id = $1::uuid AND n.remaining > 0
            WHERE m.station_key = k.ext_key AND m.supply > 0
         ) h ON true
        ORDER BY matching_tonnes DESC, k.name
        LIMIT 20`,
      ...params,
    );

    return rows.map((r) => this.#match(r));
  }

  #match(r: Record<string, unknown>): CarrierMatch {
    return {
      marketId: String(r['market_id']),
      name: String(r['name']),
      /*
       * A carrier the catalogue holds but the mirror has never placed has no system to print.
       * Said plainly rather than left blank — an empty cell reads as a rendering fault.
       */
      systemName: r['system_name'] === null ? 'somewhere we have not seen' : String(r['system_name']),
      seenAt: (r['seen_at'] as Date | null) ?? null,
      matchingCommodities: Number(r['matching']),
      matchingTonnes: Number(r['matching_tonnes']),
    };
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
      `WITH carriers AS (${carrierStation(2)})
       SELECT c.name FROM carriers c WHERE c.market_id = $1 LIMIT 1`,
      input.marketId,
      CARRIER_STATION_TYPES,
    );

    if (found === undefined) {
      /*
       * Refused rather than stored blind — nothing here invents a carrier out of typed text.
       *
       * ★ AND THE SENTENCE USED TO NAME THE WRONG CAUSE ★
       *
       * It read "Nobody has reported that carrier's market yet. Dock at it once and it will
       * appear." The check has never been about the market: a carrier the catalogue knows attaches
       * fine with no market at all, which is exactly what the declared-hold feature is for. The
       * only thing that reaches this line is a market id we hold no carrier for.
       *
       * Worse, the advice was actively wrong. Docking at a carrier stamped the journal's spelling
       * of the station type over the dump's, and every carrier query asked for the dump's — so
       * following the instruction was what made a carrier disappear. Fixed in
       * `@grims/shared/carrier`; the sentence now says the true condition and the true remedy.
       */
      throw new AppError(
        // The catalogue has no bare NOT_FOUND. `RESOURCE_NOT_VISIBLE` is the 404 for anything we
        // hold or do not hold, which is exactly what this is.
        ErrorCode.RESOURCE_NOT_VISIBLE,
        'We hold no fleet carrier under that identifier. Check the callsign on the contacts panel — ' +
          'a carrier reaches us once somebody has flown near it or docked at it.',
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

    /*
     * The whole-hold figures, read by market id — one row per carrier, not per berth and not per
     * project, so no collapsing is needed here the way the mirror's keys need it.
     */
    const wholeHoldRows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT market_id::text AS market_id, total_tonnes, observed_at
         FROM colony_carrier_hold
        WHERE market_id = ANY($1::bigint[])`,
      ids,
    );
    const wholeHold = new Map(
      wholeHoldRows.map((r) => [
        String(r['market_id']),
        { tonnes: Number(r['total_tonnes']), at: (r['observed_at'] as Date | null) ?? null },
      ]),
    );

    const [holds, declared] = await Promise.all([
      this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        /*
         * ★ ONE KEY PER CARRIER, OR THE HOLD IS COUNTED TWICE ★
         *
         * An attached carrier that has jumped since we first catalogued it has a row under each
         * berth, and the mirror keeps market lines under both. Joining every key summed them: the
         * owner's W8K-W1Y would have reported 21,120 t of CMM Composite — 6,600 t at its current
         * berth plus 14,520 t at last week's — for a hold of 6,600 t. Both figures are real
         * readings, which is exactly why the total looked plausible.
         *
         * `keys` collapses each market id to the berth we saw most recently, and the hold is read
         * from that key alone.
         */
        `WITH carriers AS (${carrierStation(3)}),
              keys AS (
                SELECT DISTINCT ON (c.market_id) c.market_id, c.ext_key
                  FROM carriers c${FRESHEST_KEY}
                 WHERE c.market_id = ANY($2::text[])
                 ORDER BY c.market_id, f.seen_at DESC NULLS LAST, c.ext_key
              )
         SELECT k.market_id, m.system_name, m.commodity, m.supply, m.market_seen_at
           FROM market_entries m
           JOIN keys k ON k.ext_key = m.station_key
           JOIN colony_needs n ON n.commodity = m.commodity
          WHERE m.supply > 0
            AND n.project_id = $1::uuid
            AND n.remaining > 0
          ORDER BY m.supply DESC`,
        projectId,
        ids,
        CARRIER_STATION_TYPES,
      ),
      /*
       * The declared rows — the journal's and the crew's word about what is aboard. NOT filtered
       * to the build's outstanding needs like the mirror holds above: a manual zero on a settled
       * commodity is still a statement worth showing on the carriers tab.
       */
      this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT g.market_id::text AS market_id, g.commodity, g.source, g.tonnes,
                g.updated_at, u.display_name AS updated_by
           FROM colony_carrier_cargo g
           LEFT JOIN users u ON u.id = g.updated_by_id
          WHERE g.market_id = ANY($1::bigint[])
          ORDER BY g.commodity, g.source`,
        ids,
      ),
    ]);

    const byCarrier = new Map<string, Array<Record<string, unknown>>>();
    for (const h of holds) {
      const key = String(h['market_id']);
      byCarrier.set(key, [...(byCarrier.get(key) ?? []), h]);
    }

    const declaredByCarrier = new Map<string, DeclaredCargo[]>();
    for (const d of declared) {
      const key = String(d['market_id']);
      declaredByCarrier.set(key, [
        ...(declaredByCarrier.get(key) ?? []),
        {
          commodity: String(d['commodity']),
          tonnes: Number(d['tonnes']),
          source: d['source'] === 'manual' ? 'manual' : 'journal',
          updatedBy: d['updated_by'] === null ? null : String(d['updated_by']),
          updatedAt: d['updated_at'] as Date,
        },
      ]);
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
        wholeHoldTonnes: wholeHold.get(marketId)?.tonnes ?? null,
        wholeHoldAt: wholeHold.get(marketId)?.at ?? null,
        declared: declaredByCarrier.get(marketId) ?? [],
      };
    });
  }

  /**
   * Sets or clears a MANUAL tonnage on an attached carrier — the crew's hand, for whatever the
   * journals missed.
   *
   * ★ CREW MEMBERS ONLY — THE ROSTER IS THE CHECK ★
   *
   * The same membership the roster records is what earns the pen: declaring what is aboard a
   * build's carrier is crew work, and a passer-by editing the squadron's cargo figures is exactly
   * what the check refuses. Deliberately NOT rank-gated — the member standing on the carrier's
   * deck counting the hold is rarely the one with COLONY_MANAGE.
   *
   * `tonnes: null` clears the override; ZERO is a real figure ("none of this is aboard") and
   * overrides journal and mirror alike — that is the entire point of a manual row.
   */
  async setManual(input: {
    projectId: string;
    marketId: string;
    commodity: string;
    tonnes: number | null;
    callerId: string;
  }): Promise<void> {
    if (!/^\d+$/.test(input.marketId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not a carrier we can identify.');
    }
    const commodity = input.commodity.trim();
    if (commodity === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the commodity.');
    }

    const [attached] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT 1 AS yes FROM colony_carriers
        WHERE project_id = $1::uuid AND market_id = $2::bigint`,
      input.projectId,
      input.marketId,
    );
    if (attached === undefined) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_VISIBLE,
        'That carrier is not on this build. Attach it first.',
      );
    }

    const [member] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT 1 AS yes FROM colony_members
        WHERE project_id = $1::uuid AND user_id = $2::uuid`,
      input.projectId,
      input.callerId,
    );
    if (member === undefined) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Join the build’s crew first — declaring a carrier’s cargo is crew work.',
      );
    }

    if (input.tonnes === null) {
      await this.db.$executeRawUnsafe(
        `DELETE FROM colony_carrier_cargo
          WHERE market_id = $1::bigint AND commodity = $2 AND source = 'manual'`,
        input.marketId,
        commodity,
      );
      return;
    }

    if (!Number.isFinite(input.tonnes) || input.tonnes < 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Tonnes must be zero or more.');
    }

    await this.db.$executeRawUnsafe(
      `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
       VALUES ($1::bigint, $2, 'manual', $3, $4::uuid, now())
       ON CONFLICT (market_id, commodity, source) DO UPDATE SET
         tonnes = EXCLUDED.tonnes, updated_by_id = EXCLUDED.updated_by_id, updated_at = now()`,
      input.marketId,
      commodity,
      Math.trunc(input.tonnes),
      input.callerId,
    );
  }

  /**
   * The companion app's reading of its member's OWN carrier hold.
   *
   * ★ A WITNESS STATEMENT, NOT AN INVENTORY — AND STORED ON THOSE TERMS ★
   *
   * The fold behind this starts empty on every app launch and reports only what it WATCHED move
   * (see apps/companion/src/carrier-hold.ts). So rows are UPSERTED per commodity rather than the
   * carrier's journal set being replaced wholesale: the app overwrites what it witnessed and stays
   * silent about what it did not, and a figure from last week keeps its own date rather than being
   * deleted by this week's ignorance. Manual rows are untouched entirely — a journal update landing
   * two minutes after a member corrected a figure by hand must not undo the correction.
   *
   * Stored only for a carrier attached to at least one build. Anything else is dropped without
   * error — the app pushes optimistically and does not hold the attachment list.
   */
  /** Cached because a hauling member pushes often and the answer changes about once a year. */
  static #commodityNames: { at: number; byLower: Map<string, string> } | null = null;

  /**
   * The display name we hold for a commodity, by its lower-cased form.
   *
   * ★ SQUADRON OWNER, 2026-08-09 ★
   *
   * "ensure that what is in a carriers hold is tracking on the whats needed and where to buy tabs
   * ... its supposed to appear in yellow so we know what we need and dont need"
   *
   * It was not, and this is why. The companion reads a journal cargo entry as `Type_Localised` when
   * the game supplies it and the raw `Type` symbol when it does not — and Frontier omits the
   * localised field for exactly the commodities whose symbol is a plain lower-case word. So a hold
   * carrying `Low Temp. Diamonds` (localised, present) stored correctly, while `steel`, `aluminium`,
   * `tritium`, `bertrandite`, `beryllium`, `gallite` and `indite` all stored as symbols.
   *
   * `colony_needs.commodity` holds the DISPLAY name, so none of those matched anything.
   * `carrierCover` is keyed on the commodity, the join found nothing, and the yellow segment never
   * appeared. Measured on production: 1,298 t of Steel and 1,186 t of Aluminium aboard a carrier
   * serving four builds, invisible on every one of them — and the shopping list was pricing a trip
   * to buy Steel the squadron already owned.
   *
   * ★ FIXED ON THE SERVER, NOT ONLY IN THE APP ★
   *
   * The app's fallback is also corrected, but that alone would not have been a fix: members run
   * whatever version they last installed, and an old build would go on writing symbols into a
   * column the rest of the system reads as display names. Normalising at the door fixes every
   * client at once, including ones nobody has updated.
   *
   * `commodity_snapshots` is the source rather than `market_entries`: 393 distinct names against
   * nineteen million rows, and it already holds the same display vocabulary the needs use. An
   * unrecognised name is stored UNCHANGED — a commodity we have never priced is still a real thing
   * somebody is carrying, and dropping it would be worse than failing to match it.
   */
  async #canonicalCommodityNames(): Promise<Map<string, string>> {
    const cached = ColonyCarrierService.#commodityNames;
    if (cached !== null && Date.now() - cached.at < 60 * 60_000) return cached.byLower;

    const rows = await this.db.$queryRawUnsafe<Array<{ commodity: string }>>(
      `SELECT DISTINCT commodity FROM commodity_snapshots`,
    );

    const byLower = new Map(rows.map((r) => [r.commodity.toLowerCase(), r.commodity]));
    // Only cached once it has something in it: an empty answer on a fresh database would otherwise
    // be held for an hour and quietly disable the normalisation.
    if (byLower.size > 0) ColonyCarrierService.#commodityNames = { at: Date.now(), byLower };
    return byLower;
  }

  async journalSnapshot(input: {
    marketId: string;
    commodities: ReadonlyArray<{ commodity?: unknown; tonnes?: unknown }>;
    /** The game's own total tonnage aboard, from `CarrierStats`. Null when never read. */
    totalTonnes?: number | null;
    /** The journal timestamp of that reading. */
    totalAt?: string | null;
  }): Promise<{ stored: boolean; attached: boolean; wanted: readonly string[] }> {
    if (!/^\d+$/.test(input.marketId)) return { stored: false, attached: false, wanted: [] };

    const rows = input.commodities
      .slice(0, 200)
      .map((c) => ({
        commodity: typeof c.commodity === 'string' ? c.commodity.trim() : '',
        tonnes: Number(c.tonnes),
      }))
      .filter((c) => c.commodity !== '' && Number.isFinite(c.tonnes) && c.tonnes >= 0)
      .map((c) => ({ commodity: c.commodity, tonnes: Math.trunc(c.tonnes) }));
    /*
     * ★ A TOTAL WITH NO WITNESSED ROWS IS STILL WORTH STORING ★
     *
     * This returned early on an empty commodity list, which is right for the list and wrong for
     * the total: a member who opens carrier management on a hold the app has never watched load
     * has the single most useful reading there is, and it was being dropped on the floor.
     */
    const total =
      typeof input.totalTonnes === 'number' &&
      Number.isFinite(input.totalTonnes) &&
      input.totalTonnes >= 0
        ? Math.trunc(input.totalTonnes)
        : null;
    // Nothing to record at all. Distinct from an unattached carrier, which now stores and prompts.
    if (rows.length === 0 && total === null) return { stored: false, attached: false, wanted: [] };

    const [attached] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT 1 AS yes FROM colony_carriers WHERE market_id = $1::bigint LIMIT 1`,
      input.marketId,
    );

    /*
     * ★ IT USED TO RETURN HERE, AND SAY NOTHING — SQUADRON OWNER, 2026-08-16 ★
     *
     * A carrier that is not attached to any build had its snapshot DISCARDED. No error, no message:
     * a member transferred eight hundred tonnes, the app pushed it, the hub dropped it, and nothing
     * anywhere explained why the board still showed nothing. That is a large part of "materials
     * being added to fleet carriers ... are not registering".
     *
     * The owner's answer was to keep it and offer to attach. So the snapshot is stored either way —
     * `colony_carrier_cargo` is keyed by market id and needs no attachment to hold a row — and the
     * caller is told which live builds actually want what is aboard, so it can ask rather than
     * guess. Attaching stays a deliberate act; nothing is put on a squadron board automatically.
     */

    const canonical = await this.#canonicalCommodityNames();

    for (const row of rows) {
      await this.db.$executeRawUnsafe(
        `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
         VALUES ($1::bigint, $2, 'journal', $3, NULL, now())
         ON CONFLICT (market_id, commodity, source) DO UPDATE SET
           tonnes = EXCLUDED.tonnes, updated_by_id = NULL, updated_at = now()`,
        input.marketId,
        canonical.get(row.commodity.toLowerCase()) ?? row.commodity,
        row.tonnes,
      );
    }

    /*
     * ★ THE WHOLE-HOLD FIGURE, BESIDE THE WITNESSED ROWS RATHER THAN AMONG THEM ★
     *
     * Squadron owner, 2026-08-05: the carrier hold needed to be "way more accurate". The rows above
     * are a WITNESS — what this app watched move — and in production that was one commodity,
     * presented as though it were the manifest. This is the game's own total, so a page can state
     * the gap instead of implying there is none.
     *
     * `observed_at` is the JOURNAL's timestamp, not now: a pass may be replaying a file written
     * hours ago, and stamping the present would dress an old reading as a fresh one.
     *
     * Guarded on the timestamp so an older reading cannot overwrite a newer one — passes can
     * arrive out of order after a restart, and a carrier's hold going backwards in time on screen
     * is worse than one figure late.
     */
    if (total !== null) {
      const observed = input.totalAt === null || input.totalAt === undefined
        ? new Date()
        : new Date(input.totalAt);
      const at = Number.isNaN(observed.getTime()) ? new Date() : observed;

      await this.db.$executeRawUnsafe(
        `INSERT INTO colony_carrier_hold (market_id, total_tonnes, observed_at, updated_at)
         VALUES ($1::bigint, $2::int, $3::timestamptz, now())
         ON CONFLICT (market_id) DO UPDATE SET
           total_tonnes = EXCLUDED.total_tonnes,
           observed_at  = EXCLUDED.observed_at,
           updated_at   = now()
         WHERE colony_carrier_hold.observed_at <= EXCLUDED.observed_at`,
        input.marketId,
        total,
        at.toISOString(),
      );
    }

    /*
     * Which live builds actually want what is aboard. This is what turns "your carrier is not
     * attached" into something a member can act on — "it is holding 800 t this build needs" — and it
     * is computed rather than assumed, so an unattached carrier full of Painite prompts nothing.
     */
    const wanted =
      attached !== undefined
        ? []
        : (
            await this.db.$queryRawUnsafe<Array<{ commodity: string }>>(
              `SELECT DISTINCT n.commodity
                 FROM colony_carrier_cargo g
                 JOIN colony_needs n ON lower(n.commodity) = lower(g.commodity) AND n.remaining > 0
                 JOIN colony_projects p ON p.id = n.project_id
                WHERE g.market_id = $1::bigint
                  AND p.completed_at IS NULL AND p.abandoned_at IS NULL`,
              input.marketId,
            )
          ).map((r) => r.commodity);

    return { stored: true, attached: attached !== undefined, wanted };
  }

  /**
   * Everything the builds this carrier serves still need, added up once.
   *
   * ★ SQUADRON OWNER, 2026-08-09 ★
   *
   * "so that we can click the this is my current build it can be active on many projects and it will
   * give me an aggregated total of all materials needed to get all the builds completed if i am
   * buying and storing on a fleet carrier"
   *
   * ★ THE PER-PROJECT VIEW IS WRONG ABOUT A SHARED CARRIER, AND ONLY THIS IS RIGHT ★
   *
   * This is not a convenience that saves opening three pages. It is the only place the arithmetic
   * works out.
   *
   * A carrier attached to three builds, holding 100 t of Steel, appears on all three project pages
   * as 100 t of cover — because `carrierCover` is asked "what do the carriers attached to THIS build
   * hold", and the honest answer for each of them is 100. Read one page at a time that is correct.
   * Added up it says 300 t are covered, and the cargo can only be delivered once.
   *
   * So the netting happens HERE, against the summed need, exactly once. `colony_carrier_cargo` was
   * keyed on the carrier rather than the project for this reason — the schema already says "a
   * carrier has one hold ... attaching it to two builds must not mean two sets of cargo" — and this
   * is the read that finally honours it.
   *
   * ★ ATTACHMENT IS THE ACTIVE SET ★
   *
   * No new flag. A carrier is serving a build exactly when it is attached to it, which is a thing
   * members already do, already understand, and already see on the project page. A second notion of
   * "active" beside it would be two switches that can disagree, and the first bug report would be
   * somebody's cargo missing from a total because the other switch was off.
   */
  async manifest(marketId: bigint): Promise<{
    readonly carrier: { readonly marketId: string; readonly name: string; readonly callsign: string | null } | null;
    readonly projects: ReadonlyArray<{ readonly id: string; readonly title: string; readonly systemName: string }>;
    readonly lines: ReadonlyArray<{
      readonly commodity: string;
      readonly category: string | null;
      /** Summed `remaining` across every build this carrier serves. */
      readonly needed: number;
      /** Effective tonnes aboard THIS carrier — counted once, however many builds want them. */
      readonly aboard: number;
      /** What still has to be bought. Never negative: surplus covers, it does not credit. */
      readonly toBuy: number;
    }>;
  }> {
    const [carrierRow] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT market_id::text AS market_id, name, callsign
         FROM colony_carriers WHERE market_id = $1::bigint LIMIT 1`,
      String(marketId),
    );

    if (carrierRow === undefined) {
      return { carrier: null, projects: [], lines: [] };
    }

    const projects = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT p.id::text AS id, p.title, p.system_name
         FROM colony_carriers c
         JOIN colony_projects p ON p.id = c.project_id
        WHERE c.market_id = $1::bigint
        ORDER BY p.title`,
      String(marketId),
    );

    /*
     * Summed in SQL rather than in Node. A carrier serving six builds of twenty-five commodities is
     * 150 rows to ship and fold by hand, and the database already knows how to add.
     */
    const needRows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT n.commodity, sum(n.remaining)::int AS needed
         FROM colony_needs n
         JOIN colony_carriers c ON c.project_id = n.project_id
        WHERE c.market_id = $1::bigint AND n.remaining > 0
        GROUP BY n.commodity
        ORDER BY sum(n.remaining) DESC`,
      String(marketId),
    );

    /*
     * The carrier's own cargo, through the SAME merge rule the project page uses — manual beats
     * journal beats the market mirror. Reusing `effectiveTonnes` rather than restating the
     * precedence, because a second copy would be wrong the first time the rule changed.
     */
    const cargoRows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT commodity, source, tonnes FROM colony_carrier_cargo WHERE market_id = $1::bigint`,
      String(marketId),
    );
    const mirrorRows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT commodity, tonnes FROM carrier_cargo WHERE market_id = $1::bigint`,
      String(marketId),
    );

    const pick = (commodity: string, source: string): number | null => {
      const row = cargoRows.find(
        (r) => String(r['commodity']) === commodity && String(r['source']) === source,
      );
      return row === undefined ? null : Number(row['tonnes']);
    };

    // The same category map the needs list and the shopping list use — one source, five surfaces.
    const categories = await commodityCategories(this.db);

    const lines = needRows.map((r) => {
      const commodity = String(r['commodity']);
      const needed = Number(r['needed']);
      const mirror = mirrorRows.find((m) => String(m['commodity']) === commodity);

      const aboard = effectiveTonnes({
        manual: pick(commodity, 'manual'),
        journal: pick(commodity, 'journal'),
        mirror: mirror === undefined ? null : Number(mirror['tonnes']),
      });

      /*
       * Capped at the need. A carrier holding more Steel than every build wants covers them, it does
       * not earn credit against something else — the same rule the per-project list applies, for the
       * same reason.
       */
      return {
        commodity,
        category: categories.get(commodity) ?? null,
        needed,
        aboard,
        toBuy: Math.max(0, needed - Math.min(needed, aboard)),
      };
    });

    return {
      carrier: {
        marketId: String(carrierRow['market_id']),
        name: String(carrierRow['name']),
        callsign: carrierRow['callsign'] === null ? null : String(carrierRow['callsign']),
      },
      projects: projects.map((p) => ({
        id: String(p['id']),
        title: String(p['title']),
        systemName: String(p['system_name']),
      })),
      lines,
    };
  }
}
