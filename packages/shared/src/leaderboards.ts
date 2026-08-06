/**
 * The leaderboards, and what a member can earn on them.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "make a new category called leaderboards ... gamify the colonization leaderboard, make badges
 * ect the same way were doing it for databounties ... then we also need to make a leaderboard and
 * gamify it for Trade routes make this work like the other ones too ... default all leaderboard
 * participation on for all commanders" — with the badge model chosen as tiers plus achievements,
 * XP as lifetime points per board.
 *
 * ★ THE CATALOGUE LIVES IN CODE, NOT IN A TABLE ★
 *
 * A badge is a RULE ("10,000 lifetime points on the colony board"), and rules belong where they
 * can be reviewed, tested and shipped atomically with the code that applies them. The database
 * holds only the AWARDS (who earned what, when) — the one part that is genuinely data. A badge
 * table with editable thresholds would let the meaning of an already-awarded badge drift under
 * the members wearing it.
 *
 * ★ ONE POINT SCALE STORY PER BOARD ★
 *
 *   bounties  — the Data Bounty claims ledger, points as already scored (staleness-weighted).
 *   colony    — 1 point per tonne delivered to a tracked project, ×2 to a squadron priority
 *               project, +500 for closing a commodity line (the delivery that finishes it).
 *   trade     — 1 point per 10,000 cr of REALIZED profit: each journal-visible sale matched
 *               against what the member actually paid. Volume without margin scores nothing,
 *               which is the point.
 *
 * The tier thresholds are deliberately identical across boards — "Gold is 25,000 wherever you
 * earned it" is a sentence everybody can hold, where three different ladders are three things to
 * explain. The per-board point RATES were tuned instead, so a committed month lands in the same
 * tier neighbourhood whichever board it was spent on.
 */

import { BADGES as FORUM_BADGES } from './reputation.js';

export type LeaderboardKey = 'bounties' | 'colony' | 'trade' | 'mining' | 'bgs';

export interface LeaderboardDef {
  readonly key: LeaderboardKey;
  readonly name: string;
  /** What the points measure, in a sentence a member reads on the opt-in screen. */
  readonly measures: string;
  readonly pointsNoun: string;
}

export const LEADERBOARDS: readonly LeaderboardDef[] = [
  {
    key: 'bounties',
    name: 'Data Runners',
    measures:
      'Points from Data Bounties: docking at stations whose market data has gone dark, staler pays more, jackpots pay double.',
    pointsNoun: 'pts',
  },
  {
    key: 'colony',
    name: 'Colony Builders',
    measures:
      'Points from hauling to colonisation projects: a point per tonne delivered, doubled for squadron priority builds, with a bonus for the delivery that finishes a commodity.',
    pointsNoun: 'pts',
  },
  {
    key: 'trade',
    name: 'Trade Barons',
    measures:
      'Points from realized trading profit your journal reports: a point per ten thousand credits actually earned, sale matched against what you paid.',
    pointsNoun: 'pts',
  },
  {
    key: 'mining',
    name: 'Deep Core',
    measures:
      'Points from ore your refinery finishes: a point per tonne, multiplied by how hard that tonne was to get — eight for core-only rocks like Void Opals, four for Painite and Platinum, one for gravel.',
    pointsNoun: 'pts',
  },
  {
    /*
     * ★ SQUADRON OWNER, 2026-08-06 ★
     *
     * "create a BGS leaderboard, and allow the officers to choose what factions we want to be
     * running missions for etc, give instructions to the squad members etc."
     *
     * ★ THE ONLY BOARD WHERE THE SCORE DEPENDS ON AN ORDER ★
     *
     * Every other board pays for a deed: a tonne delivered, a credit earned, an ore refined. This
     * one pays for a deed done WHERE THE OFFICERS ASKED. That is deliberate and it is the whole
     * point — it makes the standings a statement of what the squadron is trying to achieve, and it
     * lets officers change what everybody does by editing a list rather than asking twice.
     */
    key: 'bgs',
    name: 'Faction Hands',
    measures:
      'Points from influence you actually moved for a faction the squadron is backing: ten a pip, half that for holding a system steady where the orders say hold, and nothing at all for factions nobody asked you to help.',
    pointsNoun: 'pts',
  },
] as const;

/** Colony scoring constants — referenced by the worker's scorer and printed on the page. */
export const COLONY_PRIORITY_MULTIPLIER = 2;
export const COLONY_LINE_CLOSER_BONUS = 500;
/** Trade scoring: one point per this many credits of realized profit. */
export const TRADE_CREDITS_PER_POINT = 10_000;

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface TierStep {
  /** The internal rung — stable, and the tail of the badge KEY. Never shown to members. */
  readonly tier: BadgeTier;
  /** The rank a member actually holds, themed to its board. */
  readonly name: string;
  /** Lifetime points on that board. */
  readonly at: number;
}

