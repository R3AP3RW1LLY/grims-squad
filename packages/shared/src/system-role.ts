/**
 * What a system is GOOD for, from what is actually orbiting in it.
 *
 * ★ SQUADRON OWNER, 2026-08-18 ★
 *
 * "add to the planning service in the companion app and website so we can do this exactly as you've
 * done ... this will help the squadron immensely!"
 *
 * ★ WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT ★
 *
 * It is the arithmetic: how many landable bodies, how far out they sit, whether there is a water
 * world, what the rings and the gravity allow. Every number a recommendation rests on is computed
 * here, from a survey, and can be checked by anybody with the same survey.
 *
 * It is NOT the prose, and it is not the model. The advisor writes the paragraph; this decides the
 * facts the paragraph is allowed to be about. That split is the whole safety property: a model
 * cannot invent a water world into a system that has none, because the water world is a boolean
 * computed here and handed to it.
 *
 * ★ THE FINDING THAT SHAPED IT ★
 *
 * Writing the four Col 285 build books by hand, the two things that changed the plans were both
 * arithmetic nobody had done:
 *
 *   GL-W c2-13 looks like the best extraction system in the bloc — four ringed gas giants and
 *   seventeen landable moons. Every one of them orbits the SECOND star, 193,561 Ls out. The ore is
 *   real; so is a 194,000 Ls supercruise on every leg, and that is the larger number.
 *
 *   IG-W c2-14 has a water world and exactly ONE landable body. Tourism and agriculture settlements
 *   are surface builds, so the obvious plan would have sent people to build on a world they cannot
 *   land on.
 *
 * Neither is a judgement call. Both are counts. So both are here, where they cannot be forgotten.
 */

/** One body as the survey reports it. Only the fields a recommendation can rest on. */
export interface SurveyBody {
  readonly name: string;
  /** EDSM's `subType`, else `type`. "Water world", "Class I gas giant", "Icy body"… */
  readonly kind: string;
  readonly isLandable: boolean;
  readonly hasRings: boolean;
  readonly isTerraformCandidate: boolean;
  readonly distanceLs: number | null;
  readonly gravity: number | null;
  readonly temperatureK: number | null;
}

/**
 * The arithmetic of a system, before anybody has an opinion about it.
 *
 * Every field is a count or a measurement. Nothing here is a recommendation — `scoreRoles` turns
 * these into one, and keeping the two apart is what makes a recommendation auditable.
 */
export interface SystemProfile {
  readonly bodyCount: number;
  readonly landable: number;
  readonly ringed: number;
  readonly gasGiants: number;
  readonly highMetal: number;
  readonly icy: number;
  readonly waterWorlds: number;
  readonly terraformCandidates: number;
  /** How far the NEAREST body sits. What a hauler pays on the best run in the system. */
  readonly nearestLs: number | null;
  /** And the farthest. The two together are the shape of every trip anybody will make here. */
  readonly farthestLs: number | null;
  /**
   * True when every body is absurdly far out — see GL-W c2-13, where the primary has nothing
   * orbiting it and the entire system sits 194,000 Ls away around a second star.
   *
   * This is the fact most likely to be missed by looking at a body list, and the one most likely to
   * decide whether a system is worth building at all.
   */
  readonly remote: boolean;
  /** Bodies a SURFACE build could go on. The hard ceiling on settlements, and often small. */
  readonly surfaceCapacity: number;
}

/**
 * Past this, a system is "remote" and every recommendation has to say so.
 *
 * 100,000 Ls. A normal system puts its bodies within a few thousand; a secondary star can be
 * hundreds of thousands out. There is no honest middle: at this range the supercruise, not the ore,
 * is what decides whether anybody builds here.
 */
export const REMOTE_LS = 100_000;

/**
 * Surface builds need somewhere to land, and "landable" is the whole test.
 *
 * A water world is not landable. Nor is a gas giant. A system can be rich and still have almost no
 * room for settlements — which is exactly the case that produced a hand-written plan telling people
 * to build on a body they could not reach.
 */
export function profileSystem(bodies: readonly SurveyBody[]): SystemProfile {
  const rock = bodies.filter((b) => !/star/i.test(b.kind));
  const distances = rock
    .map((b) => b.distanceLs)
    .filter((d): d is number => d !== null && Number.isFinite(d));

  const nearestLs = distances.length === 0 ? null : Math.min(...distances);
  const farthestLs = distances.length === 0 ? null : Math.max(...distances);

  const has = (re: RegExp): number => rock.filter((b) => re.test(b.kind)).length;

  return {
    bodyCount: rock.length,
    landable: rock.filter((b) => b.isLandable).length,
    ringed: rock.filter((b) => b.hasRings).length,
    gasGiants: has(/gas giant/i),
    highMetal: has(/high metal content/i),
    icy: has(/icy body/i),
    waterWorlds: has(/water world/i),
    terraformCandidates: rock.filter((b) => b.isTerraformCandidate).length,
    nearestLs,
    farthestLs,
    /*
     * The NEAREST body, not the farthest. A system with one close body and a distant tail is
     * workable — you build at the near end. A system whose CLOSEST body is 193,000 Ls out has no
     * near end, and that is the case worth naming.
     */
    remote: nearestLs !== null && nearestLs >= REMOTE_LS,
    surfaceCapacity: rock.filter((b) => b.isLandable).length,
  };
}

