import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import {
  blocGaps,
  profileSystem,
  scoreRoles,
  type BlocGap,
  type EconomyRole,
  type RoleFit,
  type SurveyBody,
  type SystemProfile,
} from '@grims/shared';
// A subpath export, like every other checker in this package — not on the root index.
import { checkColonyPlan, type PlanReport } from '@grims/shared/colony-plan-check';
import {
  draftContext,
  fixedBrief,
  sitesForDraft,
  type DraftMode,
  type ExistingSite,
} from '@grims/shared/colony-draft-mode';
import { siteProgress } from '@grims/shared/colony-plan-progress';
import { AiClient } from '../ai/ai.client.js';
import { ColonyPlanService } from './colony-plan.service.js';

/**
 * What a system should be built as, and why.
 *
 * ★ SQUADRON OWNER, 2026-08-18 ★
 *
 * "add to the planning service in the companion app and website so we can do this exactly as you've
 * done ... this will help the squadron immensely!"
 *
 * ★ THE SPLIT THAT MAKES THIS SAFE ★
 *
 * Everything a recommendation RESTS ON is computed: the bodies come from the survey, the counts and
 * the role scores from `@grims/shared/system-role`, the missing links from the bloc's stored roles.
 * The model is handed those facts and writes the paragraph.
 *
 * The owner asked for the model to choose layouts too, and it does — but it chooses from a list of
 * structures this service supplies and against bodies this service enumerated, and the existing
 * plan checker validates the result before anybody hauls to it. A model cannot invent a water world
 * into a system that has none, because the water world is a boolean computed here.
 *
 * ★ AND THE FACTS SURVIVE AN UNREACHABLE MODEL ★
 *
 * The same rule the plan review follows. `ask` answers null when the assistant is not reachable —
 * on this platform that means a tunnel to a machine in the owner's house — and the profile, the
 * scores and the gaps are still true and still worth reading. They are returned either way.
 */

export interface SystemAdvice {
  readonly systemName: string;
  readonly profile: SystemProfile | null;
  readonly fits: readonly RoleFit[];
  /** The bloc this system belongs to, when an officer has put it in one. */
  readonly bloc: { readonly name: string; readonly gaps: readonly BlocGap[] } | null;
  /** What the squadron has already decided this system is. Null when nobody has said. */
  readonly decidedRole: EconomyRole | null;
  /** The model's paragraph. Empty when it could not be reached. */
  readonly advice: string;
  /** Exactly what the model was told, so a wrong answer can be traced to bad input. */
  readonly facts: string;
  /** Why there is no advice, when there is none. Never an error where a recommendation belongs. */
  readonly unavailable: string | null;
}

export interface DraftedLayout {
  /** What the model proposed, in build order. Empty when it proposed nothing usable. */
  readonly steps: ReadonlyArray<{ typeId: string; bodyId: number; bodyName: string; why: string }>;
  /**
   * The existing plan checker's verdict on that proposal.
   *
   * ★ RETURNED WHETHER IT PASSES OR NOT, AND SHOWN EITHER WAY ★
   *
   * The owner asked for the model to choose layouts. The risk in that is a plausible, ordered,
   * professional-looking list that is wrong — and a squadron hauls against a list. So the checker
   * runs on every draft and its errors travel with it: a draft with errors is offered as a draft
   * with errors, never quietly cleaned up and never silently discarded.
   */
  readonly report: PlanReport | null;
  /** Why there is no draft, when there is none. */
  readonly unavailable: string | null;
  /**
   * The question the member must answer before anything is drafted.
   *
   * ★ SQUADRON OWNER, 2026-08-22 ★
   *
   * "if a system already has a partial build ask the user if they want to override it, or if they
   * want to keep it and we work around it etc."
   *
   * Null when there is nothing to ask — an unplanned system, or one whose every row already exists
   * and where neither answer would change anything. Present WITH empty steps: the drafter has not
   * run yet, and running it first and asking afterwards would spend a model call on a layout the
   * member may be about to reject wholesale.
   */
  readonly ask: {
    readonly question: string;
    /** What stays put whatever they answer, written for a member. Null when nothing is built. */
    readonly fixedNote: string | null;
    readonly fixedCount: number;
    readonly intendedCount: number;
  } | null;
  /**
   * What the draft was told it could not move, said out loud on the result too.
   *
   * A member who gets their existing stations back in the layout needs to know that was deliberate.
   * Null when nothing was fixed.
   */
  readonly keptNote: string | null;
}

