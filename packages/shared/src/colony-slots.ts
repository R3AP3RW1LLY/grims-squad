/**
 * What a body has room for, and whether a plan has overcommitted it.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "when I click on survey it from a scouting provided system ... it is not showing me ORB or SURF
 * slots, these should be populated, and transferred over to the planner"
 *
 * ★ THE DATA IS NOT ON SPANSH — CHECKED, NOT ASSUMED ★
 *
 * Spansh's system dump was read against the live API on 2026-08-23: 43 distinct body keys across 27
 * bodies, including isLandable, subType, gravity, rings, materials and terraformingState. Nothing
 * about colonisation slots. They are read off the in-game ARCHITECT VIEW by a member who is there,
 * which is why `setSlots` records who recorded them.
 *
 * So the platform cannot fetch these. What it can do is stop pretending it might: show what is
 * recorded, say plainly when nothing is, and let the member who is looking at the panel write it
 * down in one box.
 *
 * ★ WARN, NEVER REFUSE — THE OWNER'S CALL, AND THE RIGHT ONE ★
 *
 * A slot count here is a member's observation, possibly stale, possibly missing, possibly typed
 * wrong. The non-landable rule can refuse a build because the galaxy dump is authoritative about
 * landability. Nothing here is authoritative, so blocking would mean a wrong number stopping
 * somebody planning a build the game would allow.
 *
 * Same treatment as the tier-point shortfall the picker already shows: say what does not add up,
 * and let the member decide.
 */

/** What a plan has put on one body, against what that body is recorded as having. */
export interface BodySlotUse {
  /** Recorded orbital slots, or null when nobody has looked. */
  readonly orbitalSlots: number | null;
  readonly surfaceSlots: number | null;
  /** Builds this plan places on the body. */
  readonly orbitalPlanned: number;
  readonly surfacePlanned: number;
}

export interface SlotWarning {
  readonly where: 'orbital' | 'surface';
  readonly planned: number;
  readonly slots: number;
  readonly message: string;
}

/**
 * Where a plan asks a body for more room than it is recorded as having.
 *
 * Empty when the counts fit, and empty when nothing is recorded — an unrecorded body is unknown,
 * not zero. Treating null as zero would put a warning on every body nobody has surveyed, which is
 * most of them, and a list that always warns is one nobody reads.
 */
export function slotWarnings(use: BodySlotUse): readonly SlotWarning[] {
  const out: SlotWarning[] = [];

  const check = (
    where: 'orbital' | 'surface',
    slots: number | null,
    planned: number,
  ): void => {
    // Null is "nobody has looked", not "no room". Zero IS a real answer and is checked.
    if (slots === null) return;
    if (planned <= slots) return;

    out.push({
      where,
      planned,
      slots,
      message:
        `${planned} ${where} build${planned === 1 ? '' : 's'} planned here, but only ` +
        `${slots} ${where} slot${slots === 1 ? '' : 's'} recorded. Check the architect view — the ` +
        `count may be out of date, or this may not fit.`,
    });
  };

  check('orbital', use.orbitalSlots, use.orbitalPlanned);
  check('surface', use.surfaceSlots, use.surfacePlanned);

  return out;
}

/**
 * What to tell a member about a body whose slots nobody has written down.
 *
 * Null rather than a sentence when they ARE recorded: the caller shows the numbers instead, and a
 * reassuring line beside a fact is noise.
 */
export function slotsUnrecorded(
  orbitalSlots: number | null,
  surfaceSlots: number | null,
): string | null {
  if (orbitalSlots !== null || surfaceSlots !== null) return null;

  /*
   * Says WHERE the number comes from, because a member who has never opened the architect view has
   * no idea what is being asked of them — and this is the one field on the planner that cannot be
   * filled in from anywhere but the game.
   */
  return 'Slots not recorded yet — open the system in the game’s architect view and enter them here.';
}
