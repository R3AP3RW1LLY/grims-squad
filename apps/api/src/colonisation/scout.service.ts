import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { systemsNear, claimableOnly } from '@grims/ed-clients';
import { canonicalSystemName } from './system-name.js';
import {
  CLAIM_RANGE_LY,
  bestPermitSource,
  explainCandidate,
  rankCandidates,
  type PermitSource,
  type ScoutCandidate,
} from '@grims/shared/colony-scout';

/**
 * Finding the next system to colonise.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool into our web and companion app that literally does what we just did here for
 * this planning and research and system selection?"
 *
 * ★ HALF OURS, AND THE HALF THAT MATTERS ★
 *
 * The PERMIT SOURCES come from us. `knowledge_items` holds 314,650 stations across the populated
 * galaxy, so "where do I buy the claim, and whose power does it extend" never leaves the building —
 * and that is the question with a permanent consequence.
 *
 * The CANDIDATES cannot. Our table holds the populated galaxy plus wherever members have flown, and
 * measured against the squadron's own permit office it has seven systems within twenty light years,
 * every one inhabited. Spansh has seventeen claimable inside sixteen. Recording every empty system
 * in the bubble would be tens of millions of rows to answer a question asked a few times a year, so
 * the uninhabited half is fetched on demand — the same bargain `colony_bodies` already makes for
 * body detail.
 *
 * That gap was found by an integration test asserting there would be candidates near a known hub,
 * and there were none. It would otherwise have shipped as an empty page with no explanation.
 *
 * ★ WHAT IS NOT HERE ★
 *
 * Body and ring detail. We hold none for uninhabited systems — they arrive as name and coordinates
 * only, `bodyCount` zero. That is fetched per candidate on demand and cached into `colony_bodies`,
 * which is a separate step and deliberately not on this path: a member picking an anchor should not
 * wait for thirty body surveys to find out which systems are even claimable.
 */

export interface ScoutRequest {
  /** The system to search around — usually a permit office or an existing colony. */
  readonly anchor: string;
  /** How far a claim reaches from the station selling it. */
  readonly rangeLy?: number | undefined;
  /**
   * Extend this power.
   *
   * ★ THE OWNER'S OWN CONSTRAINT ★
   *
   * "we want the federation that runs my system in other systems too" — so a matching permit source
   * beats a nearer one, because the errand is once and the allegiance is permanent.
   */
  readonly prefer?: string | undefined;
}

export interface ScoutResult {
  readonly anchor: { readonly system: string; readonly allegiance: string | null; readonly controllingFaction: string | null } | null;
  readonly candidates: ReadonlyArray<
    ScoutCandidate & {
      readonly score: number;
      /** Every term that made the score, heaviest first. See `explainCandidate`. */
      readonly reasons: ReadonlyArray<{ readonly points: number; readonly text: string }>;
    }
  >;
  /** How many claimable systems were in range before ranking. Says how wide the net was. */
  readonly consideredSystems: number;
  readonly permitSources: number;
  readonly unknownAnchor: string | null;
}

interface SystemRow {
  name: string;
  x: number;
  y: number;
  z: number;
  population: string | null;
  allegiance: string | null;
  faction: string | null;
  body_count: number | null;
  stations: number;
}

@Injectable()
export class ScoutService {
  constructor(
    private readonly db: PrismaClient,
    /**
     * The galaxy reader, injected so tests can run without the network.
     *
     * Defaulted rather than required: every existing caller constructs this with a database alone.
     */
    private readonly galaxy: typeof systemsNear = systemsNear,
  ) {}