/**
 * A draft that could not run, with every field said explicitly.
 *
 * Spelled out rather than spread from a partial: `exactOptionalPropertyTypes` is on, and a helper
 * that quietly omitted `ask` would let a "no draft" answer arrive looking like a question nobody
 * asked.
 */
const blocked = (why: string): DraftedLayout => ({
  steps: [],
  report: null,
  unavailable: why,
  ask: null,
  keptNote: null,
});

/**
 * Puts the survey's own body names onto the sites the draft must work around.
 *
 * The plan stores a body ID; the model reasons about "A 1 f". Falling back to the id rather than
 * dropping the row: a fixed structure the model is not told about is one it will build on top of,
 * and a clumsy label is far cheaper than an unbuildable layout.
 */
function named(
  sites: readonly ExistingSite[],
  bodies: ReadonlyArray<{ bodyId: number; name: string }>,
): readonly ExistingSite[] {
  const byId = new Map(bodies.map((b) => [b.bodyId, b.name]));
  return sites.map((s) => ({
    ...s,
    bodyName: s.bodyId === null ? null : (byId.get(s.bodyId) ?? `body ${s.bodyId}`),
  }));
}

const DRAFT_PROMPT = `You lay out a colonisation plan for a player squadron in Elite Dangerous.

You are given the SYSTEM's real bodies and the STRUCTURES available. Obey these rules absolutely:

- Use only body ids from the BODIES list and only structure ids from the STRUCTURES list.
- A structure marked "surface" can ONLY go on a body marked landable. Never put one anywhere else.
- Step 1 must be a structure whose economy is "colony" — anything else locks the system's economy
  before the rest is built.
- Tier 1 structures bank one tier-2 point. Tier 2 structures spend one (three for a starport or
  asteroid base) and bank tier-3 points. Do not spend points that have not been banked.
- Aim the system at the ROLE given. Prefer structures whose economy matches it.

Answer with ONLY a JSON array, no prose, no code fence:
[{"typeId":"plutus","bodyId":1,"why":"one short sentence"}]`;

const SYSTEM_PROMPT = `You advise a player squadron in Elite Dangerous on what to build in a system they are colonising.

You are given FACTS computed from a real survey. Treat them as the only truth about the system:
never state a body, distance or resource that is not in the facts, and never contradict one.

Answer in three short paragraphs, plain prose, no headings and no lists:
1. What this system should be built as, and the single strongest reason from the facts.
2. The most important objection or constraint, stated plainly. If the facts carry a warning, lead with it.
3. How it fits the wider group, if a bloc is given — especially any missing link it could fill.

Be concrete and brief. A member reads this over a cockpit, not at a desk.`;

