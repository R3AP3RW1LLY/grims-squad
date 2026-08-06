/**
 * The background simulation: what a mission did, and whether the squadron asked for it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "create a BGS leaderboard, and allow the officers to choose what factions we want to be running
 * missions for etc, give instructions to the squad members etc."
 *
 * ★ THE DATA WAS ALREADY BEING COLLECTED ★
 *
 * `MissionCompleted` carries `FactionEffects` — the faction, the system, and the influence as a run
 * of plus signs — and production holds thousands of them going back weeks. So the board can launch
 * with real history instead of empty, which is only true if this parser is right about events
 * nobody is ever going to re-check by hand.
 *
 * ★ THE ORDERS ARE THE FEATURE ★
 *
 * Points come from influence pushed toward a faction the officers named, in the direction they
 * asked for, and from nothing else. That single rule is what turns a scoreboard into an instrument
 * of direction: officers change what the squadron does by editing a list, rather than by asking
 * twice in Discord and hoping.
 */

/** What the officers want doing about a faction in a system. */
export type BgsStance =
  /** Run missions for them here. The ordinary case. */
  | 'push'
  /**
   * Keep it where it is.
   *
   * Influence pushed too high triggers an expansion into systems the squadron may not want, so
   * "more" is not always better and a board that only rewarded more would damage the faction.
   */
  | 'hold'
  /**
   * Leave this alone.
   *
   * The order members will never guess, and the one worth writing down: usually the officers are
   * managing a delicate state that well-meant effort would undo.
   */
  | 'avoid';

/** A standing order, as the scorer needs it. */
export interface BgsOrder {
  readonly faction: string;
  readonly stance: BgsStance;
}

/** One faction moved in one system by one mission. */
export interface FactionEffect {
  readonly faction: string;
  /**
   * Frontier's system id, as a STRING.
   *
   * ★ NEVER A NUMBER ★
   *
   * SystemAddress runs past 2^53, where JavaScript numbers stop being exact — two different systems
   * can round to the same value. Influence would then be filed against the wrong system and nothing
   * anywhere would look wrong. Same rule as every other 64-bit id on this platform (INV-006).
   */
  readonly systemAddress: string;
  /** Positive for influence gained, negative for influence lost. */
  readonly pips: number;
}

/** Credits of score per pip of influence. A pip is a real, hard-won unit; it is worth a round ten. */
export const BGS_POINTS_PER_PIP = 10;

/**
 * What a HOLD contribution earns against a PUSH one.
 *
 * Not zero — the members keeping a system stable are doing the work the officers asked for. Not
 * full either, or HOLD and PUSH would be indistinguishable and the distinction is the whole reason
 * the stance exists.
 */
export const HOLD_MULTIPLIER = 0.5;

/** `'+++'` → 3, `'--'` → -2, anything else → 0. */
export function pipsOf(raw: unknown): number {
  if (typeof raw !== 'string' || raw === '') return 0;

  // Every character must be the same sign. A mixed or worded value ("None") is not a measurement.
  if (/^\++$/.test(raw)) return raw.length;
  if (/^-+$/.test(raw)) return -raw.length;
  return 0;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Every faction this mission moved, in every system it moved them.
 *
 * ★ ONE MISSION IS USUALLY SEVERAL EFFECTS ★
 *
 * A mission handed in for one faction routinely moves a rival the other way, and chained missions
 * touch more than one system. Reading only the first effect — the obvious shape of the mistake —
 * would silently lose most of what actually happened, and the ledger would under-report the
 * squadron's own work.
 */
export function readFactionEffects(payload: unknown): FactionEffect[] {
  if (typeof payload !== 'object' || payload === null) return [];

  const raw = (payload as Record<string, unknown>)['FactionEffects'];
  if (!Array.isArray(raw)) return [];

  const out: FactionEffect[] = [];

  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const group = entry as Record<string, unknown>;

    const faction = str(group['Faction']);
    if (faction === null) continue;

    const influences = group['Influence'];
    // Missions that pay only reputation carry no Influence at all. Recording them as zero-pip rows
    // would bulk out the ledger with entries that can never score.
    if (!Array.isArray(influences)) continue;

    for (const inf of influences as unknown[]) {
      if (typeof inf !== 'object' || inf === null) continue;
      const one = inf as Record<string, unknown>;

      const pips = pipsOf(one['Influence']);
      if (pips === 0) continue;

      /*
       * Stringified rather than cast. Frontier writes it as a JSON number, and by the time it
       * reaches here the damage — if any — is already done; what this guarantees is that no further
       * arithmetic can lose precision, and that the value is stored and compared as an exact key.
       */
      const address = one['SystemAddress'];
      const systemAddress =
        typeof address === 'string'
          ? address
          : typeof address === 'number'
            ? String(BigInt(Math.trunc(address)))
            : null;
      if (systemAddress === null) continue;

      out.push({ faction, systemAddress, pips });
    }
  }

  return out;
}

/**
 * What this contribution is worth on the board.
 *
 * ★ NOTHING SCORES WITHOUT AN ORDER ★
 *
 * A faction the officers have not named scores zero, however much influence was moved. That is the
 * rule the board exists for: it makes the leaderboard a statement of what the squadron is trying to
 * achieve rather than a record of who played the most hours.
 */
export function scoreContribution({
  pips,
  order,
}: {
  readonly pips: number;
  readonly order: BgsOrder | null;
}): number {
  if (order === null || pips === 0) return 0;

  /*
   * AVOID pays nothing in EITHER direction. Paying for pushing a disfavoured faction down is
   * tempting — it sounds helpful — but the order usually exists because the officers are managing a
   * delicate state, and rewarding interference invites exactly the meddling it forbids.
   */
  if (order.stance === 'avoid') return 0;

  const base = pips * BGS_POINTS_PER_PIP;

  /*
   * Negative influence toward a faction the squadron is backing is a member working against the
   * plan, and it costs them. Scoring it zero would make undoing the squadron's work free.
   */
  if (order.stance === 'hold') return Math.floor(base * HOLD_MULTIPLIER);
  return base;
}
