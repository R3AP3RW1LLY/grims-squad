/**
 * The Discord nickname a verified member wears: their COMMANDER NAME, and nothing else.
 *
 * ★ THE RANK PREFIX WAS REMOVED, 2026-07-31 ★
 *
 * Squadron owner: "right now when we verify members, we are adding the rank prefix to their discord
 * username, we need to stop this and only show their Inara Commander name please."
 *
 * It used to build `RANK - COMMANDER`. The rank is already visible in Discord — it is the role, in
 * colour, in the member list — so putting it in the nickname said the same thing twice and spent
 * most of Discord's 32 characters doing it. What people actually want to see is who somebody is in
 * game.
 *
 * ★ WHY THIS FUNCTION STILL TAKES A RANK ★
 *
 * So that every caller does not have to change, and so the reason is recorded in one place rather
 * than deleted from all of them. The argument is accepted and deliberately ignored — see the note
 * on the parameter.
 *
 * ★ WHY THIS LIVES IN SHARED ★
 *
 * Three things need the same answer: the website when it verifies somebody, the settings page when
 * it previews their nickname, and the daily worker sweep that puts back a nickname somebody changed
 * by hand. Three copies of this rule would drift, and the drift would be a member whose name the
 * site displays one way and the guild another.
 */

/** Discord's hard ceiling on a nickname. */
export const MAX_NICK = 32;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * HUMANIZING A COMMANDER NAME
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "these need to match their verified inara name please. this is non-negotiable! ... their name
 * must match what is on inara exactly, but humanized (first letter capitalized) ... if they have
 * two words seperated by a space, then each first letter of each word must be capitalized. if they
 * have "" in their name, then everything between the quotes must be capitalized letters please like
 * a call sign."
 *
 * The same rule for everybody — allies, Grim's Squad members, the tenure ladder from Cadet to Grand
 * Master General, and officers. Rank changes nothing about the SHAPE of the name; officers differ
 * only in being allowed to override it entirely (see `nicknameOverride`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Characters that open or close a callsign.
 *
 * Straight and both smart doubles, because a name typed on a phone arrives with `“ ”` and a member
 * would have no idea why their callsign was not shouting.
 *
 * The APOSTROPHE is deliberately not here. It is a word break (`o'brien` → `O'Brien`), and treating
 * it as a quote would turn the rest of that name into a callsign.
 */
const CALLSIGN_QUOTES = new Set(['"', '\u201C', '\u201D']);

/**
 * Characters after which the next letter starts a new word.
 *
 * Owner's answer when asked, with worked examples: `jean-luc picard` → `Jean-Luc Picard`, and
 * `o'brien` → `O'Brien`. So hyphens and apostrophes break words exactly as spaces do.
 */
const WORD_BREAKS = new Set([' ', '-', "'", '\u2019']);

/**
 * A commander name, as the squadron wears it.
 *
 * ★ LOWERCASED FIRST, AND THAT IS A DELIBERATE TRADE ★
 *
 * Everything outside a callsign is lowercased before the word starts are raised. That is what makes
 * `GRIMREAPER` come back as `Grimreaper` rather than staying at a shout, which is the whole point
 * of "humanized".
 *
 * It costs deliberate inner capitals: `McDonald` becomes `Mcdonald`. The owner was shown that
 * exact trade and chose this. A member who needs the other spelling is what the override is for.
 *
 * ★ UNBALANCED QUOTES ARE IGNORED, NOT GUESSED AT ★
 *
 * `sean "grim` has one quote. Treating it as an opening one would uppercase everything after it —
 * a typo turning into A SHOUTING HALF NAME. With an odd number of quotes the callsign rule is
 * dropped entirely and the name is simply title-cased, which is wrong in the small way rather than
 * the loud way.
 */
export function humanizeCommanderName(raw: string): string {
  // Collapse runs of whitespace first, so `grim   reaper` does not produce empty words.
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') return '';

  const quotes = [...name].filter((c) => CALLSIGN_QUOTES.has(c)).length;
  const callsignsBalanced = quotes > 0 && quotes % 2 === 0;

  let out = '';
  let inCallsign = false;
  let startOfWord = true;

  for (const ch of name) {
    if (callsignsBalanced && CALLSIGN_QUOTES.has(ch)) {
      inCallsign = !inCallsign;
      // Normalised to a straight quote. A name that renders with `“` here and `"` on the site
      // would look like two different names to the member reading both.
      out += '"';
      startOfWord = true;
      continue;
    }

    if (inCallsign) {
      // The callsign itself: every letter, not just the first.
      out += ch.toUpperCase();
      continue;
    }

    out += startOfWord ? ch.toUpperCase() : ch.toLowerCase();
    startOfWord = WORD_BREAKS.has(ch);
  }

  return out;
}

/**
 * Builds the nickname: just the commander name.
 *
 * `rank` is accepted and ignored. Kept in the signature because the rank is still resolved for the
 * settings preview and the roster, and because a parameter that is visibly unused — with this note
 * attached — is a clearer record of a deliberate decision than a silently deleted one.
 *
 * Still truncated to Discord's limit. A commander name longer than 32 characters is not something
 * this function can solve, and a rejected API call would leave the member with no nickname at all.
 */
export function composeNickname(_rank: string | null, cmdrName: string): string {
  /*
   * ★ HUMANIZED HERE, SO EVERY CALLER GETS IT ★
   *
   * Three things need the same answer — the website when it verifies somebody, the settings page
   * when it previews their nickname, and the nightly worker sweep. Putting the rule anywhere else
   * would mean a member whose name the site shows one way and the guild another, which is the
   * exact failure this function was moved to `shared` to prevent.
   *
   * Truncation comes AFTER humanizing. Doing it first would title-case a name that had already
   * lost its last word, and the result would differ from what the preview promised.
   */
  return humanizeCommanderName(cmdrName).slice(0, MAX_NICK);
}

/**
 * The rank that goes in front of the name, from the roles a member WEARS.
 *
 * ★ APPOINTMENT FIRST, AND THE TWO LADDERS RUN OPPOSITE WAYS ★
 *
 * A leadership appointment outranks any tenure rank for display: somebody is
 * introduced as the Prime Legate, not as a Grand Master General who also holds
 * an office.
 *
 * Within appointments the LOWEST rankOrder is the most senior — Galactic
 * Admiral is 10, Squadron Leader 60 — which is the reverse of the tenure
 * ladder, where Cadet is 100 and Grand Master General 190. Every officer also
 * holds Squadron Leader as a base, so reading both the same way round titles
 * the Galactic Admiral "Squadron Leader". That bug shipped once.
 */
export function rankForDisplay(
  held: ReadonlyArray<{ name: string; rankOrder: number }>,
  leadershipCeiling: number,
): string | null {
  const appointments = held.filter((r) => r.rankOrder < leadershipCeiling);
  if (appointments.length > 0) {
    return appointments.reduce((a, b) => (b.rankOrder < a.rankOrder ? b : a)).name;
  }

  const tenure = held.filter((r) => r.rankOrder >= leadershipCeiling);
  if (tenure.length === 0) return null;
  return tenure.reduce((a, b) => (b.rankOrder > a.rankOrder ? b : a)).name;
}

/**
 * Below this is a LEADERSHIP APPOINTMENT; at or above it is a TENURE RANK.
 *
 * The roles below 100 describe themselves as "Reserved" and "Leadership. Admin
 * area access". The roles from 100 up are earned by qualifying months: Cadet at
 * one, Grand Master General at twelve.
 */
export const LEADERSHIP_CEILING = 100;

/** One role a member wears, reduced to what rank resolution needs. */
export interface HeldRole {
  readonly name: string;
  /** Ladder position, or null for a role that maps to none. */
  readonly rankOrder: number | null;
  /** What the role MEANS to us. `membership` is the fallback tier. */
  readonly category: 'rank' | 'membership' | 'award' | 'hidden' | 'other';
}

/**
 * The rank to show for a member, from the roles they WEAR in Discord.
 *
 * ★ THE ORDER IS THE SQUADRON OWNER'S, AND EACH STEP EARNS ITS PLACE ★
 *
 *   1. A LEADERSHIP APPOINTMENT. Somebody is introduced as the Prime Legate,
 *      not as a Grand Master General who also holds an office. Lowest rankOrder
 *      wins here, because appointments descend — Galactic Admiral is 10 and
 *      Squadron Leader 60, and every officer also holds Squadron Leader as a
 *      base. Reading them the same way round as tenure titles the Galactic
 *      Admiral "Squadron Leader"; that bug shipped once.
 *
 *   2. A TENURE RANK. Highest wins, because tenure ascends — Cadet 100 up to
 *      Grand Master General 190.
 *
 *   3. MEMBERSHIP. "Grim's Squad members" or "Allies". Not a rank, but it is
 *      what somebody IS when they hold no rank role, and showing "Unranked" to
 *      a full member of the squadron is both wrong and unwelcoming.
 *
 *   4. Only then null, which the UI renders as Unranked.
 *
 * ★ WHY THIS READS WORN ROLES AND NOT GRANTS ★
 *
 * Granted internal roles only appear after reconciliation, for an account that
 * exists. Most of the squadron has neither, so a resolver reading grants
 * returns null for almost everybody — which is exactly what "Unranked" on a
 * plain Cadet's dashboard was.
 */
export function resolveMemberRank(held: readonly HeldRole[], leadershipCeiling: number): string | null {
  const mapped = held.flatMap((r) => (r.rankOrder === null ? [] : [{ ...r, rankOrder: r.rankOrder }]));

  const appointments = mapped.filter((r) => r.rankOrder < leadershipCeiling);
  if (appointments.length > 0) {
    return appointments.reduce((a, b) => (b.rankOrder < a.rankOrder ? b : a)).name;
  }

  const tenure = mapped.filter((r) => r.rankOrder >= leadershipCeiling);
  if (tenure.length > 0) {
    return tenure.reduce((a, b) => (b.rankOrder > a.rankOrder ? b : a)).name;
  }

  /*
   * The membership fallback. Deliberately by CATEGORY rather than by name: the
   * roles are classified in the database, so renaming "Allies" does not need a
   * code change and a squadron that adds a third membership tier gets it for
   * free.
   */
  const membership = held.filter((r) => r.category === 'membership');
  return membership[0]?.name ?? null;
}