@Injectable()
export class SystemAdvisorService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(ColonyPlanService) private readonly plans: ColonyPlanService,
    @Inject(AiClient) private readonly ai: AiClient,
  ) {}

  async advise(systemName: string): Promise<SystemAdvice> {
    const name = systemName.trim();
    const empty: SystemAdvice = {
      systemName: name,
      profile: null,
      fits: [],
      bloc: null,
      decidedRole: null,
      advice: '',
      facts: '',
      unavailable: 'Name a system.',
    };
    if (name === '') return empty;

    /*
     * Through the plan service, not a second EDSM call. It already caches, already falls back to
     * the galaxy service for systems EDSM has never heard of, and already decides how stale a
     * survey may be — three answers that must not have a second copy.
     */
    const { system } = await this.plans.bodies(name);
    if (system === null || system.bodies.length === 0) {
      return {
        ...empty,
        unavailable:
          'Nobody has surveyed this system yet, so there is nothing to recommend from. ' +
          'Honk it and try again.',
      };
    }

    const bodies: SurveyBody[] = system.bodies.map((b) => ({
      name: b.name,
      // subType is what decides what a body IS; `kind` is only Star/Planet/Belt.
      kind: b.subType ?? b.kind,
      isLandable: b.isLandable,
      hasRings: b.hasRings,
      isTerraformCandidate: b.terraformable,
      distanceLs: b.distanceLs,
      gravity: b.gravity,
      temperatureK: b.temperature,
    }));

    const profile = profileSystem(bodies);
    const fits = scoreRoles(profile);
    const bloc = await this.#blocFor(name);

    const facts = renderFacts(name, profile, fits, bloc);

    const answer = await this.ai.ask(SYSTEM_PROMPT, [
      { role: 'user', content: `FACTS:\n${facts}\n\nAdvise on this system.` },
    ]);

    return {
      systemName: name,
      profile,
      fits,
      bloc: bloc === null ? null : { name: bloc.name, gaps: bloc.gaps },
      decidedRole: bloc?.decidedRole ?? null,
      advice: answer ?? '',
      facts,
      unavailable:
        answer === null
          ? 'The assistant is not reachable at the moment. What the survey shows is below.'
          : null,
    };
  }

  /**
   * A first layout for a system, proposed by the assistant and ruled on by the plan checker.
   *
   * ★ SQUADRON OWNER, 2026-08-18 ★
   *
   * Asked whether this should advise on a plan or draft one, the answer was both, with drafting
   * opt-in. This is the opt-in half: nothing calls it unless somebody presses the button.
   *
   * ★ THE MODEL PROPOSES; THE CHECKER RULES ★
   *
   * The danger in a drafted layout is not that it fails — it is that it succeeds at LOOKING right.
   * An ordered list of real structures on real bodies reads as authoritative whether or not it
   * obeys the tier economy, and a squadron hauls against lists.
   *
   * So every draft goes through `checkColonyPlan` — the same function the planner uses — and the
   * report travels back with it. A draft that fails is returned AS a draft that fails, with its
   * errors attached. It is never quietly repaired: a repaired draft hides that the model got it
   * wrong, and the next one would be trusted more than it had earned.
   */
  /**
   * Lays out a system, working around whatever is already there.
   *
   * ★ SQUADRON OWNER, 2026-08-22 ★
   *
   * "if a system already has a partial build ask the user if they want to override it, or if they
   * want to keep it and we work around it etc."
   *
   * ★ THE QUESTION IS ASKED BEFORE THE MODEL RUNS, NOT AFTER ★
   *
   * Drafting first and asking afterwards would spend a model call — and thirty seconds of somebody's
   * evening — on a layout they may be about to reject wholesale. So a plan with intentions in it
   * returns the question and no steps, and the caller comes back with an answer.
   *
   * ★ AND "OVERRIDE" NEVER MEANS "UNBUILD" ★
   *
   * See `colony-draft-mode.ts`. A site that became a project exists in the game; the drafter is told
   * about it in both modes, because a layout that moves a standing station is one the game refuses.
   */
  async draft(
    systemName: string,
    options: { planId?: string | undefined; callerId?: string | undefined; mode?: DraftMode | undefined } = {},
  ): Promise<DraftedLayout> {
    const name = systemName.trim();
    if (name === '') return blocked('Name a system.');

    const { system } = await this.plans.bodies(name);
    if (system === null || system.bodies.length === 0) {
      return blocked('Nobody has surveyed this system yet.');
    }

    /*
     * The existing plan, when the caller named one. Read through `byId`, which resolves THEIR
     * visibility — a draft must not disclose the contents of a plan they could not otherwise open.
     */
    const existing = await this.#existingSites(options.planId, options.callerId);
    const context = draftContext(existing);

    if (context.mustAsk && options.mode === undefined) {
      return {
        steps: [],
        report: null,
        unavailable: null,
        keptNote: null,
        ask: {
          question: context.question ?? '',
          fixedNote: context.fixedNote,
          fixedCount: context.fixed.length,
          intendedCount: context.intended.length,
        },
      };
    }

    /*
     * With no answer needed, `keep` is the safe default: it changes nothing about a system with
     * nothing planned, and on a fully-built one it is the only truthful answer anyway.
     */
    const kept = sitesForDraft(context, options.mode ?? 'keep');

    const bodies = system.bodies
      .filter((b) => !/star/i.test(b.subType ?? b.kind))
      .map((b) => ({
        bodyId: b.bodyId,
        name: b.name,
        kind: b.subType ?? b.kind,
        landable: b.isLandable,
        distanceLs: b.distanceLs,
      }));

    const types = await this.#buildTypes();
    if (types.length === 0) {
      return blocked('The build catalogue is empty.');
    }

    const profile = profileSystem(
      system.bodies.map((b) => ({
        name: b.name,
        kind: b.subType ?? b.kind,
        isLandable: b.isLandable,
        hasRings: b.hasRings,
        isTerraformCandidate: b.terraformable,
        distanceLs: b.distanceLs,
        gravity: b.gravity,
        temperatureK: b.temperature,
      })),
    );
    const role = scoreRoles(profile)[0]?.role ?? 'colony';

    const brief = [
      `ROLE: ${role}`,
      '',
      'BODIES:',
      ...bodies.map(
        (b) =>
          `  id ${b.bodyId}  ${b.name}  ${b.kind}  ${b.landable ? 'LANDABLE' : 'not landable'}` +
          `${b.distanceLs === null ? '' : `  ${Math.round(b.distanceLs)} Ls`}`,
      ),
      '',
      'STRUCTURES:',
      ...types.map(
        (t) =>
          `  ${t.id}  tier ${t.tier}  ${t.location}  ${t.tonnes} t  economy ${t.influence ?? 'none'}` +
          `  needs ${t.needsPoints} tier-${t.needsTier}  gives ${t.givesPoints} tier-${t.givesTier}`,
      ),
      /*
       * ★ WHAT IS ALREADY THERE, LAST AND NEAREST THE ANSWER ★
       *
       * A model handed a list of bodies with no note of what stands on them proposes a second
       * station on an occupied slot — which is the single most likely way this feature produces a
       * layout nobody can build. Empty string when nothing is fixed, and the join drops it, so an
       * unplanned system's brief is exactly what it always was.
       */
      ...(kept.length === 0 ? [] : ['', fixedBrief(named(kept, bodies))]),
    ].join('\n');

    const answer = await this.ai.ask(DRAFT_PROMPT, [{ role: 'user', content: brief }]);
    if (answer === null) {
      return blocked('The assistant is not reachable at the moment.');
    }

    const proposed = readDraft(answer);
    if (proposed.length === 0) {
      return blocked('The assistant did not return a layout that could be read.');
    }

    /*
     * ★ NARROWED TO REAL IDS BEFORE THE CHECKER SEES IT ★
     *
     * The checker reports an unknown structure as an error, which is correct — but an invented BODY
     * id would be reported against a body that does not exist, and a member reading that cannot
     * tell the model's invention from a real conflict in their own plan.
     *
     * Dropped rows are counted and said out loud below rather than silently removed: how often the
     * assistant invents things is exactly what somebody deciding whether to trust it needs to know.
     */
    const knownTypes = new Set(types.map((t) => t.id));
    const knownBodies = new Map(bodies.map((b) => [b.bodyId, b.name]));
    const steps = proposed.filter((p) => knownTypes.has(p.typeId) && knownBodies.has(p.bodyId));

    const report = checkColonyPlan(
      steps.map((p) => ({ typeId: p.typeId, bodyId: p.bodyId })),
      types,
      bodies.map((b) => ({
        bodyId: b.bodyId,
        name: b.name,
        landable: b.landable,
        // Carried through: the checker warns about a distant build, and dropping it here would
        // silence a warning the survey can actually answer.
        distanceLs: b.distanceLs,
        /*
         * Slot counts are unknown for a system nobody has opened in the colonisation UI. Null is the
         * honest answer and the checker already handles it — it enforces a hard limit where a count
         * is known and warns where it is not, rather than inventing one.
         */
        orbitalSlots: null,
        surfaceSlots: null,
      })),
    );

    const dropped = proposed.length - steps.length;
    return {
      steps: steps.map((p) => ({
        typeId: p.typeId,
        bodyId: p.bodyId,
        bodyName: knownBodies.get(p.bodyId) ?? String(p.bodyId),
        why: p.why,
      })),
      report,
      unavailable:
        dropped === 0
          ? null
          : `${dropped} proposed step${dropped === 1 ? '' : 's'} named a structure or a body that does not exist in this system, and ${dropped === 1 ? 'was' : 'were'} dropped.`,
      // The question has been answered by now, or there was never one to ask.
      ask: null,
      /*
       * Said on the RESULT as well as in the question. A member who gets their existing stations
       * back in the layout needs to know that was the platform being honest about what the game
       * will let them move, rather than the drafter having ignored them.
       */
      keptNote: context.fixedNote,
    };
  }

  /**
   * The existing plan's rows, with what each one actually is.
   *
   * ★ READ THROUGH THE CALLER'S OWN VISIBILITY ★
   *
   * `byId` resolves whether this member may open this plan, and answers null when they may not. A
   * draft must not become a side door onto the contents of a plan they could not otherwise see —
   * the same rule the current-build route follows for projects.
   *
   * Empty for a caller who named no plan, which is the ordinary case: drafting a fresh system.
   */
  async #existingSites(
    planId: string | undefined,
    callerId: string | undefined,
  ): Promise<readonly ExistingSite[]> {
    if (planId === undefined || planId === '' || callerId === undefined) return [];

    const plan = await this.plans.byId(planId, callerId);
    if (plan === null) return [];

    return plan.sites.map((s) => ({
      id: s.id,
      buildTypeId: s.buildTypeId,
      bodyId: s.bodyId,
      /*
       * Named from the SURVEY, not from here — see `draft`, which has the body list and fills this
       * in before the brief is written. A raw id would tell the model nothing it can reason about.
       */
      bodyName: null,
      position: s.position,
      isPrimary: s.isPrimary,
      /*
       * The same `siteProgress` the plan page draws its badges from, so "built" means exactly what
       * a member already sees it meaning. A second opinion here would have the drafter working
       * around a different set of structures than the page says are there.
       */
      state: siteProgress({
        id: s.id,
        totalTonnes: s.totalTonnes,
        project: s.project,
      }).state,
    }));
  }

  /** The build catalogue, in the shape the checker wants. */
  async #buildTypes(): Promise<
    Array<{
      id: string;
      tier: number;
      location: 'orbital' | 'surface';
      buildClass: string | null;
      tonnes: number;
      needsTier: number;
      needsPoints: number;
      givesTier: number;
      givesPoints: number;
      requires: string | null;
      satisfies: string[];
      influence: string | null;
      fixed: string | null;
    }>
  > {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, tier, location, build_class, total_tonnes, needs_tier, needs_points,
              gives_tier, gives_points, requires, satisfies, economy_influence, fixed_economy
         FROM colony_build_types ORDER BY tier, id`,
    );

    return rows.map((r) => ({
      id: String(r['id']),
      tier: Number(r['tier'] ?? 1),
      location: r['location'] === 'surface' ? ('surface' as const) : ('orbital' as const),
      buildClass: r['build_class'] == null ? null : String(r['build_class']),
      tonnes: Number(r['total_tonnes'] ?? 0),
      needsTier: Number(r['needs_tier'] ?? 0),
      needsPoints: Number(r['needs_points'] ?? 0),
      givesTier: Number(r['gives_tier'] ?? 0),
      givesPoints: Number(r['gives_points'] ?? 0),
      requires: r['requires'] == null ? null : String(r['requires']),
      satisfies: Array.isArray(r['satisfies']) ? (r['satisfies'] as string[]) : [],
      influence: r['economy_influence'] == null ? null : String(r['economy_influence']),
      fixed: r['fixed_economy'] == null ? null : String(r['fixed_economy']),
    }));
  }

  /**
   * The bloc this system sits in, the roles its neighbours have been given, and what that leaves
   * missing.
   *
   * ★ DECIDED ROLES, NOT COMPUTED ONES ★
   *
   * The gap analysis counts what officers have CHOSEN each system will be. A system with perfect
   * extraction bodies that the squadron decided to make military is military — and a bloc that
   * counted potential instead would report a supply chain it does not actually have, which is the
   * one thing this analysis exists to get right.
   */
  async #blocFor(systemName: string): Promise<
    { name: string; gaps: readonly BlocGap[]; decidedRole: EconomyRole | null } | null
  > {
    const rows = await this.db.$queryRawUnsafe<
      Array<{ bloc_name: string; system_name: string; role: string | null }>
    >(
      `SELECT b.name AS bloc_name, s.system_name, s.role
         FROM colony_bloc_systems mine
         JOIN colony_blocs b ON b.id = mine.bloc_id
         JOIN colony_bloc_systems s ON s.bloc_id = b.id
        WHERE lower(mine.system_name) = lower($1)
        ORDER BY s.system_name`,
      systemName,
    );

    if (rows.length === 0) return null;

    const known: EconomyRole[] = [
      'extraction',
      'refinery',
      'industrial',
      'hightech',
      'agriculture',
      'tourism',
      'military',
      'colony',
    ];
    const roleOf = (v: string | null): EconomyRole | null =>
      v !== null && (known as string[]).includes(v) ? (v as EconomyRole) : null;

    const present = rows
      .map((r) => roleOf(r.role))
      .filter((r): r is EconomyRole => r !== null);

    const mine = rows.find((r) => r.system_name.toLowerCase() === systemName.toLowerCase());

    return {
      name: rows[0]?.bloc_name ?? '',
      gaps: blocGaps(present),
      decidedRole: roleOf(mine?.role ?? null),
    };
  }
}

/**
 * Everything the model is allowed to know, as text.
 *
 * ★ RETURNED TO THE CALLER TOO, AND THAT IS THE POINT ★
 *
 * The plan review already does this and the reasoning holds here: a recommendation that reads well
 * and is wrong is worse than none, so the input is shown beside the output. A member who thinks the
 * advice is wrong can see exactly what it was told and settle it themselves.
 */
export function renderFacts(
  systemName: string,
  profile: SystemProfile,
  fits: readonly RoleFit[],
  bloc: { name: string; gaps: readonly BlocGap[]; decidedRole: EconomyRole | null } | null,
): string {
  const lines: string[] = [
    `System: ${systemName}`,
    `Bodies: ${profile.bodyCount} (${profile.landable} landable, ${profile.ringed} ringed)`,
    `Composition: ${profile.gasGiants} gas giants, ${profile.highMetal} high metal content, ` +
      `${profile.icy} icy, ${profile.waterWorlds} water worlds, ` +
      `${profile.terraformCandidates} terraforming candidates`,
    profile.nearestLs === null
      ? 'Distances: unknown'
      : `Distances: nearest body ${Math.round(profile.nearestLs).toLocaleString('en-GB')} Ls, ` +
        `farthest ${Math.round(profile.farthestLs ?? 0).toLocaleString('en-GB')} Ls`,
  ];

  if (profile.remote) {
    lines.push(
      'WARNING: every body in this system is over 100,000 Ls from the arrival point. The supercruise, ' +
        'not the resource, decides whether it is worth building.',
    );
  }
  if (profile.surfaceCapacity <= 1) {
    lines.push(
      `WARNING: only ${profile.surfaceCapacity} landable body. Settlements are surface builds, so ` +
        'almost everything here has to be built in orbit.',
    );
  }

  lines.push('', 'Role fit, best first:');
  for (const fit of fits.slice(0, 4)) {
    lines.push(`  ${fit.role} (${fit.score}) — ${fit.reasons.join('; ') || 'no strong signal'}`);
    for (const against of fit.against) lines.push(`      against: ${against}`);
  }

  if (bloc !== null) {
    lines.push('', `Bloc: ${bloc.name}`);
    lines.push(
      bloc.decidedRole === null
        ? '  This system has no role decided yet.'
        : `  This system is already designated ${bloc.decidedRole}.`,
    );
    if (bloc.gaps.length === 0) {
      lines.push('  The bloc has a complete supply chain.');
    } else {
      for (const gap of bloc.gaps) lines.push(`  MISSING ${gap.role}: ${gap.why}`);
    }
  }

  return lines.join('\n');
}
/**
 * A model's answer, turned into steps without trusting its punctuation.
 *
 * ★ "USUALLY VALID JSON" IS NOT A CONTRACT ★
 *
 * A model asked for JSON usually returns JSON. Eventually one returns a fenced block, or a
 * sentence of explanation first, or a trailing comma — and none of those should put a stack trace
 * on a planning page.
 *
 * Anything unreadable becomes an empty list, which the caller reports honestly ("the assistant did
 * not return a layout that could be read") rather than rendering as a plan with no builds in it. An
 * empty plan and a failed parse look identical on screen and mean completely different things.
 */
export function readDraft(answer: string): Array<{ typeId: string; bodyId: number; why: string }> {
  // The first array in the text, fence or no fence, prose or no prose.
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Array<{ typeId: string; bodyId: number; why: string }> = [];
  for (const row of parsed) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;

    const typeId = typeof r['typeId'] === 'string' ? r['typeId'].trim() : '';
    /*
     * A number, not a coerced string. `Number("body 4")` is NaN and `Number("")` is 0 — and a zero
     * body id would silently point at whatever body happens to be numbered zero rather than being
     * rejected as the nonsense it is.
     */
    const bodyId = typeof r['bodyId'] === 'number' ? r['bodyId'] : Number.NaN;
    if (typeId === '' || !Number.isFinite(bodyId)) continue;

    out.push({
      typeId,
      bodyId,
      why: typeof r['why'] === 'string' ? r['why'].slice(0, 200) : '',
    });
  }
  return out;
}
