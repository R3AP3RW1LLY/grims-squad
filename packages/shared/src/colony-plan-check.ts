/**
 * Does this colonisation plan actually work?
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool into our web and companion app that literally does what we just did here for
 * this planning and research and system selection?"
 *
 * ★ EVERY RULE HERE IS A MISTAKE THAT WAS ACTUALLY MADE ★
 *
 * Planning one 380,000-tonne colony by hand produced, in a single afternoon: an opening build that
 * would have permanently locked the system's economy to the wrong thing; a structure whose
 * prerequisite nothing in the plan supplied; surface settlements placed on gas giants; and a
 * cluster plan needing thirteen surface slots where eleven bodies exist.
 *
 * Every one of those is invisible in the game until the tonnage is already hauled, and every one is
 * decidable from data we already hold. That is the whole argument for this file.
 *
 * ★ PURE, AND SHARED ★
 *
 * No database, no fetch. The website, the companion and the assistant all check plans with this, so
 * they cannot disagree about whether a plan is buildable.
 */

/** One entry from `colony_build_types`, in the shape this checker needs. */
export interface BuildType {
  readonly id: string;
  readonly tier: number;
  readonly location: 'orbital' | 'surface';
  readonly buildClass: string | null;
  readonly tonnes: number;
  readonly needsTier: number;
  readonly needsPoints: number;
  readonly givesTier: number;
  readonly givesPoints: number;
  /** A token that must already be provided by an EARLIER build. */
  readonly requires: string | null;
  /** Tokens this build provides to later ones. */
  readonly satisfies: readonly string[];
  readonly influence: string | null;
  /**
   * An economy this build LOCKS the system into, permanently.
   *
   * Non-null on six of the nine possible openers, and no later build can undo it.
   */
  readonly fixed: string | null;
}

/** A body in the target system, as the planner knows it. */
export interface PlanBodyRef {
  readonly bodyId: number;
  readonly name: string;
  readonly landable: boolean;
  readonly distanceLs: number | null;
}

/** One planned build: a catalogue type placed on a body. Order in the array IS the build order. */
export interface PlannedBuild {
  readonly typeId: string;
  readonly bodyId: number;
}

export type PlanIssueCode =
  | 'unknown-type'
  | 'unknown-body'
  | 'economy-locked'
  | 'not-landable'
  | 'missing-prerequisite'
  | 'not-enough-points'
  | 'slot-taken'
  | 'very-far';

export interface PlanIssue {
  readonly code: PlanIssueCode;
  /** Which step, 1-based, so a UI can point at the row. */
  readonly step: number;
  readonly message: string;
}

export interface PlanStep {
  readonly step: number;
  readonly typeId: string;
  readonly bodyId: number;
  readonly bodyName: string;
  readonly tonnes: number;
  readonly tier2After: number;
  readonly tier3After: number;
}

export interface PlanReport {
  readonly ok: boolean;
  readonly errors: readonly PlanIssue[];
  /** Things worth saying that do not make the plan illegal. */
  readonly warnings: readonly PlanIssue[];
  readonly steps: readonly PlanStep[];
  readonly totalTonnes: number;
  readonly type9Loads: number;
  /** How many structures vote for each economy. */
  readonly influence: Readonly<Record<string, number>>;
  /** The economy with the most votes, or null on a tie or an empty plan. */
  readonly leadingEconomy: string | null;
}

/** A Type-9's hold. The unit squadrons actually plan hauling in. */
const TYPE9_TONNES = 702;

/**
 * Far enough that it changes how the colony is flown.
 *
 * Not an error — the owner's own primary port sits at 151,334 Ls and that was deliberate. But a
 * planner that says nothing lets somebody commit to a fifteen-minute supercruise, each way, every
 * visit, without ever being told.
 */
const VERY_FAR_LS = 50_000;

