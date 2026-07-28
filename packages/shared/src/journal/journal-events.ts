/**
 * Which journal events we care about, and what each one tells us (P1.11).
 *
 * ★ AN ALLOWLIST, NOT A FILTER ★
 *
 * Elite's journal contains hundreds of event types and a great deal that is
 * nobody's business — every system visited, every message sent, every bounty.
 * The companion app sends ONLY the events named here, and it decides that on
 * the member's own machine, before anything leaves it.
 *
 * That ordering is the whole privacy design. Filtering server-side would mean
 * the data had already been transmitted, and "we promise to throw it away" is a
 * much weaker promise than never having received it.
 *
 * Adding an event to this list is therefore a deliberate act with a privacy
 * consequence, which is why each one carries a note saying what it is FOR.
 */

export const JOURNAL_EVENTS = {
  /**
   * Session start. Carries the commander name, credits and current ship.
   *
   * THE ONE THAT MATTERS MOST: its presence in a month is what proves the
   * member played, which is the input the promotion engine has been missing.
   */
  LoadGame: 'session',

  /** Pilot ranks — combat, trade, exploration, CQC, and the naval ranks. */
  Rank: 'ranks',

  /** Progress toward the next rank, as a percentage per rank. */
  Progress: 'ranks',

  /** The full module list for the current ship. */
  Loadout: 'ship',

  /** Every ship they own and where it is parked. */
  StoredShips: 'fleet',

  /** Squadron name and rank, as the game itself reports it. */
  SquadronStartup: 'squadron',
} as const;

export type JournalEventName = keyof typeof JOURNAL_EVENTS;
export type JournalCategory = (typeof JOURNAL_EVENTS)[JournalEventName];

/** Is this an event the companion app is permitted to send? */
export function isAllowedEvent(name: string): name is JournalEventName {
  return Object.prototype.hasOwnProperty.call(JOURNAL_EVENTS, name);
}

/**
 * Fields we keep from each event.
 *
 * ★ ALSO AN ALLOWLIST ★
 *
 * `LoadGame` alone carries the member's credits, loan, game mode, whether they
 * are in a group, and their Frontier account ID. We want to know they played;
 * we do not need their bank balance to establish that.
 *
 * Anything not named here is dropped on the member's machine and never sent.
 */
export const EVENT_FIELDS: Record<JournalEventName, readonly string[]> = {
  // Commander and ship only. Deliberately NOT Credits, Loan, or FID.
  LoadGame: ['Commander', 'Ship', 'Ship_Localised', 'GameMode', 'Odyssey'],
  Rank: ['Combat', 'Trade', 'Explore', 'Soldier', 'Exobiologist', 'Empire', 'Federation', 'CQC'],
  Progress: ['Combat', 'Trade', 'Explore', 'Soldier', 'Exobiologist', 'Empire', 'Federation', 'CQC'],
  Loadout: ['Ship', 'Ship_Localised', 'ShipName', 'ShipIdent', 'HullValue', 'ModulesValue', 'Modules'],
  StoredShips: ['StationName', 'StarSystem', 'ShipsHere', 'ShipsRemote'],
  SquadronStartup: ['SquadronName', 'CurrentRank'],
};

/**
 * Strips an event down to the allowed fields.
 *
 * Runs in the COMPANION APP, before transmission. The server applies it again
 * on receipt — not because the app is untrusted in a way that this fixes (a
 * modified client can send anything), but because a future version of the app
 * with a bug must not be able to widen what we store.
 */
export function pickAllowedFields(
  eventName: JournalEventName,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = EVENT_FIELDS[eventName];
  const out: Record<string, unknown> = {};
  for (const field of allowed) {
    if (raw[field] !== undefined) out[field] = raw[field];
  }
  return out;
}

/**
 * Is this journal from the LIVE game rather than Legacy or a beta?
 *
 * Odyssey and Horizons 4.0 report `Odyssey: true` in LoadGame. Legacy
 * (Horizons 3.8) does not, and its data describes a different galaxy state
 * that would be wrong to record against a member's current standing.
 *
 * Also the rule Inara states plainly for its own uploads — worth honouring for
 * our own data even though we send them nothing.
 */
export function isLiveGameSession(loadGame: Record<string, unknown>): boolean {
  return loadGame['Odyssey'] === true;
}