  async scout(req: ScoutRequest): Promise<ScoutResult> {
    const range = req.rangeLy ?? CLAIM_RANGE_LY;
    const anchor = await this.#anchor(req.anchor);

    if (anchor === null) {
      return {
        anchor: null,
        candidates: [],
        consideredSystems: 0,
        permitSources: 0,
        unknownAnchor: req.anchor,
      };
    }

    /*
     * Everything within reach of the anchor, in ONE query, with each system's station count folded
     * in. The radius is generous — a candidate found at the edge still needs a permit source within
     * `range` OF ITSELF, and that source may sit further from the anchor than the candidate does.
     */
    const reach = range * 2 + 5;

    /*
     * Candidates from the galaxy service. Fetched BEFORE our own query so a network failure costs
     * nothing but an empty candidate list — the permit sources below are still worth returning.
     */
    const nearby = await this.galaxy(anchor.name, range, {});
    const claimableRows = claimableOnly(nearby);

    const rows = await this.db.$queryRawUnsafe<SystemRow[]>(
      `SELECT k.name,
              cube_ll_coord(k.coords, 1) AS x,
              cube_ll_coord(k.coords, 2) AS y,
              cube_ll_coord(k.coords, 3) AS z,
              k.data->>'population' AS population,
              k.data->>'allegiance' AS allegiance,
              k.data->>'controllingFaction' AS faction,
              (k.data->>'bodyCount')::int AS body_count,
              COALESCE(st.n, 0)::int AS stations
         FROM knowledge_items k
         LEFT JOIN (
           SELECT split_part(ext_key, '/', 1) AS sys, count(*)::int AS n
             FROM knowledge_items
            WHERE kind = 'station'
            GROUP BY split_part(ext_key, '/', 1)
         ) st ON st.sys = k.ext_key
        WHERE k.kind = 'system'
          AND k.coords IS NOT NULL
          AND sqrt(power(cube_ll_coord(k.coords,1) - $1, 2)
                 + power(cube_ll_coord(k.coords,2) - $2, 2)
                 + power(cube_ll_coord(k.coords,3) - $3, 2)) <= $4`,
      anchor.x,
      anchor.y,
      anchor.z,
      reach,
    );

    /*
     * A system with no `population` key at all is uninhabited — that is how the galaxy ingest
     * records it, and it is the claimable set. A population of zero written explicitly would mean
     * the same thing, so both are accepted.
     */
    const sources: PermitSource[] = rows
      .filter((r) => r.population !== null && Number(r.population) > 0 && r.stations > 0)
      .map((r) => ({
        system: r.name,
        x: Number(r.x),
        y: Number(r.y),
        z: Number(r.z),
        allegiance: r.allegiance,
        controllingFaction: r.faction,
        stationCount: r.stations,
        // We do not hold station TYPE here, so this stays honest rather than guessed: any station
        // count above zero means somewhere to dock, and the UI says which system rather than which pad.
        hasOrbital: r.stations > 0,
      }));

    /*
     * Permit sources come from BOTH: ours has the station counts and allegiances, and the galaxy
     * service covers populated systems our ingest has never seen. Ours wins on a name collision
     * because it carries the station detail.
     */
    const known = new Set(sources.map((s) => s.system.toLowerCase()));
    for (const s of nearby) {
      if (s.population <= 0 || s.stationCount <= 0) continue;
      if (known.has(s.name.toLowerCase())) continue;
      sources.push({
        system: s.name,
        x: s.x,
        y: s.y,
        z: s.z,
        allegiance: s.allegiance,
        controllingFaction: null,
        stationCount: s.stationCount,
        hasOrbital: s.stationCount > 0,
      });
    }

    const candidates: ScoutCandidate[] = claimableRows.map((r) => {
      const at = { x: r.x, y: r.y, z: r.z };
      const permitOpts: { prefer?: string; rangeLy?: number } = { rangeLy: range };
      if (req.prefer !== undefined) permitOpts.prefer = req.prefer;
      const permit = bestPermitSource(at, sources, permitOpts);

      return {
        system: r.name,
        ...at,
        // Zero for an unsurveyed system, which is most of them. The survey step fills these in.
        bodyCount: r.bodyCount,
        landableCount: 0,
        nearestLandableLs: null,
        hotspots: {},
        // Not surveyed yet: bodies are fetched on demand, so nothing is assumed about them.
        surveyed: false,
        pristine: false,
        permit,
        permitLy: permit === null ? null : Math.hypot(at.x - permit.x, at.y - permit.y, at.z - permit.z),
      };
    });

    return {
      anchor: {
        system: anchor.name,
        allegiance: anchor.allegiance,
        controllingFaction: anchor.faction,
      },
      /*
       * ★ THE SCORE EXPLAINS ITSELF — SQUADRON OWNER, 2026-08-10 ★
       *
       * "why this system", from the colonisation suggestions. Listed there as an AI feature and
       * deliberately not built as one: the scorer is made of named terms that already know why they
       * fired, and a model could only paraphrase them — ten seconds and a tunnel to a machine in
       * somebody's house to say what the arithmetic knows for free and cannot get wrong.
       *
       * Computed in the same pass as the score, so the two cannot disagree.
       */
      candidates: rankCandidates(candidates).map((c) => {
        const { score, reasons } = explainCandidate(c);
        return { ...c, score, reasons };
      }),
      consideredSystems: claimableRows.length,
      permitSources: sources.length,
      unknownAnchor: null,
    };
  }

