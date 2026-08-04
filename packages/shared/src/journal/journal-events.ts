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

  // ---------------------------------------------------------------- OPTIONAL
  // Everything below is opt-in and off by default. It answers questions about
  // a MEMBER — where they went, what they killed, what they hauled — rather
  // than about the squadron, and it exists for leaderboards.

  /** Every hyperspace jump: system, distance, and the star at the far end. */
  FSDJump: 'location',
  /** Where they are on a normal-space arrival, and where they docked. */
  Location: 'location',
  Docked: 'location',

  /** A bounty claimed, and what it was worth. */
  Bounty: 'combat',
  /** A kill in a conflict zone or a war, with the faction it counted for. */
  FactionKillBond: 'combat',
  /** A ship destroyed under their guns, by class. */
  PVPKill: 'combat',
  /**
   * Their own death, and who did it.
   *
   * ★ THE OTHER HALF OF A KILLBOARD ★
   *
   * `PVPKill` records a member killing somebody; this records them being
   * killed. A board with only the first is a scoreboard of wins — EVE's works
   * because every kill is also somebody's loss, and both sides are recorded.
   *
   * It names the killer, who is another commander. That is inherent to the
   * feature rather than incidental: a killboard that hid who did the killing
   * would have nothing to show. The member who died is the one sharing their
   * own death, which is theirs to share.
   */
  Died: 'combat',

  /** Cargo bought and sold, with the commodity and the station. */
  MarketBuy: 'trade',
  MarketSell: 'trade',
  /**
   * Opening a station's commodity screen.
   *
   * ★ THE MOST VALUABLE EVENT IN THE JOURNAL, AND WE WERE NOT READING IT ★
   *
   * It carries the station's ENTIRE commodity list — every price, stock and
   * demand figure — as the game showed it seconds ago. The nightly galaxy dump
   * gives the same thing up to twenty-four hours late, and the routes worth
   * flying are the ones that go stale fastest.
   *
   * What is stored from it is only which station was opened; the prices go to
   * `market_entries` where route-finding reads them. See EVENT_FIELDS.
   */
  Market: 'trade',
  /** Mined and refined, which the trade board counts separately. */
  MiningRefined: 'trade',

  /** Scan data sold, which is how exploration is actually scored. */
  MultiSellExplorationData: 'exploration',
  SellExplorationData: 'exploration',
  /** A body scanned in detail — the first-discovery credit. */
  SAAScanComplete: 'exploration',

  /** A mission handed in for a faction, which is what moves the BGS. */
  MissionCompleted: 'bgs',
  /** Data and materials donated to a faction. */
  SellMicroResources: 'bgs',

  /** Fleet carrier jumps and finances, for the squadron's own carrier. */
  CarrierJump: 'carrier',
  CarrierStats: 'carrier',

  /**
   * The suit and weapons a commander takes on foot.
   *
   * ★ A NEW THING COLLECTED, DECLARED THE ORDINARY WAY ★
   *
   * The squadron wanted a chart of what people carry on foot, and nothing was collecting it —
   * `SuitLoadout` was not in this registry, so the ingest had no category for it and every one
   * ever sent was discarded.
   *
   * It joins as its OWN category rather than being folded into `ship` or `combat`, because that is
   * what makes it separately refusable. On-foot loadouts say more about how somebody plays than a
   * ship does, and a member who is happy sharing their Python should not have to accept sharing
   * their suit to keep it — which is exactly what would happen if this rode in on an existing
   * switch.
   *
   * Optional, like everything below the baseline: it appears in the app's "What the squadron keeps"
   * panel and can be switched off there, on its own.
   */
  SuitLoadout: 'onfoot',

  /**
   * Colonisation: what a construction site still needs, and what somebody delivered to it.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "colonization ... will allow our members to post their colonization project to the squadron for
   * assistance etc ... keep our own full records too."
   *
   * ★ THIS IS THE ONLY WAY THE DATA EXISTS ★
   *
   * There is no API anywhere that knows what a construction site needs. Ravencolonial does not; it
   * learns from exactly these two events, sent by exactly this kind of plugin. Shown that, the owner
   * chose to build ours self-contained — which makes this registry entry the whole foundation. An
   * event missing from here is discarded by the ingest with no error, which is how `SuitLoadout`
   * silently collected nothing for weeks.
   *
   * ★ ITS OWN CATEGORY, ON BY DEFAULT ★
   *
   * Consent here is OPT-OUT: a category defaults to on and a member declines it on the website. The
   * owner chose that for this — "On by default for anyone in the colonization system" — on the
   * reasoning that posting a project implies sending its progress, since a project with no progress
   * data is an empty page.
   *
   * Separate from `trade` even though both are cargo, because they answer different questions and
   * one is far more revealing: a delivery says a member was at a specific construction site at a
   * specific moment. Somebody happy to appear on a trade leaderboard should be able to decline that
   * without giving up the leaderboard, which is the same reasoning that gave `onfoot` its own
   * switch.
   */
  ColonisationConstructionDepot: 'colonisation',
  ColonisationContribution: 'colonisation',
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
  /*
   * ★ Credits ADDED 2026-07-29 ★
   *
   * This read "Deliberately NOT Credits, Loan, or FID", and under opt-in that
   * was right: the balance was stripped on the member's machine and nobody had
   * asked for it.
   *
   * Telemetry is opt-out now and the squadron owner asked for the balance on
   * the commander dashboard. `session` cannot be declined, so Credits is
   * deliberately NOT in it — a member who does not want their balance stored
   * would otherwise have no way to refuse, which is the one thing the required
   * category must never be used for. It rides with `profile`, which they can
   * switch off. See LOADGAME_MONEY_FIELDS.
   *
   * `Loan` and `FID` stay out. A Frontier account id identifies the member to
   * Frontier and answers no question the squadron has.
   */
  LoadGame: ['Commander', 'Ship', 'Ship_Localised', 'GameMode', 'Odyssey', 'Credits'],
  Rank: ['Combat', 'Trade', 'Explore', 'Soldier', 'Exobiologist', 'Empire', 'Federation', 'CQC'],
  Progress: ['Combat', 'Trade', 'Explore', 'Soldier', 'Exobiologist', 'Empire', 'Federation', 'CQC'],
  // Deliberately NOT HullValue or ModulesValue. Dropping `Credits` from
  // LoadGame and then keeping the assessed worth of somebody's ship would be a
  // distinction without a difference — both answer "how rich is this member",
  // and neither is needed to check a build against a doctrine.
  Loadout: ['Ship', 'Ship_Localised', 'ShipName', 'ShipIdent', 'Modules'],
  StoredShips: ['StationName', 'StarSystem', 'ShipsHere', 'ShipsRemote'],
  SquadronStartup: ['SquadronName', 'CurrentRank'],

  // ---- optional -----------------------------------------------------------
  // Money survives HERE and nowhere else. A trade leaderboard measured in
  // anything but credits is not a trade leaderboard, and a bounty board that
  // cannot say what a bounty was worth is a list of names. The member opted in
  // to exactly this — see BASELINE_CATEGORIES for what they did not.
  FSDJump: ['StarSystem', 'SystemAddress', 'StarPos', 'JumpDist', 'FuelUsed'],
  Location: ['StarSystem', 'SystemAddress', 'StationName', 'Docked'],
  Docked: ['StarSystem', 'StationName', 'StationType', 'StationFaction'],

  Bounty: ['Target', 'Target_Localised', 'TotalReward', 'VictimFaction'],
  /*
   * Enough for a killboard and no more. `KillerName` and `KillerShip` are what
   * make a loss attributable; `KillerRank` is what makes it interesting.
   *
   * Deliberately NOT the wing variants' full member lists, and not the ship's
   * value — a killboard needs to know who and what, not what the loss was
   * worth.
   */
  Died: ['KillerName', 'KillerShip', 'KillerRank'],
  FactionKillBond: ['AwardingFaction', 'VictimFaction', 'Reward'],
  PVPKill: ['CombatRank'],

  /*
   * BuyPrice / SellPrice / AvgPricePaid joined on 2026-08-04 for the Trade Barons leaderboard:
   * realized profit is TotalSale minus AvgPricePaid×Count, and AvgPricePaid is Frontier's OWN
   * average across every buy the member ever made — including ones this app never saw. The same
   * sensitivity class as the totals already kept: the member's own money, nobody else's.
   */
  MarketBuy: ['Type', 'Type_Localised', 'Count', 'BuyPrice', 'TotalCost', 'MarketID'],
  MarketSell: ['Type', 'Type_Localised', 'Count', 'SellPrice', 'TotalSale', 'AvgPricePaid', 'MarketID'],
  /*
   * ★ DELIBERATELY NOT `Items` ★
   *
   * The event's item list is the whole point of reading it, and it is still not
   * stored HERE. A commodity market is around a hundred entries; keeping the
   * array would write a copy of one station's price list into a member's own
   * telemetry every time they opened a market screen, for a hundred and seven
   * members, forever — and it would be about a STATION rather than about them,
   * which is not what this table is for.
   *
   * The prices are applied to `market_entries` instead, where one row per
   * station-commodity is shared by everybody and route-finding can index it.
   * What survives here is the fact that they docked and looked, which is the
   * part that is genuinely about the member.
   */
  Market: ['MarketID', 'StationName', 'StarSystem'],
  MiningRefined: ['Type', 'Type_Localised'],

  MultiSellExplorationData: ['TotalEarnings', 'BaseValue', 'Bonus', 'Discovered'],
  SellExplorationData: ['TotalEarnings', 'BaseValue', 'Bonus', 'Systems'],
  SAAScanComplete: ['BodyName', 'ProbesUsed', 'EfficiencyTarget'],

  MissionCompleted: ['Name', 'LocalisedName', 'Faction', 'Reward', 'FactionEffects'],
  SellMicroResources: ['MicroResources', 'Price', 'MarketID'],

  CarrierJump: ['StarSystem', 'SystemAddress', 'StationName', 'CarrierID'],
  CarrierStats: ['CarrierID', 'Callsign', 'Name', 'DockingAccess', 'JumpRangeCurr'],

  /*
   * ★ THE SUIT AND WHAT IS IN IT, AND NOTHING ELSE ★
   *
   * A raw SuitLoadout carries SuitID and LoadoutID — Frontier's internal handles, which identify
   * nothing to us and are the sort of value that gets stored because it was in the payload. The
   * chart needs what the suit IS and what weapons are in it; the ids answer no question anybody is
   * asking.
   *
   * `Modules` is the weapon list. It is kept whole because a weapon without its slot is not a
   * loadout — the same gun in a primary and a secondary slot is a different build, which is the
   * distinction the chart exists to show.
   */
  SuitLoadout: ['SuitName', 'SuitName_Localised', 'SuitMods', 'LoadoutName', 'Modules'],

  /*
   * ★ THE ARRAY IS KEPT HERE, UNLIKE EVERYWHERE ELSE ★
   *
   * `Market.Items` is deliberately dropped a few entries above, because storing a hundred-entry
   * price list in a member's own telemetry every time they open a market screen is a copy of public
   * data filed under a person.
   *
   * `ResourcesRequired` is the opposite case on every axis. It is about thirty commodities, not a
   * hundred; it is written once when a depot's needs CHANGE rather than on every screen; it exists
   * nowhere else in the world, because no API publishes what a construction site still needs; and
   * it is the entire reason the event is being read. Dropping it would leave us storing that
   * somebody docked at a building site and nothing about the building.
   *
   * `ConstructionProgress` is the fraction complete, and `ConstructionComplete` / `ConstructionFailed`
   * are how a project stops being current without anybody having to remember to close it.
   */
  ColonisationConstructionDepot: [
    'MarketID',
    'ConstructionProgress',
    'ConstructionComplete',
    'ConstructionFailed',
    'ResourcesRequired',
  ],
  /*
   * What one commander handed over. `Contributions` is a handful of entries — the contents of a
   * hold, not a market — and it is the ledger the squadron leaderboard is summed from.
   */
  ColonisationContribution: ['MarketID', 'Contributions'],
};