/** The economies a system can be steered toward, as the build catalogue spells them. */
export type EconomyRole =
  | 'extraction'
  | 'refinery'
  | 'industrial'
  | 'hightech'
  | 'agriculture'
  | 'tourism'
  | 'military'
  | 'colony';

export interface RoleFit {
  readonly role: EconomyRole;
  /** Higher is better. Comparable only within one system's results. */
  readonly score: number;
  /** Why, in the platform's own words, from the counts above. Never model-written. */
  readonly reasons: readonly string[];
  /** What would make this a bad idea, said even when the score is high. */
  readonly against: readonly string[];
}

/**
 * Which economies this system could take, best first.
 *
 * ★ EVERY POINT IS TRACEABLE TO A COUNT ★
 *
 * The reasons are generated from the same numbers as the score, so a member reading "extraction,
 * because four ringed bodies and seventeen landable moons" can go and check both. A recommendation
 * somebody cannot check is one they have to take on trust, and trust is what this platform keeps
 * finding it should not have asked for.
 *
 * ★ AND THE OBJECTIONS ARE SCORED TOO ★
 *
 * `against` is not decoration. A remote system scores its extraction on the rings it really has and
 * then says, in the same breath, that every run is a 194,000 Ls supercruise. Both are true and a
 * recommendation that omitted the second would be the more dangerous half.
 */
