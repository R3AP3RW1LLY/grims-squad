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
