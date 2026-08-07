import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { sortByBodyName } from '@grims/shared/body-order';
import { ColonyPlanService } from '../logistics/colony-plan.service.js';

/**
 * Surveying a candidate system.
 *
 * ★ THE STEP BETWEEN "CLAIMABLE" AND "WORTH CLAIMING" ★
 *
 * The scout returns systems in claim range with a permit source, which is all our galaxy data can
 * answer. It cannot say whether there is anything worth building on: body counts, landability,
 * arrival distances and ring hotspots are none of them in our tables for an uninhabited system.
 *
 * This is that second look, taken one system at a time because a member choosing between a dozen
 * candidates should not wait for a dozen full surveys before seeing the list at all.
 *
 * ★ IT REUSES THE PLANNER'S CACHE, DELIBERATELY ★
 *
 * `ColonyPlanService.bodies` already fetches a system, writes it to `colony_bodies`, and — the part
 * that matters — leaves hand-entered slot counts alone when refreshing. Somebody read those off
 * their own screen in game; a second fetch path that overwrote them with nulls would destroy the
 * one thing on this platform that cannot be obtained any other way.
 */

export interface RingSignal {
  readonly material: string;
  readonly count: number;
}

export interface SurveyedBody {
  readonly bodyId: number;
  readonly name: string;
  readonly subType: string | null;
  readonly landable: boolean;
  readonly distanceLs: number | null;
  readonly gravity: number | null;
  readonly hasRings: boolean;
  readonly terraformable: boolean;
  /** Slot counts, when a member has entered them. Null everywhere else. */
  readonly orbitalSlots: number | null;
  readonly surfaceSlots: number | null;
}

export interface SystemSurvey {
  readonly system: string;
  /** EDSM reports this as null for a system nobody has fully scanned. */
  readonly bodyCount: number | null;
  readonly bodies: readonly SurveyedBody[];
  readonly landableCount: number;
  /** Arrival distance of the nearest landable body — the number that decides how the colony flies. */
  readonly nearestLandableLs: number | null;
  readonly ringedCount: number;
  /** Hotspots per material, summed across every ring we hold a signal for. */
  readonly hotspots: Readonly<Record<string, number>>;
  readonly fetchedAt: Date | null;
  /** True when a member has entered slot counts for at least one body. */
  readonly hasSlotData: boolean;
}

@Injectable()
export class SurveyService {
  constructor(
    private readonly db: PrismaClient,
    private readonly plans: ColonyPlanService,
  ) {}

  /**
   * Survey one system: fetch its bodies if we do not hold them, then summarise.
   *
   * Returns null when the system cannot be found at all, which the page reports as such rather than
   * as an empty system — those are very different answers to a member deciding where to live.
   */
  async survey(systemName: string): Promise<SystemSurvey | null> {
    const { system, fetchedAt } = await this.plans.bodies(systemName);
    if (system === null) return null;

    /*
     * Slot counts come from OUR table, not from the fetch — they are the one field EDSM cannot
     * supply, and the whole reason the cache is worth reading back rather than using the fetch
     * result directly.
     */
    const slotRows = await this.db.$queryRawUnsafe<
      Array<{ body_id: number; orbital_slots: number | null; surface_slots: number | null }>
    >(
      `SELECT body_id, orbital_slots, surface_slots
         FROM colony_bodies
        WHERE system_id64 = $1::bigint`,
      String(system.id64),
    );
    const slots = new Map(slotRows.map((r) => [Number(r.body_id), r]));

    const bodies: SurveyedBody[] = system.bodies.map((b) => {
      const s = slots.get(b.bodyId);
      return {
        bodyId: b.bodyId,
        name: b.name,
        subType: b.subType,
        landable: b.isLandable === true,
        distanceLs: b.distanceLs,
        gravity: b.gravity,
        hasRings: b.hasRings === true,
        terraformable: b.terraformable === true,
        orbitalSlots: s?.orbital_slots === null || s?.orbital_slots === undefined ? null : Number(s.orbital_slots),
        surfaceSlots: s?.surface_slots === null || s?.surface_slots === undefined ? null : Number(s.surface_slots),
      };
    });

    /*
     * The nearest landable body's arrival distance — the single number that decides how the colony
     * is flown. Computed over a narrowed list so the null case is "nothing landable is placed",
     * which is different from "nothing is landable" and must not collapse into zero.
     */
    const reachable = bodies
      .filter((b) => b.landable && b.distanceLs !== null)
      .map((b) => b.distanceLs as number);
    const nearest = reachable.length === 0 ? null : Math.min(...reachable);

    /*
     * Ring signals are not in `colony_bodies` — that table records whether a body HAS rings, not
     * what is in them. Left empty rather than guessed; the page says the rings are unsurveyed, which
     * is true, instead of implying the system is barren.
     */
    return {
      system: system.name,
      bodyCount: system.bodyCount,
      // Sorted the way a system map reads, so the page does not have to.
      bodies: sortByBodyName(bodies, (b) => b.name),
      landableCount: bodies.filter((b) => b.landable).length,
      nearestLandableLs: nearest,
      ringedCount: bodies.filter((b) => b.hasRings).length,
      hotspots: {},
      fetchedAt,
      hasSlotData: bodies.some((b) => b.orbitalSlots !== null || b.surfaceSlots !== null),
    };
  }
}