/**
 * Money fields the OPTIONAL categories are allowed to keep.
 *
 * ★ WHY AN EXCEPTION EXISTS AT ALL ★
 *
 * The baseline strips every price at every depth, because "how rich is this
 * member" is not a question the squadron needs answered to know they play.
 *
 * But a trade leaderboard measured in anything other than credits is not a
 * trade leaderboard, and a bounty board that cannot say what a bounty was worth
 * is a list of names. So the events a member OPTS IN to may carry the figure
 * that is the entire point of them — and only that figure, named here rather
 * than by lifting the rule generally.
 */
const EARNINGS_FIELDS = new Set([
  /*
   * The commander's own balance, kept on purpose since 2026-07-29. `stripMoney`
   * removes money at every depth, which would otherwise delete the very field
   * the dashboard was asked to show.
   */
  'Credits',
  'TotalReward',
  'Reward',
  'TotalCost',
  'TotalSale',
  'TotalEarnings',
  'BaseValue',
  'Bonus',
  'Price',
]);

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
    if (raw[field] === undefined) continue;
    // A named earnings field on an opted-in event survives intact; everything
    // else is stripped of prices at every depth. See EARNINGS_FIELDS.
    out[field] = EARNINGS_FIELDS.has(field) ? raw[field] : stripMoney(raw[field]);
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
 * ★ THREE BASELINE, SIX OPTIONAL ★
 *
 * The baseline — session, profile, fleet — comes with running the app. The
 * optional six are opt-in, default to off, and purge when revoked.
 *
 * The split is not arbitrary: the baseline answers questions about the
 * SQUADRON (who is active, what rank, what can they field) and the optional set
 * answers questions about a MEMBER (where they went, what they killed, what
 * they hauled). The first is why the platform exists; the second is a
 * leaderboard, and nobody's business unless they say so.
 *
 * Total Record, so adding a label to `JOURNAL_EVENTS` without deciding where it
 * belongs fails to compile. These strings are values of the database's
 * `TelemetryCategory` enum; a test in the API pins them to it, because this
 * package cannot import the generated client.
 */