export function scoreRoles(profile: SystemProfile): readonly RoleFit[] {
  const fits: RoleFit[] = [];
  const add = (role: EconomyRole, score: number, reasons: string[], against: string[] = []): void => {
    if (score > 0) fits.push({ role, score, reasons, against });
  };

  const remoteObjection = profile.remote
    ? [
        `Every body sits at least ${Math.round((profile.nearestLs ?? 0) / 1000)},000 Ls from the arrival point — ` +
          'the supercruise, not the resource, decides whether this is worth building.',
      ]
    : [];

  /*
   * ── extraction: rings first, ground second ──────────────────────────────
   *
   * ★ RINGS ARE THE SCARCE SIGNAL, AND THE FIRST WEIGHTING MISSED IT ★
   *
   * Scored at 3 per ring, a system with FOUR ringed gas giants and seventeen icy moons came out as
   * industrial — because seventeen landable bodies outscored the rings that make it special. Run
   * against the real survey of GL-W c2-13 it disagreed with the analysis a person had done of the
   * same system, and the person was right: icy moons are everywhere, ringed gas giants are not.
   *
   * Rings are what a system has that its neighbours do not. Landable ground is capped because past
   * a dozen sites it stops being the deciding factor — you run out of tier points long before you
   * run out of moons.
   */
  const extraction = profile.ringed * 6 + Math.min(profile.landable, 12);
  add(
    'extraction',
    extraction,
    [
      profile.ringed > 0 ? `${profile.ringed} ringed ${plural(profile.ringed, 'body', 'bodies')} to mine` : '',
      profile.landable > 0 ? `${profile.landable} landable ${plural(profile.landable, 'body', 'bodies')} for extraction settlements` : '',
    ].filter(Boolean),
    remoteObjection,
  );

  /*
   * ── industrial: ground, and LOTS of it ──────────────────────────────────
   *
   * ★ THE FLOOR IS THE WHOLE POINT, AND THE FIRST VERSION HAD NONE ★
   *
   * Industrial settlements are surface builds, so an industrial economy is a function of how many
   * bodies can be landed on. The first version scored `landable * 2` and gave a system with TWO
   * landable bodies a score of 8 — enough to tie with the military recommendation and beat it on
   * ordering, so an eleven-body system with nowhere to build was offered as a forge.
   *
   * Below the floor the score collapses rather than tapering: two sites is not a small industrial
   * system, it is not an industrial system. Tapering would have kept producing the same wrong
   * answer more quietly.
   */
  const INDUSTRIAL_FLOOR = 6;
  const industrial =
    profile.landable < INDUSTRIAL_FLOOR ? 0 : profile.landable * 2 + (profile.highMetal > 0 ? 4 : 0);
  add(
    'industrial',
    industrial,
    [
      `${profile.landable} landable ${plural(profile.landable, 'body', 'bodies')} — industrial settlements are surface builds`,
      profile.highMetal > 0 ? `${profile.highMetal} high metal content ${plural(profile.highMetal, 'world', 'worlds')}` : '',
    ].filter(Boolean),
    remoteObjection,
  );

  // ── refinery: a follower economy, wants ground near the ore ───────────────
  add(
    'refinery',
    profile.landable > 3 ? profile.landable : 0,
    [`${profile.landable} landable bodies, enough ground for a refinery hub and its settlements`],
    remoteObjection,
  );

  // ── agriculture: water and terraforming, then orbit ───────────────────────
  const agriculture = profile.waterWorlds * 8 + profile.terraformCandidates * 4;
  add(
    'agriculture',
    agriculture,
    [
      profile.waterWorlds > 0 ? `${profile.waterWorlds} water ${plural(profile.waterWorlds, 'world', 'worlds')}` : '',
      profile.terraformCandidates > 0
        ? `${profile.terraformCandidates} terraforming ${plural(profile.terraformCandidates, 'candidate', 'candidates')}`
        : '',
    ].filter(Boolean),
    [
      ...remoteObjection,
      ...(agriculture > 0 && profile.surfaceCapacity <= 1
        ? [
            `Only ${profile.surfaceCapacity} landable ${plural(profile.surfaceCapacity, 'body', 'bodies')} — agricultural ` +
              'settlements are surface builds, so most of this has to be done orbitally with Space Farms.',
          ]
        : []),
    ],
  );

  // ── tourism: something worth looking at ───────────────────────────────────
  const tourism = profile.waterWorlds * 6 + profile.terraformCandidates * 2 + (profile.ringed > 2 ? 2 : 0);
  add(
    'tourism',
    tourism,
    [
      profile.waterWorlds > 0 ? 'A water world is a destination — the rest of a bloc rarely has one' : '',
      profile.ringed > 2 ? `${profile.ringed} ringed bodies to look at` : '',
    ].filter(Boolean),
    [
      ...remoteObjection,
      ...(tourism > 0 && profile.surfaceCapacity <= 1
        ? [`Only ${profile.surfaceCapacity} landable body, so tourism here is orbital — a Space Bar rather than a resort.`]
        : []),
    ],
  );

  // ── high tech: no body requirement, so it is sited by strategy ────────────
  add('hightech', profile.landable > 0 ? 3 : 1, [
    'High tech is largely orbital, so almost any system can host it — site it where the industry that feeds it already is',
  ]);

  /*
   * ★ MILITARY IS WHAT A THIN SYSTEM IS FOR ★
   *
   * Scored INVERSELY to everything else. A system with no rings, few bodies and nothing to dig has
   * no better use, and security is the one job that costs the bloc little and returns something to
   * every other system in it. IG-W c2-15 — eleven bodies, two landable, no rings — is exactly this.
   */
  const thin = profile.ringed === 0 && profile.bodyCount <= 12 && profile.waterWorlds === 0;
  add(
    'military',
    thin ? 8 : 2,
    thin
      ? [
          `${profile.bodyCount} bodies, no rings and nothing worth extracting — there is no better use for this system`,
          'Military builds are the cheapest in the catalogue, so a thin system can still be useful',
        ]
      : ['Any system can host a garrison; it costs what it costs'],
  );

  // ── colony: the neutral opener, always available ──────────────────────────
  add('colony', 1, ['Every system can open with a civilian or commercial outpost, which locks nothing in']);

  return fits.sort((a, b) => b.score - a.score);
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * What a group of systems cannot make for itself.
 *
 * ★ THE PART THAT MADE THE BUILD BOOKS WORTH READING ★
 *
 * Any one system can be scored alone. What could not be seen that way was that c2-12 refined ore
 * and c2-16 built high tech and NOTHING between them turned refined metal into components — so
 * both ends were trading outside the squadron for the middle step.
 *
 * That is a property of the set, not of any member of it, and it is invisible until somebody looks
 * at all of them at once.
 */
export const SUPPLY_CHAIN: readonly EconomyRole[] = [
  'extraction',
  'refinery',
  'industrial',
  'hightech',
];

export interface BlocGap {
  readonly role: EconomyRole;
  readonly why: string;
}

/**
 * The links this bloc is missing, in the order they hurt.
 *
 * Agriculture and military are included because a bloc without them is buying food and security
 * from somebody else — which works, and means every populated system in it pays a neighbour for
 * the two things it cannot do without.
 */
export function blocGaps(rolesPresent: readonly EconomyRole[]): readonly BlocGap[] {
  const have = new Set(rolesPresent);
  const gaps: BlocGap[] = [];

  for (let i = 0; i < SUPPLY_CHAIN.length; i += 1) {
    const role = SUPPLY_CHAIN[i] as EconomyRole;
    if (have.has(role)) continue;

    const upstream = SUPPLY_CHAIN[i - 1];
    const downstream = SUPPLY_CHAIN[i + 1];

    /*
     * A missing link with BOTH neighbours present is the expensive kind: the bloc is producing the
     * input and consuming the output and paying somebody outside it to do the step in between.
     */
    if (upstream !== undefined && downstream !== undefined && have.has(upstream) && have.has(downstream)) {
      gaps.push({
        role,
        why:
          `The bloc has ${upstream} and ${downstream} but nothing doing ${role} between them — ` +
          `so ${upstream} sells outside the squadron and ${downstream} buys back in.`,
      });
    } else {
      gaps.push({ role, why: `No system in the bloc is steered toward ${role}.` });
    }
  }

  if (!have.has('agriculture')) {
    gaps.push({ role: 'agriculture', why: 'Nothing here grows food, so every populated system imports it.' });
  }
  if (!have.has('military')) {
    gaps.push({ role: 'military', why: 'No security presence, so the freight between these systems is somebody else’s hunting ground.' });
  }

  return gaps;
}