/**
 * ★ PER-BOARD LADDERS, PER-BOARD NAMES — SQUADRON OWNER, 2026-08-04 ★
 *
 * "restructure the points to match the points system on the various things that give points ...
 * give the points gategories better names themed to the leaderboard category please! bronze,
 * silver, gold are very boring! and we cant identify them if someone has the same rank across
 * several leaderboards" — which reverses this file's original identical-ladder design, and the
 * owner is right on both counts: the first live scoring run priced the three boards' points so
 * differently that one member's ordinary trading history cleared the top trade rung the moment
 * the sweep ran, and "Gold" said nothing about WHICH board it was gold on.
 *
 * The thresholds are tuned to what a point costs on each board:
 *   bounties — claims run ~90–3,650 pts; a hard season ≈ 25k. Void Cartographer is seasons of it.
 *   colony   — a point a tonne (×2 priority); one large build ≈ 60k t squadron-wide. Architect
 *              is a serious share of a big build; Worldshaper is several.
 *   trade    — a point per 10,000 cr of realized profit: Magnate is 2.5 billion earned,
 *              Trade Baron — the board's own name, worn by whoever earns it — is 10 billion.
 *
 * The KEYS stay `<board>-<tier>` for ever: awards in member_badges reference keys, and renaming
 * a rank must never strand one.
 */
export const TIER_LADDERS: Record<LeaderboardKey, readonly TierStep[]> = {
  bounties: [
    { tier: 'bronze', name: 'Signal Scout', at: 500 },
    { tier: 'silver', name: 'Wayfinder', at: 5_000 },
    { tier: 'gold', name: 'Beacon Keeper', at: 25_000 },
    { tier: 'platinum', name: 'Void Cartographer', at: 100_000 },
  ],
  colony: [
    { tier: 'bronze', name: 'Bricklayer', at: 1_000 },
    { tier: 'silver', name: 'Foreman', at: 10_000 },
    { tier: 'gold', name: 'Architect', at: 50_000 },
    { tier: 'platinum', name: 'Worldshaper', at: 200_000 },
  ],
  trade: [
    { tier: 'bronze', name: 'Courier', at: 5_000 },
    { tier: 'silver', name: 'Merchant', at: 50_000 },
    { tier: 'gold', name: 'Magnate', at: 250_000 },
    { tier: 'platinum', name: 'Trade Baron', at: 1_000_000 },
  ],
  /*
   * ★ TUNED TO WHAT A POINT COSTS HERE — 2026-08-06 ★
   *
   * A point is a tonne, weighted ×1 to ×8. A solid core session is roughly 40 t of opals ≈ 320
   * pts; a committed week of it is a few thousand. Rock Hopper is a first proper night out; Deep
   * Core — the board's own name, worn by whoever earns it — is years of the stuff, matching how
   * Trade Baron and Void Cartographer sit at the top of theirs.
   */
  mining: [
    { tier: 'bronze', name: 'Rock Hopper', at: 2_000 },
    { tier: 'silver', name: 'Seam Runner', at: 20_000 },
    { tier: 'gold', name: 'Core Breaker', at: 100_000 },
    { tier: 'platinum', name: 'Deep Core', at: 400_000 },
  ],
  /*
   * A pip is worth ten points, and a good evening's missions is a few dozen pips. So the ladder is
   * pitched lower than the hauling boards: influence is slow, deliberate work and a member who
   * turns out every week for a month should reach silver.
   */
  bgs: [
    { tier: 'bronze', name: 'Canvasser', at: 500 },
    { tier: 'silver', name: 'Ward Heeler', at: 4_000 },
    { tier: 'gold', name: 'Kingmaker', at: 20_000 },
    { tier: 'platinum', name: 'Grey Eminence', at: 75_000 },
  ],
} as const;

export interface BadgeDef {
  /** Stable key, stored in member_badges beside the forum badges. Never renamed. */
  readonly key: string;
  readonly board: LeaderboardKey;
  readonly kind: 'tier' | 'achievement';
  readonly name: string;
  readonly description: string;
  /** One emoji — renders identically in the app, the site and Discord. */
  readonly icon: string;
  /** For tier badges: the lifetime-points threshold. Absent on achievements. */
  readonly threshold?: number;
}

const TIER_ICONS: Record<BadgeTier, string> = {
  bronze: '🥉',
  silver: '🥈',
  gold: '🥇',
  platinum: '🏆',
};