export type TelemetryCategoryName =
  | 'session'
  | 'profile'
  | 'fleet'
  | 'location'
  | 'combat'
  | 'trade'
  | 'exploration'
  | 'bgs'
  | 'carrier'
  /** On-foot: the suit and weapons a commander takes out of the ship. */
  | 'onfoot'
  /** Colonisation: construction-site needs, and deliveries to them. */
  | 'colonisation';

const CATEGORY_BY_LABEL: Record<JournalCategory, TelemetryCategoryName> = {
  // ---- baseline -----------------------------------------------------------
  session: 'session',
  // What a commander IS, rather than what they did.
  ranks: 'profile',
  squadron: 'profile',
  // What they own. `ship` is the current one, `fleet` is all of them — a
  // distinction that matters to the app and not to consent.
  ship: 'fleet',
  fleet: 'fleet',

  // ---- optional -----------------------------------------------------------
  location: 'location',
  combat: 'combat',
  trade: 'trade',
  exploration: 'exploration',
  bgs: 'bgs',
  carrier: 'carrier',
  onfoot: 'onfoot',
  colonisation: 'colonisation',
};

/**
 * The categories that come with running the app at all (INV-013).
 *
 * ★ WHY THESE THREE ARE NOT A CHECKBOX ★
 *
 * They are what the platform exists to hold: who is playing, what rank they
 * hold, what they fly. Making them conditional on a setting meant a member
 * could install the app, leave it running for a month, and be told they had not
 * qualified for a promotion because of a box they never saw.
 *
 * The consent is the INSTALL. The app is entirely optional, ships switched off,
 * says plainly what it sends, and will show a member the exact contents of a
 * batch from their own journals before they turn it on — which is a good deal
 * more informed than a checkbox nobody reads.
 */
