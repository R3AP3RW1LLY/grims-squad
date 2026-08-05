/**
 * How a notification is drawn: an icon per kind FAMILY, and a compact age.
 *
 * One module for the bell's panel (a client component) and the dashboard's squadron feed (a
 * server component), because two copies of "what does a forum notification look like" is how one
 * surface ends up with a megaphone where the other has a speech bubble.
 */

/*
 * Keyed on the FAMILY — the part before the separator — rather than on the full kind. Kinds are
 * namespaced by producer ('forum.answer-accepted', 'badge.earned', and the forum fan-out's
 * original 'forum_direct_reply' spelling), and new kinds arrive with every feature that starts
 * producing them. A family icon means 'colony.completed' draws sensibly the day it ships without
 * an edit here, and an unknown family falls back to the megaphone so no row ever renders blank.
 */
const FAMILY_ICONS: Readonly<Record<string, string>> = {
  forum: '💬',
  badge: '🏅',
  colony: '🏗️',
  shipyard: '🔧',
  bounty: '📡',
  leaderboard: '🏆',
  rank: '🎖️',
  ops: '🚀',
};

export function kindIcon(kind: string): string {
  const family = kind.split(/[._]/, 1)[0] ?? '';
  return FAMILY_ICONS[family] ?? '📣';
}

/**
 * "4m ago" — compact on purpose.
 *
 * A notification row carries an icon, a title, sometimes a body and an actor, in about 380px of
 * panel. "43 minutes ago" spelled out is the widest thing on the line and the least load-bearing,
 * so the units are single letters up to days and the scale stops caring past a year — a feed this
 * shape is about recency, not archaeology.
 */
export function notificationAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : 'over a year ago';
}