function tierBadges(board: LeaderboardKey, boardName: string): BadgeDef[] {
  return TIER_LADDERS[board].map(({ tier, name, at }) => ({
    key: `${board}-${tier}`,
    board,
    kind: 'tier' as const,
    name,
    description: `${name}: ${at.toLocaleString()} lifetime points on the ${boardName} board.`,
    icon: TIER_ICONS[tier],
    threshold: at,
  }));
}

/**
 * Every badge that exists. The awarding sweep walks this list; a badge absent from it can never
 * be newly awarded (already-earned rows keep rendering by key, so retiring one strands nobody).
 */
/*
 * ★ NAMED LEADERBOARD_BADGES, NOT BADGES — LEARNED THE HARD WAY, 2026-08-04 ★
 *
 * The shared index `export *`s reputation.ts, whose forum badge catalogue is already called
 * BADGES. An explicit export of the same name SHADOWS a star export silently — for a few hours
 * the forum sweep's AWARDABLE list was reading THIS catalogue and nothing anywhere said so.
 * Two catalogues, two names, and one resolver below that reads both.
 */
export const LEADERBOARD_BADGES: readonly BadgeDef[] = [
  ...tierBadges('bounties', 'Data Runners'),
  ...tierBadges('colony', 'Colony Builders'),
  ...tierBadges('trade', 'Trade Barons'),
  ...tierBadges('mining', 'Deep Core'),
  ...tierBadges('bgs', 'Faction Hands'),

  // ---- Data Runners achievements ----
  {
    key: 'bounties-first-light',
    board: 'bounties',
    kind: 'achievement',
    name: 'First Light',
    description: 'Banked a first data bounty — somewhere dark is dark no longer.',
    icon: '🔦',
  },
  {
    key: 'bounties-jackpot-hunter',
    board: 'bounties',
    kind: 'achievement',
    name: 'Jackpot Hunter',
    description: 'Claimed ten jackpot bounties — a year dark or never seen, ten times over.',
    icon: '🎰',
  },
  {
    key: 'bounties-cartographer',
    board: 'bounties',
    kind: 'achievement',
    name: 'Cartographer',
    description: 'Claimed a never-seen station: the squadron held nothing at all until you docked.',
    icon: '🗺️',
  },
  {
    key: 'bounties-season-champion',
    board: 'bounties',
    kind: 'achievement',
    name: 'Data Runner Champion',
    description: 'Topped the Data Runners board for a whole season.',
    icon: '👑',
  },

  // ---- Colony Builders achievements ----
  {
    key: 'colony-first-brick',
    board: 'colony',
    kind: 'achievement',
    name: 'First Brick',
    description: 'Made a first delivery to a colonisation project.',
    icon: '🧱',
  },
  {
    key: 'colony-priority-hauler',
    board: 'colony',
    kind: 'achievement',
    name: 'Priority Hauler',
    description: 'Delivered 10,000 tonnes to squadron priority builds.',
    icon: '🚛',
  },
  {
    key: 'colony-line-closer',
    board: 'colony',
    kind: 'achievement',
    name: 'Line Closer',
    description: 'Made the delivery that finished a commodity — the last tonne of something.',
    icon: '✅',
  },
  {
    key: 'colony-season-champion',
    board: 'colony',
    kind: 'achievement',
    name: 'Colony Builder Champion',
    description: 'Topped the Colony Builders board for a whole season.',
    icon: '👑',
  },

  // ---- Trade Barons achievements ----
  {
    key: 'trade-first-profit',
    board: 'trade',
    kind: 'achievement',
    name: 'First Profit',
    description: 'Closed a first profitable trade the journal could vouch for.',
    icon: '📈',
  },
  {
    key: 'trade-millionaire-run',
    board: 'trade',
    kind: 'achievement',
    name: 'Millionaire Run',
    description: 'Cleared a million credits of profit on a single sale.',
    icon: '💰',
  },
  {
    key: 'trade-season-champion',
    board: 'trade',
    kind: 'achievement',
    name: 'Trade Baron Champion',
    description: 'Topped the Trade Barons board for a whole season.',
    icon: '👑',
  },

  // ---- Deep Core achievements ----
  {
    key: 'mining-first-light',
    board: 'mining',
    kind: 'achievement',
    name: 'First Light',
    description: 'Refined a first tonne of a core-only mineral — the kind no laser will ever reach.',
    icon: '💎',
  },
  {
    key: 'mining-motherlode',
    board: 'mining',
    kind: 'achievement',
    name: 'Motherlode',
    description: 'Prospected a rock running over half of one mineral. Most miners never see one.',
    icon: '🥚',
  },
  {
    key: 'mining-grindstone',
    board: 'mining',
    kind: 'achievement',
    name: 'Grindstone',
    description: 'Refined a thousand tonnes inside one calendar month.',
    icon: '⛏️',
  },
  {
    key: 'mining-void-prospector',
    board: 'mining',
    kind: 'achievement',
    name: 'Void Prospector',
    description: 'Refined every core-only mineral at least once — the full set, cracked by hand.',
    icon: '🌌',
  },
  // ---- Faction Hands achievements ----
  {
    key: 'bgs-first-blood',
    board: 'bgs',
    kind: 'achievement',
    name: 'First Blood',
    description: 'Moved influence for a faction the squadron is backing, the first of many.',
    icon: '🗳️',
  },
  {
    key: 'bgs-steady-hand',
    board: 'bgs',
    kind: 'achievement',
    name: 'Steady Hand',
    description: 'Held a system where the orders said hold — the discipline nobody sees.',
    icon: '⚖️',
  },
  {
    key: 'bgs-landslide',
    board: 'bgs',
    kind: 'achievement',
    name: 'Landslide',
    description: 'Twenty pips of influence for one faction inside a single tick.',
    icon: '📈',
  },
  {
    key: 'bgs-season-champion',
    board: 'bgs',
    kind: 'achievement',
    name: 'Faction Hands Champion',
    description: 'Topped the Faction Hands board for a whole season.',
    icon: '👑',
  },
  {
    key: 'mining-season-champion',
    board: 'mining',
    kind: 'achievement',
    name: 'Deep Core Champion',
    description: 'Topped the Deep Core board for a whole season.',
    icon: '👑',
  },
] as const;