export const BASELINE_CATEGORIES: readonly TelemetryCategoryName[] = ['session', 'profile', 'fleet'];

/**
 * The categories that are opt-in, default to off, and purge on revoke.
 *
 * These answer questions about a MEMBER rather than about the squadron — where
 * they went, what they fought, what they hauled. Useful for leaderboards, and
 * nobody's business unless they say so.
 */
export const OPTIONAL_CATEGORIES: readonly TelemetryCategoryName[] = [
  'location',
  'combat',
  'trade',
  'exploration',
  'bgs',
  'carrier',
];

/** Is this category collected regardless of consent? */
export function isBaselineCategory(category: string): boolean {
  return (BASELINE_CATEGORIES as readonly string[]).includes(category);
}

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

/**
 * The handful of events the companion app will NOT send, whatever the settings.
 *
 * ★ THE ONE EXCEPTION TO "SEND EVERYTHING" (2026-07-29) ★
 *
 * Telemetry is opt-out and the app no longer filters by category — it sends
 * what it reads and the server applies the member's choices. This list is
 * deliberately not part of that model, and it is short.
 *
 * Every entry satisfies all four of:
 *
 *   1. It carries somebody's PRIVATE WORDS or personal relationships — the body
 *      of a direct message, who sent it, who is on their friends list.
 *   2. It belongs to no category, so no member could opt IN to it even if they
 *      wanted to.
 *   3. The server already rejects it as an unknown event, so transmitting it
 *      achieves nothing.
 *   4. It frequently contains a THIRD PARTY's words. A member can consent to
 *      sharing their own data; they cannot consent on behalf of the commander
 *      who messaged them.
 *
 * Point 4 is the one that settles it. Everything else on the journal is a fact
 * about the member; this is a fact about somebody else who never agreed to
 * anything.
 *
 * `Died` is here for a different reason: it names the commander who killed
 * them, which is another player, and answers no question the squadron has.
 */
export const NEVER_SENT: readonly string[] = [
  'SendText',
  'ReceiveText',
  'Friends',
  /*
   * `Died` was here and was REMOVED on 2026-07-29, on the squadron owner's
   * instruction, to build an EVE-style killboard.
   *
   * The original objection was that it names another commander. That still
   * holds — but it is inherent to a killboard rather than incidental, and
   * `PVPKill` already records the mirror image: a member killing somebody else,
   * naming them. Excluding one side while sending the other was the real
   * inconsistency.
   *
   * The three that remain are different in kind. They carry the CONTENT of
   * private messages and a friends list, which no feature needs and which no
   * member could opt in to.
   */
];

/** Will the companion app transmit this event? */
export function isSendable(name: string): boolean {
  return name !== '' && !NEVER_SENT.includes(name);
}