  /**
   * The system somebody named.
   *
   * ★ OUR TABLE FIRST, THEN THE GALAXY SERVICE ★
   *
   * Reported by the owner: searching from their OWN system returned "we hold no coordinates". Our
   * galaxy table covers populated systems plus wherever members have flown, and a system that was
   * uninhabited until somebody claimed it is in neither set — so the one anchor a colonist most
   * wants to search from is precisely the one we were least likely to hold.
   *
   * Falling back to the galaxy service fixes it and validates the name at the same time: a request
   * for systems within a light year of a name Spansh does not recognise comes back empty.
   */
  async #anchor(
    name: string,
  ): Promise<{ name: string; x: number; y: number; z: number; allegiance: string | null; faction: string | null } | null> {
    const typed = name.trim();
    if (typed === '') return null;

    const [row] = await this.db.$queryRawUnsafe<
      Array<{ name: string; x: number; y: number; z: number; allegiance: string | null; faction: string | null }>
    >(
      `SELECT name,
              cube_ll_coord(coords, 1) AS x,
              cube_ll_coord(coords, 2) AS y,
              cube_ll_coord(coords, 3) AS z,
              data->>'allegiance' AS allegiance,
              data->>'controllingFaction' AS faction
         FROM knowledge_items
        WHERE kind = 'system' AND coords IS NOT NULL AND lower(name) = lower($1)
        LIMIT 1`,
      typed,
    );

    if (row !== undefined) {
      return {
        name: row.name,
        x: Number(row.x),
        y: Number(row.y),
        z: Number(row.z),
        allegiance: row.allegiance,
        faction: row.faction,
      };
    }

    /*
     * Not ours. Ask the galaxy service for anything within a light year of it — the system itself
     * comes back at distance zero, which gives us the coordinates and confirms the name exists.
     */
    /*
     * As typed first, then with the case repaired. The galaxy service is case-SENSITIVE and answers
     * a mis-cased name with an empty result rather than an error — which is why the owner typing
     * their own system in caps looked exactly like a system that does not exist.
     */
    for (const attempt of [typed, canonicalSystemName(typed)]) {
      if (attempt === '') continue;
      const found = await this.#fromGalaxy(attempt);
      if (found !== null) return found;
      // No point asking twice when the repair changed nothing.
      if (canonicalSystemName(typed) === typed) break;
    }
    return null;
  }

  /** One galaxy lookup: anything within a light year, which includes the system itself. */
  async #fromGalaxy(
    name: string,
  ): Promise<{ name: string; x: number; y: number; z: number; allegiance: string | null; faction: string | null } | null> {
    try {
      const near = await this.galaxy(name, 1, {});
      const self =
        near.find((s) => s.name.trim().toLowerCase() === name.toLowerCase()) ??
        near.find((s) => s.distance === 0);
      if (self === undefined) return null;

      return {
        name: self.name,
        x: self.x,
        y: self.y,
        z: self.z,
        allegiance: self.allegiance,
        // The galaxy service does not carry the controlling faction; null rather than invented.
        faction: null,
      };
    } catch {
      return null;
    }
  }
}
