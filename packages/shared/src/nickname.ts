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