const BY_KEY = new Map(LEADERBOARD_BADGES.map((b) => [b.key, b]));

export function badgeByKey(key: string): BadgeDef | null {
  return BY_KEY.get(key) ?? null;
}

/** The tier badges a lifetime score has earned on one board, lowest first. */
export function tiersEarned(board: LeaderboardKey, lifetimePoints: number): BadgeDef[] {
  return LEADERBOARD_BADGES.filter(
    (b) => b.board === board && b.kind === 'tier' && (b.threshold ?? Infinity) <= lifetimePoints,
  );
}

/**
 * The badges worth showing beside a name where space is tight (forum posts): the highest tier
 * per board first, then champions, capped by the caller. Order is deliberate — the rarest
 * things first, so truncation costs the least.
 */
export function showcase(ownedKeys: readonly string[], limit: number): BadgeDef[] {
  const owned = ownedKeys
    .map((k) => BY_KEY.get(k))
    .filter((b): b is BadgeDef => b !== undefined);

  const bestTierPerBoard = new Map<LeaderboardKey, BadgeDef>();
  for (const b of owned) {
    if (b.kind !== 'tier') continue;
    const held = bestTierPerBoard.get(b.board);
    if (held === undefined || (held.threshold ?? 0) < (b.threshold ?? 0)) {
      bestTierPerBoard.set(b.board, b);
    }
  }

  const champions = owned.filter((b) => b.kind === 'achievement' && b.key.endsWith('season-champion'));
  const rest = owned.filter(
    (b) => b.kind === 'achievement' && !b.key.endsWith('season-champion'),
  );

  const ranked = [
    ...[...bestTierPerBoard.values()].sort((a, b) => (b.threshold ?? 0) - (a.threshold ?? 0)),
    ...champions,
    ...rest,
  ];
  return ranked.slice(0, limit);
}

/** What any badge key renders as, whichever catalogue owns it. */
export interface BadgeDisplay {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
}

/**
 * Forum badges predate icons; the leaderboard ones were born with them. One resolver gives every
 * key a face, so the dashboard, the forum chips and the app never each invent their own mapping.
 */
const FORUM_ICONS: Record<string, string> = {
  'first-answer': '💡',
  navigator: '🧭',
  'wing-commander': '🎖️',
  'well-received': '👍',
  'squadron-voice': '📣',
  regular: '📅',
  veteran: '⭐',
};

export function badgeDisplay(key: string): BadgeDisplay | null {
  const lb = BY_KEY.get(key);
  if (lb !== undefined) {
    return { key: lb.key, name: lb.name, description: lb.description, icon: lb.icon };
  }
  const forum = FORUM_BADGES.find((b) => b.key === key);
  if (forum !== undefined) {
    return {
      key: forum.key,
      name: forum.label,
      description: forum.description,
      icon: FORUM_ICONS[forum.key] ?? '🎖️',
    };
  }
  // A retired key from an old award still deserves a face rather than a crash.
  return null;
}
