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
  // Deliberately NOT HullValue or ModulesValue. Dropping `Credits` from
  // LoadGame and then keeping the assessed worth of somebody's ship would be a
  // distinction without a difference — both answer "how rich is this member",
  // and neither is needed to check a build against a doctrine.
  Loadout: ['Ship', 'Ship_Localised', 'ShipName', 'ShipIdent', 'Modules'],
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
    if (raw[field] !== undefined) out[field] = stripMoney(raw[field]);
  }
  return out;
}

/**
 * Money fields, stripped at EVERY depth.
 *
 * ★ THE HOLE THIS CLOSES ★
 *
 * `EVENT_FIELDS` is a TOP-LEVEL allowlist, and the comment above it — "anything
 * not named here is dropped" — was not true of anything nested. `Loadout.Modules`
 * is an array of module objects each carrying its own `Value`, and
 * `StoredShips.ShipsHere` likewise. So we were carefully dropping `Credits` from
 * LoadGame and then shipping a complete itemised valuation of the member's fleet
 * one level down.
 *
 * Naming the fields is deliberate, and narrower than pruning by depth: the
 * module list itself is exactly what a fleet doctrine check needs, and throwing
 * it away to avoid the prices in it would be the wrong trade.
 */
const MONEY_FIELDS = new Set(['Value', 'BuyPrice', 'SellPrice', 'Rebuy', 'HullValue', 'ModulesValue']);

function stripMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (MONEY_FIELDS.has(k)) continue;
    out[k] = stripMoney(v);
  }
  return out;
}

/**
 * The consent category an event is stored under (INV-013).
 *
 * ★ WHY `session` IS ALONE ★
 *
 * Consent is per-category, so a category is only meaningful if a member can
 * predict what lands in it. `session` holds LoadGame and nothing else: the one
 * input the promotion engine needs, and the least revealing thing we collect.
 * Split out like this, a member can confirm they play — and qualify for a
 * promotion — WITHOUT sharing what they did while playing.
 *
 * Total Record, so adding a label to `JOURNAL_EVENTS` without deciding where it
 * belongs fails to compile. These three strings are values of the database's
 * `TelemetryCategory` enum; a test in the API pins them to it, because this
 * package cannot import the generated client.
 */
export type TelemetryCategoryName = 'session' | 'profile' | 'fleet';

const CATEGORY_BY_LABEL: Record<JournalCategory, TelemetryCategoryName> = {
  session: 'session',
  // What a commander IS, rather than what they did.
  ranks: 'profile',
  squadron: 'profile',
  // What they own. `ship` is the current one, `fleet` is all of them — a
  // distinction that matters to the app and not to consent.
  ship: 'fleet',
  fleet: 'fleet',
};

export function telemetryCategoryFor(eventName: JournalEventName): TelemetryCategoryName {
  return CATEGORY_BY_LABEL[JOURNAL_EVENTS[eventName]];
}

/**
 * JSON with object keys sorted at every depth.
 *
 * `JSON.stringify` preserves insertion order, so the same event parsed twice
 * could hash differently and dedupe would quietly stop working — a retry would
 * look like a new event and get stored again.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Is this journal from the LIVE galaxy rather than Legacy?
 *
 * ★ WHY THIS MATTERS ★
 *
 * Horizons 3.8 ("Legacy") was split off in 2022 and its galaxy has diverged ever
 * since. Its squadron ranks, ship locations and station names are all real, and
 * all wrong about the game everybody else is playing. Recording them against a
 * member's current standing produces data that is confidently incorrect rather
 * than merely missing, which is much worse.
 *
 * ★ WHY NOT `Odyssey`, WHICH IS THE OBVIOUS FIELD ★
 *
 * Because it does not mean what it looks like it means. `LoadGame.Odyssey`
 * reports whether the player owns the ODYSSEY EXPANSION, not which galaxy they
 * are in — a Horizons 4.0 player is on Live and reports `Odyssey: false`.
 * Reading it as a Live/Legacy flag would silently discard everything sent by
 * every member without the expansion, and the symptom would be those members
 * never qualifying for a promotion for reasons nobody could see.
 *
 * `Fileheader.gameversion` is the field Frontier added for exactly this
 * question: 4.x is Live, 3.8 is Legacy.
 */
export function isLiveGameVersion(fileheader: Record<string, unknown>): boolean {
  const version = fileheader['gameversion'];
  if (typeof version !== 'string') {
    /*
     * Journals written before Update 14 have no gameversion at all — and they
     * pre-date the split, so they were Live when they were written. Treated as
     * Live: refusing them would throw away real history, and the alternative
     * error (accepting a handful of genuinely old sessions) is the milder one.
     */
    return true;
  }
  return !version.startsWith('3.');
}
