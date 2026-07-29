/**
 * The Discord nickname a verified member wears: `RANK - COMMANDER`.
 *
 * ★ WHY THIS LIVES IN SHARED ★
 *
 * Three things need the same answer: the website when it verifies somebody, the
 * settings page when it shows them what their nickname will be, and the daily
 * worker sweep when it puts back a nickname somebody changed by hand. Three
 * copies of a truncation rule would drift, and the drift would be a member
 * whose name the site displays one way and the guild another.
 */

/** Discord's hard ceiling on a nickname. */
export const MAX_NICK = 32;

/**
 * Builds the nickname: `RANK - COMMANDER`.
 *
 * ★ WHEN IT DOES NOT FIT, THE RANK GOES — NEVER THE NAME ★
 *
 * Discord allows 32 characters and "Chief Fleet Commander - PEBBLEMERCAHNT" is
 * thirty-eight. Something has to give, and it must not be the commander name:
 * the name is the identity, it is what people are called in game and in voice,
 * and a truncated one is a different person's name.
 *
 * Truncating the RANK instead was considered and rejected — "Chief Fleet Comma"
 * is not a rank, and a nickname that looks corrupted invites somebody to fix it
 * by hand, which the next sync would then overwrite.
 *
 * So the rank is dropped whole, and a long-named Chief Fleet Commander simply
 * appears under their commander name.
 */
export function composeNickname(rank: string | null, cmdrName: string): string {
  const name = cmdrName.trim();
  if (rank === null || rank.trim() === '') return name.slice(0, MAX_NICK);

  const full = `${rank.trim()} - ${name}`;
  return full.length <= MAX_NICK ? full : name.slice(0, MAX_NICK);
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
