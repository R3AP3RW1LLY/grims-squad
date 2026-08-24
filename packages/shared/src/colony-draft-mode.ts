import type { SiteState } from './colony-plan-progress.js';

/**
 * Drafting a system that somebody has already started building.
 *
 * ★ SQUADRON OWNER, 2026-08-22 ★
 *
 * "if a system already has a partial build ask the user if they want to override it, or if they want
 * to keep it and we work around it etc."
 *
 * ★ "OVERRIDE" CANNOT MEAN "UNBUILD", AND SAYING SO IS THE POINT ★
 *
 * The obvious reading is two modes: throw the plan away and start again, or keep it and design
 * around it. But a plan is not all one thing. Some of its rows are an INTENTION — somebody typed a
 * structure into a slot and nobody has flown anywhere. Others are a CONSTRUCTION SITE that exists in
 * the game, because a commander docked at it and their journal said so.
 *
 * A drafter that "overrides" the second kind would produce a layout that cannot be built: the game
 * will not move a station that is standing, or un-place one that is half-hauled. Offering it as a
 * choice would be offering something we cannot deliver, and the member would only find out after
 * flying somewhere.
 *
 * So the split is by what is REAL, not by what the member wants:
 *
 *   - a site that became a project is FIXED, in both modes, always
 *   - a site that is still only an intention is the member's to keep or discard
 *
 * And when a plan is entirely one or the other, there is nothing to ask — asking anyway trains
 * people to click through questions, which is how the one that mattered gets clicked through too.
 */

/** One row of an existing plan, as this decision needs to see it. */
export interface ExistingSite {
  readonly id: string;
  /** The catalogue row, or null for a slot nobody has filled in yet. */
  readonly buildTypeId: string | null;
  readonly bodyId: number | null;
  readonly bodyName: string | null;
  /** Where it sits in the build order. Tier points are earned and spent in this sequence. */
  readonly position: number;
  readonly isPrimary: boolean;
  /**
   * From `colony-plan-progress`. Anything past 'planned' means a project exists — which means
   * somebody docked at a real construction site and the game has placed it.
   */
  readonly state: SiteState;
}

export type DraftMode = 'keep' | 'override';

export interface DraftContext {
  /**
   * Sites that exist in the game. Immovable in BOTH modes — see the header.
   *
   * In build order, because their tier points are earned and spent in sequence and the drafter has
   * to continue from where that sequence actually leaves the system.
   */
  readonly fixed: readonly ExistingSite[];
  /** Sites that are only an intention. The member's to keep or discard. */
  readonly intended: readonly ExistingSite[];
  /**
   * Whether the member has a real choice to make.
   *
   * False when there is nothing to discard — either the plan is empty, or every row of it already
   * exists and neither answer would change anything.
   */
  readonly mustAsk: boolean;
  /** The question, written for a member. Null when there is nothing to ask. */
  readonly question: string | null;
  /**
   * What the drafter will do regardless of the answer, said out loud.
   *
   * Null when nothing is fixed. Present whenever something is, INCLUDING when `mustAsk` is false —
   * a member who asked to redraft a fully-built system and got their existing stations back needs
   * to know that was the system being honest rather than the drafter failing.
   */
  readonly fixedNote: string | null;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Works out what can move and what cannot, and what to ask.
 *
 * A site is fixed the moment it has become a project. That is earlier than "finished" on purpose:
 * posting a project means a commander was docked at a construction site that the game had already
 * placed, so the slot is spent whether or not a single tonne has been delivered.
 */
export function draftContext(sites: readonly ExistingSite[]): DraftContext {
  const ordered = [...sites].sort((a, b) => a.position - b.position);
  const fixed = ordered.filter((s) => s.state !== 'planned');
  const intended = ordered.filter((s) => s.state === 'planned');

  const fixedNote =
    fixed.length === 0
      ? null
      : `${fixed.length} ${plural(fixed.length, 'structure', 'structures')} ${plural(
          fixed.length,
          'is',
          'are',
        )} already placed in the game and cannot be moved. ${plural(
          fixed.length,
          'It stays',
          'They stay',
        )} where ${plural(fixed.length, 'it is', 'they are')}, and ${plural(
          fixed.length,
          'its',
          'their',
        )} tier points are counted before anything new is added.`;

  /*
   * Nothing to discard means nothing to decide. A plan that is entirely built has one possible
   * outcome, and dressing it up as a choice teaches people to click through questions.
   */
  if (intended.length === 0) {
    return { fixed, intended, mustAsk: false, question: null, fixedNote };
  }

  return {
    fixed,
    intended,
    mustAsk: true,
    question:
      fixed.length === 0
        ? `This system already has a plan with ${intended.length} ${plural(
            intended.length,
            'structure',
            'structures',
          )} in it. Replace them with a fresh layout, or keep them and design around them?`
        : `This system is partly built. ${intended.length} planned ${plural(
            intended.length,
            'structure has',
            'structures have',
          )} not been started — replace ${plural(
            intended.length,
            'it',
            'them',
          )} with a fresh layout, or keep ${plural(intended.length, 'it', 'them')} too?`,
    fixedNote,
  };
}

/**
 * The sites the drafter must treat as already placed.
 *
 * ★ FIXED SITES SURVIVE BOTH ANSWERS ★
 *
 * `override` discards intentions, never construction. A caller that wanted "everything goes" would
 * be asking for a layout the game will refuse to build.
 *
 * Returned in build order so the tier arithmetic continues from the real position rather than
 * restarting at zero — which is the difference between a draft that can be built and one that runs
 * out of points at step four.
 */
export function sitesForDraft(
  context: DraftContext,
  mode: DraftMode,
): readonly ExistingSite[] {
  const kept = mode === 'keep' ? [...context.fixed, ...context.intended] : [...context.fixed];
  return kept.sort((a, b) => a.position - b.position);
}

/**
 * What the drafter is told about the ground it cannot move.
 *
 * Written as a brief for the assistant rather than for a member: it names the structure, where it
 * stands and that it is immovable, because a model given a list of bodies with no note of what is
 * on them will happily propose a second station on an occupied slot.
 */
export function fixedBrief(sites: readonly ExistingSite[]): string {
  if (sites.length === 0) return '';

  return [
    'ALREADY BUILT — these are immovable. Do not propose anything on these slots, and count their',
    'tier points as already earned:',
    ...sites.map((s) => {
      const where = s.bodyName ?? (s.bodyId === null ? 'somewhere unrecorded' : `body ${s.bodyId}`);
      const what = s.buildTypeId ?? 'an unchosen structure';
      return `  ${what}  at ${where}${s.isPrimary ? '  (PRIMARY — the system’s first station)' : ''}`;
    }),
  ].join('\n');
}
