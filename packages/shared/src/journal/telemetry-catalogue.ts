import {
  JOURNAL_EVENTS,
  telemetryCategoryFor,
  type JournalEventName,
  type TelemetryCategoryName,
} from './journal-events.js';

/**
 * Everything the companion app sends, described for a member to read.
 *
 * ★ WHY THIS EXISTS SEPARATELY FROM THE ALLOWLIST ★
 *
 * `JOURNAL_EVENTS` maps an event to a category — it is machinery. This is the
 * same set written for somebody deciding what to share: grouped, named in
 * English, and saying what each one actually reveals.
 *
 * Telemetry became OPT-OUT on 2026-07-29 (INV-013, amended). A member who can
 * switch anything off has to be able to SEE everything first, and "MultiSell-
 * ExplorationData" tells them nothing. A settings page built from the raw
 * allowlist would be a list of symbols with checkboxes beside them.
 */

/** What one journal event reveals, in the member's own terms. */
export interface CatalogueEntry {
  readonly event: JournalEventName;
  /** What it is called on the settings page. */
  readonly label: string;
  /** What it actually discloses. Written to be read by somebody deciding. */
  readonly reveals: string;
}

export interface CatalogueGroup {
  readonly category: TelemetryCategoryName;
  readonly label: string;
  /** What the whole group is for, and why we want it. */
  readonly purpose: string;
  /**
   * True when the member cannot switch this off.
   *
   * Exactly one group is required, and the UI states WHY rather than showing a
   * disabled toggle with no explanation — a control that does nothing and says
   * nothing reads as a bug.
   */
  readonly required: boolean;
  readonly entries: readonly CatalogueEntry[];
}

/**
 * The one category a member may not decline.
 *
 * ★ NOT A PREFERENCE — A DEPENDENCY ★
 *
 * Promotion eligibility is computed from whether a LoadGame appeared in the
 * month (rank-progression.yaml). A member who switched this off would silently
 * stop qualifying for promotions they had earned, and would have no way to
 * connect the two. That is precisely the failure the 2026-07-27 amendment was
 * written to prevent, and it is why this is refused by the service rather than
 * merely greyed out in the UI.
 */
export const REQUIRED_CATEGORY: TelemetryCategoryName = 'session';

/**
 * The catalogue, grouped as the settings page renders it.
 *
 * Ordered with the required group first — a member should meet the one thing
 * they cannot change before the twenty they can, rather than discovering it at
 * the bottom.
 */