export function checkColonyPlan(
  plan: readonly PlannedBuild[],
  types: readonly BuildType[],
  bodies: readonly PlanBodyRef[],
): PlanReport {
  const byType = new Map(types.map((t) => [t.id, t]));
  const byBody = new Map(bodies.map((b) => [b.bodyId, b]));

  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const steps: PlanStep[] = [];
  const influence: Record<string, number> = {};

  const provided = new Set<string>();
  /* One surface build per body. Orbital structures are not capped here — see the note in the
   * report's caller about slot counts being null in our data — but a second SURFACE settlement on
   * one moon is unambiguously wrong. */
  const surfaceTaken = new Set<number>();

  let tier2 = 0;
  let tier3 = 0;
  let totalTonnes = 0;

  for (const [i, entry] of plan.entries()) {
    const step = i + 1;
    const type = byType.get(entry.typeId);

    if (type === undefined) {
      errors.push({ code: 'unknown-type', step, message: `Step ${step}: no build type "${entry.typeId}" in the catalogue.` });
      continue;
    }

    const body = byBody.get(entry.bodyId);
    if (body === undefined) {
      errors.push({ code: 'unknown-body', step, message: `Step ${step}: no body ${entry.bodyId} in this system.` });
      continue;
    }

    /*
     * ★ THE LOCK, CHECKED FIRST AND ONLY ON THE OPENER ★
     *
     * `fixed` on the FIRST build sets the system's economy permanently. Later it is just another
     * influence vote and perfectly fine.
     */
    if (step === 1 && type.fixed !== null) {
      errors.push({
        code: 'economy-locked',
        step,
        message: `Step 1: "${type.id}" permanently locks this system's economy to ${type.fixed}, and nothing built later can undo it. Open with a build whose economy is free — plutus, vesta or hestia.`,
      });
    }

    if (type.location === 'surface' && !body.landable) {
      errors.push({
        code: 'not-landable',
        step,
        message: `Step ${step}: "${type.id}" is a surface build and ${body.name} cannot be landed on.`,
      });
    }

    if (type.location === 'surface') {
      if (surfaceTaken.has(body.bodyId)) {
        errors.push({
          code: 'slot-taken',
          step,
          message: `Step ${step}: ${body.name} already carries a surface build. One body, one surface structure.`,
        });
      }
      surfaceTaken.add(body.bodyId);
    }

    if (type.requires !== null && !provided.has(type.requires)) {
      errors.push({
        code: 'missing-prerequisite',
        step,
        message: `Step ${step}: "${type.id}" requires ${type.requires}, which nothing before it provides. In game this build is simply greyed out.`,
      });
    }

    // Points are spent before they are earned — a build cannot fund itself.
    if (type.needsPoints > 0) {
      const have = type.needsTier >= 3 ? tier3 : tier2;
      if (have < type.needsPoints) {
        errors.push({
          code: 'not-enough-points',
          step,
          message: `Step ${step}: "${type.id}" needs ${type.needsPoints} Tier-${type.needsTier} point${type.needsPoints === 1 ? '' : 's'} and only ${have} ${have === 1 ? 'is' : 'are'} banked.`,
        });
      }
      if (type.needsTier >= 3) tier3 -= type.needsPoints;
      else tier2 -= type.needsPoints;
    }

    if (type.givesPoints > 0) {
      if (type.givesTier >= 3) tier3 += type.givesPoints;
      else tier2 += type.givesPoints;
    }

    if (body.distanceLs !== null && body.distanceLs > VERY_FAR_LS) {
      warnings.push({
        code: 'very-far',
        step,
        message: `Step ${step}: ${body.name} is ${Math.round(body.distanceLs).toLocaleString()} Ls out — roughly a quarter-hour of supercruise each way, every visit.`,
      });
    }

    for (const token of type.satisfies) provided.add(token);

    if (type.influence !== null) {
      influence[type.influence] = (influence[type.influence] ?? 0) + 1;
    }

    totalTonnes += type.tonnes;
    steps.push({
      step,
      typeId: type.id,
      bodyId: body.bodyId,
      bodyName: body.name,
      tonnes: type.tonnes,
      tier2After: tier2,
      tier3After: tier3,
    });
  }

  /*
   * The leading economy, and null on a tie. A planner that names a winner where two are level would
   * be stating something the game has not decided.
   */
  const ranked = Object.entries(influence)
    .filter(([name]) => name !== 'none')
    .sort((a, b) => b[1] - a[1]);
  const leadingEconomy =
    ranked.length === 0 || (ranked.length > 1 && ranked[0]?.[1] === ranked[1]?.[1])
      ? null
      : (ranked[0]?.[0] ?? null);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    steps,
    totalTonnes,
    type9Loads: Math.ceil(totalTonnes / TYPE9_TONNES),
    influence,
    leadingEconomy,
  };
}
