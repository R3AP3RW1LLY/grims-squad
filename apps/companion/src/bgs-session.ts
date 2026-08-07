import { readFactionEffects, scoreContribution, type BgsStance } from '@grims/shared/bgs';

/**
 * What the member has moved for the squadron this session, and what applies where they are standing.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "for the BGS system, create an overlay in the companion app with settings etc like the mining
 * overlay please!"
 *
 * ★ THE PANEL ANSWERS ONE QUESTION THE GAME WILL NOT ★
 *
 * A member sitting in a station with a mission board full of offers is choosing which faction to
 * take work from. The game shows every faction equally; only the squadron knows which of them the
 * officers asked for. That is the whole reason this overlay exists — it puts the standing orders
 * for THIS system in front of the member at the moment the choice is made, rather than in a Discord
 * message they read yesterday.
 *
 * ★ SCORED WITH THE HUB'S OWN ARITHMETIC ★
 *
 * `scoreContribution` is the same function the worker scores the leaderboard with, reading the same
 * orders. A panel that estimated separately would drift, and the member watching it all evening
 * would be right to trust the panel and wrong about their score.
 */

/** One standing order, as the hub sends it. */
export interface BgsStanding {
  readonly faction: string;
  readonly stance: string;
  readonly systemName: string | null;
  readonly priority: number;
  readonly guidance: string | null;
}

export interface BgsSessionState {
  /** Missions completed this session that moved influence at all. */
  readonly missions: number;
  /** Total influence pips moved, whether or not they scored. */
  readonly pips: number;
  /** Points by the hub's own arithmetic — the number that will land on Faction Hands. */
  readonly points: number;
  /** Pips per faction, for the panel's list. */
  readonly byFaction: Readonly<Record<string, number>>;
  /** When the first mission landed. Null until one does. */
  readonly startedAt: number | null;
  readonly lastAt: number | null;
}

export const EMPTY_BGS: BgsSessionState = {
  missions: 0,
  pips: 0,
  points: 0,
  byFaction: {},
  startedAt: null,
  lastAt: null,
};

function isStance(v: string): v is BgsStance {
  return v === 'push' || v === 'hold' || v === 'suppress' || v === 'ignore';
}

/**
 * Fold one `MissionCompleted` into the session.
 *
 * @param at when the mission was handed in, in epoch milliseconds.
 */
export function foldMission(
  state: BgsSessionState,
  payload: unknown,
  orders: readonly BgsStanding[],
  at: number,
): BgsSessionState {
  const effects = readFactionEffects(payload);

  /*
   * Returned unchanged — the same object, so a caller comparing by reference can skip a redraw.
   * Reputation-only missions land here, and counting them would have the panel claim work that did
   * not move the needle.
   */
  if (effects.length === 0) return state;

  const byFaction = { ...state.byFaction };
  let pips = state.pips;
  let points = state.points;

  for (const effect of effects) {
    /*
     * The order is matched on faction alone, not faction AND system. The member is standing in one
     * place and the effect names the system it moved — but an order set for a faction is the
     * officers' statement about that faction, and refusing to score a pip because the mission
     * chained into the next system over would under-report work that was genuinely asked for. The
     * hub scores per-system because it has the whole picture; the panel is showing this member
     * their own evening.
     */
    const order = orders.find(
      (o) => o.faction.trim().toLowerCase() === effect.faction.trim().toLowerCase(),
    );

    pips += effect.pips;
    byFaction[effect.faction] = (byFaction[effect.faction] ?? 0) + effect.pips;

    points += scoreContribution({
      pips: effect.pips,
      order:
        order !== undefined && isStance(order.stance)
          ? { faction: order.faction, stance: order.stance }
          : null,
    });
  }

  return {
    // One mission, however many factions it moved. Counting effects would inflate the tally for
    // exactly the chained missions that are the most work.
    missions: state.missions + 1,
    pips,
    points,
    byFaction,
    // The clock starts on the first mission, not on app launch — otherwise somebody who left the
    // app running overnight is shown a rate of nothing per hour.
    startedAt: state.startedAt ?? at,
    lastAt: at,
  };
}

export interface BgsStandingHere {
  /** Orders that apply in this system, most important first. */
  readonly here: readonly BgsStanding[];
  /** How many orders apply somewhere else. */
  readonly elsewhere: number;
}

/**
 * Split the standing orders into "applies where you are" and "applies elsewhere".
 *
 * ★ THE ELSEWHERE COUNT IS NOT DECORATION ★
 *
 * Without it, a system with no orders looks exactly like a squadron with no orders — and a member
 * who concludes there is no BGS work goes and does something else. Saying "3 elsewhere" turns an
 * empty panel into a reason to move.
 */
export function standingFor(
  orders: readonly BgsStanding[],
  systemName: string | null,
): BgsStandingHere {
  if (systemName === null || systemName.trim() === '') {
    return { here: [], elsewhere: orders.length };
  }

  const want = systemName.trim().toLowerCase();
  const here = orders
    .filter((o) => o.systemName !== null && o.systemName.trim().toLowerCase() === want)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  return { here, elsewhere: orders.length - here.length };
}