export const TELEMETRY_CATALOGUE: readonly CatalogueGroup[] = [
  {
    category: 'session',
    label: 'Playing',
    purpose:
      'That you played at all, and when. This is the single input the monthly promotion check reads, which is why it cannot be switched off.',
    required: true,
    entries: [
      {
        event: 'LoadGame',
        label: 'Game start',
        /*
         * ★ THIS SENTENCE WAS WRONG ★
         *
         * It read "Not your balance." — true when it was written, and false
         * from the moment credits were added to the LoadGame allowlist on the
         * squadron owner's instruction. A member reading it would have been
         * told, by the very screen built to tell them the truth, that something
         * was not collected while it was.
         *
         * The balance travels with `profile`, which CAN be switched off, so it
         * is named there rather than here — see the note on the balance panel.
         */
        reveals:
          'That you launched Elite, the ship you loaded into, and whether it was open, solo or a private group. Your credit balance rides with this one.',
      },
    ],
  },
  {
    category: 'profile',
    label: 'Ranks and standing',
    purpose: 'What your commander IS — the ladders you have climbed and where you sit in them.',
    required: false,
    entries: [
      { event: 'Rank', label: 'Pilot ranks', reveals: 'Your combat, trade, exploration, mercenary, exobiology and CQC ranks.' },
      { event: 'Progress', label: 'Rank progress', reveals: 'How far through each rank you are, as a percentage.' },
      { event: 'SquadronStartup', label: 'Squadron standing', reveals: 'The squadron the game has you in, and your rank inside it.' },
    ],
  },
  {
    category: 'fleet',
    label: 'Ships',
    purpose: 'What you fly and what you own. Drives your fleet on the dashboard and the roster.',
    required: false,
    entries: [
      { event: 'StoredShips', label: 'Your hangar', reveals: 'Every ship you own, its name, and the system it is parked in.' },
      { event: 'Loadout', label: 'Current build', reveals: 'The modules fitted to the ship you are flying. Not their value.' },
    ],
  },
  {
    category: 'location',
    label: 'Where you are',
    purpose: 'Your position in the galaxy, for the map and for finding people to fly with.',
    required: false,
    entries: [
      { event: 'FSDJump', label: 'Hyperspace jumps', reveals: 'Each system you jump to, how far it was, and the fuel it cost.' },
      { event: 'Location', label: 'Current system', reveals: 'The system you are in, and whether you are docked.' },
      { event: 'Docked', label: 'Docking', reveals: 'The station you docked at and the faction that runs it.' },
      /*
       * ★ ADDED 2026-08-06, SO THE DASHBOARD CAN SAY WHERE YOU ARE ★
       *
       * The three events that make "where in the system" answerable. Without them the dashboard
       * could only say a system name, and a station name for as long as you stayed docked — so a
       * member flying around a planet showed as still docked at wherever they last were.
       *
       * Written the same way as the rest: what the event REVEALS, in the member's terms, because
       * this catalogue is the page where they decide whether to send it.
       */
      {
        event: 'SupercruiseExit',
        label: 'Arriving at a body',
        reveals: 'The planet, moon or star you drop out of supercruise at.',
      },
      {
        event: 'ApproachSettlement',
        label: 'Approaching a settlement',
        reveals: 'The name of a surface settlement you fly up to, and the body it sits on.',
      },
      {
        event: 'Undocked',
        label: 'Leaving a station',
        reveals: 'That you have left a station — which is how your location stops showing you docked there.',
      },
    ],
  },
  {
    category: 'combat',
    label: 'Combat',
    purpose: 'Bounties, conflict-zone kills and PVP, for the combat leaderboard.',
    required: false,
    entries: [
      { event: 'Bounty', label: 'Bounties claimed', reveals: 'What you shot, its faction, and the reward.' },
      { event: 'FactionKillBond', label: 'Conflict zones', reveals: 'Kills in a war or conflict zone, and which faction they counted for.' },
      { event: 'PVPKill', label: 'PVP kills', reveals: 'That you destroyed another commander, and their combat rank.' },
      {
        event: 'Died',
        label: 'Your losses',
        reveals:
          'That you were destroyed, who did it, and what they were flying. Feeds the squadron killboard — which needs both sides of a fight to mean anything.',
      },
    ],
  },
  {
    category: 'trade',
    label: 'Trade and mining',
    purpose: 'Cargo moved and ore refined, for the trade leaderboard.',
    required: false,
    entries: [
      {
        event: 'Market',
        label: 'Market screens you open',
        /*
         * Written plainly, and it says what the squadron gets as well as what
         * we keep. A member reading this is deciding whether to leave it on;
         * "the station's prices" without "shared with everyone" would be true
         * and still misleading.
         */
        /*
         * ★ THE FILE IS NAMED, AS OF 2026-08-06 ★
         *
         * This already promised the prices were shared, and for the whole life of the feature they
         * were not: Frontier's journal event carries no prices at all, and the app was reading only
         * the journal. Production had 1,092 of these events, zero market rows and zero data
         * bounties paid.
         *
         * The app now reads `Market.json` — the file the game writes the price list into — when one
         * of these events fires. Saying so is the point: a member deciding whether to leave this on
         * should be told which file it reads, not only what the result is used for.
         */
        reveals:
          'Which station you opened the commodity market at, and the prices on that screen — read from the game’s own Market.json the moment you open it. They are shared with the squadron so route-finding works from what someone actually saw rather than from last night; your name is not attached to them.',
      },
      { event: 'MarketBuy', label: 'Cargo bought', reveals: 'The commodity, the quantity and the station.' },
      { event: 'MarketSell', label: 'Cargo sold', reveals: 'The commodity, the quantity, the station and the price.' },
      {
        event: 'Cargo',
        label: 'What is in your hold',
        reveals:
          'Everything your ship is carrying right now, including anything the game has flagged as '
          + 'stolen. It is what stops two members buying the same materials for the same build — a '
          + 'colonisation project shows who is already holding what, so nobody flies out for steel '
          + 'somebody else has aboard. Your carrier’s hold is reported separately and is not this.',
      },
      { event: 'MiningRefined', label: 'Ore refined', reveals: 'What you refined while mining.' },
    ],
  },
  {
    category: 'exploration',
    label: 'Exploration',
    purpose: 'Scan data sold and bodies mapped, which is how exploration is actually scored.',
    required: false,
    entries: [
      { event: 'SellExplorationData', label: 'Data sold', reveals: 'The systems whose scan data you sold, and what it earned.' },
      { event: 'MultiSellExplorationData', label: 'Bulk data sold', reveals: 'The same, when several systems are sold together.' },
      { event: 'SAAScanComplete', label: 'Bodies mapped', reveals: 'The body you mapped in detail, and whether you were first.' },
    ],
  },
  {
    category: 'bgs',
    label: 'Background simulation',
    purpose: 'Work that moves our minor faction. Read by the BGS board.',
    required: false,
    entries: [
      { event: 'MissionCompleted', label: 'Missions handed in', reveals: 'The faction you worked for and what the mission paid.' },
      { event: 'SellMicroResources', label: 'Materials donated', reveals: 'Data and materials handed to a faction.' },
    ],
  },
  {
    category: 'carrier',
    label: 'Fleet carrier',
    purpose: 'Carrier movements and finances, for members who own one.',
    required: false,
    entries: [
      { event: 'CarrierJump', label: 'Carrier jumps', reveals: 'Where your carrier jumped to.' },
      { event: 'CarrierStats', label: 'Carrier status', reveals: 'Its name, services and balance.' },
      {
        event: 'CargoTransfer',
        label: 'Carrier cargo moves',
        reveals:
          'Cargo you move between your ship and your own carrier. When that carrier is attached to a colonisation build, this is what keeps its declared hold current.',
      },
    ],
  },
  {
    /*
     * ★ ITS OWN GROUP, SO IT IS SEPARATELY REFUSABLE ★
     *
     * Folding this into `fleet` or `combat` would mean a member who is happy sharing their Python
     * has to accept sharing their suit to keep it. An on-foot loadout says rather more about how
     * somebody plays than a hull does, and the whole point of this catalogue is that each thing can
     * be declined on its own terms.
     */
    category: 'onfoot',
    label: 'On foot',
    purpose: 'What you carry when you leave the ship, for the squadron weapons chart.',
    required: false,
    entries: [
      {
        event: 'SuitLoadout',
        label: 'Suit and weapons',
        reveals: 'Which suit you wear and the weapons in it, with their engineering.',
      },
    ],
  },
  {
    /*
     * ★ SQUADRON OWNER, 2026-08-02 ★
     *
     * "colonization ... will allow our members to post their colonization project to the squadron
     * for assistance etc", and, on how it should reach people: "On by default for anyone in the
     * colonization system".
     *
     * Consent here is opt-out, so being in the catalogue at all IS on by default. What it buys is
     * the thing that matters: a member can see exactly what this collects and switch it off,
     * knowing what they lose. Nothing about colonisation is collected silently.
     *
     * Its own group rather than part of `trade`, because a delivery says a member was at a specific
     * construction site at a specific moment — rather more than a tonnage on a leaderboard — and
     * declining one should not cost the other.
     */
    category: 'colonisation',
    label: 'Colonisation',
    purpose:
      'Progress on construction sites, so a project you post keeps itself up to date and the squadron can see what it still needs.',
    required: false,
    entries: [
      {
        event: 'ColonisationConstructionDepot',
        label: 'What a site still needs',
        reveals:
          'The commodities a construction site you dock at is still short of, and how far along it is.',
      },
      {
        event: 'ColonisationContribution',
        label: 'What you delivered',
        reveals: 'The cargo you hand over to a construction site, and which site it was.',
      },
      {
        event: 'ColonisationSystemClaim',
        label: 'Systems you claim',
        /*
         * Said plainly, including the part a member might not want. A claim names a system they
         * have taken and the moment they took it — which is a statement about their plans, not
         * just their cargo, and somebody should be able to weigh that before leaving it on.
         */
        reveals:
          'The name of a system you claim for colonisation, and when you claimed it. Nothing about what you intend to build there.',
      },
    ],
  },
  {
    /*
     * ★ MINING — SQUADRON OWNER, 2026-08-06 ★
     *
     * "our own version of EDminer ... must meet / exceed ED tools as it works currently!"
     *
     * ★ ITS OWN GROUP, AND THE HONEST REASON IS VOLUME ★
     *
     * MiningRefined already sits under Trading, and the tempting thing was to put the rest there
     * too. It would have been wrong. A prospected rock is reported for EVERY limpet — several
     * hundred an hour while somebody is mining, against roughly twenty refined tonnes.
     *
     * A member happy for us to see what they hauled has not thereby agreed to send a row for every
     * rock they shoot at, and burying that inside an existing switch would make the switch mean
     * something other than what it says. So it is its own, and the purpose line below says plainly
     * what it buys them: the ring intelligence is the whole reason to leave it on.
     */
    category: 'mining',
    label: 'Mining',
    purpose:
      'Every rock you prospect, so the app can show what is in it before you shoot — and so the squadron can tell which rings are actually paying this week, which no single-player tool can do.',
    required: false,
    entries: [
      {
        event: 'ProspectedAsteroid',
        label: 'Rocks you prospect',
        reveals:
          'What each asteroid contains and in what proportions, whether it holds a motherlode, and the ring it was in. This is the busiest thing the app sends — one report per limpet.',
      },
      {
        event: 'AsteroidCracked',
        label: 'Cores you crack',
        reveals: 'That you cracked a core, and where. Counts toward the Deep Core board’s achievements.',
      },
      {
        event: 'LaunchDrone',
        label: 'Limpets you launch',
        reveals:
          'Which kind of limpet you launched — so the app can tell you how many prospectors you have left before you run out mid-ring.',
      },
    ],
  },
];

/**
 * Is every allowlisted event described somewhere in the catalogue?
 *
 * ★ A REAL RISK, NOT A TIDINESS CHECK ★
 *
 * An event present in `JOURNAL_EVENTS` but absent here is collected and never
 * shown on the settings page — so a member cannot switch it off, and does not
 * know it exists. Under an opt-out model that is the difference between a
 * disclosure and a secret. There is a test.
 */
export function undescribedEvents(): JournalEventName[] {
  const described = new Set(TELEMETRY_CATALOGUE.flatMap((g) => g.entries.map((e) => e.event)));
  return (Object.keys(JOURNAL_EVENTS) as JournalEventName[]).filter((e) => !described.has(e));
}

/**
 * The consent category an event belongs to, for enforcing an opt-out.
 *
 * Returns the TELEMETRY category, not the internal label. `JOURNAL_EVENTS` maps
 * to labels like 'ranks' and 'squadron' which several of them share a category
 * with — comparing a label against a stored category would silently match
 * nothing and let every opt-out through.
 */
export function categoryOf(event: string): TelemetryCategoryName | null {
  return Object.prototype.hasOwnProperty.call(JOURNAL_EVENTS, event)
    ? telemetryCategoryFor(event as JournalEventName)
    : null;
}
