import type { ForumIdentity } from '../../lib/api';

/**
 * A member's face and name, wherever the forum shows one.
 *
 * ★ ONE COMPONENT, BECAUSE THE FALLBACK IS THE HARD PART ★
 *
 * Roughly half this squadron has no Discord avatar. Every place that renders a member therefore
 * renders the fallback more often than the picture, and a fallback duplicated across a board list,
 * a thread row and a post header is one that drifts into three slightly different circles.
 *
 * Initials rather than a silhouette, matching the roster card: a generic face makes everybody
 * without a picture look like the same stranger, which on a board of 107 people actively hinders
 * recognition.
 */

export function initials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '?';
  // Two letters only when there is a genuine second word — "CMDR" should not become "CM".
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

const SIZES = {
  sm: { px: 24, cls: 'size-6 text-[10px]' },
  md: { px: 40, cls: 'size-10 text-sm' },
  lg: { px: 56, cls: 'size-14 text-lg' },
} as const;

export function Avatar({
  identity,
  size = 'md',
}: {
  readonly identity: ForumIdentity;
  readonly size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];

  if (identity.avatarUrl !== null) {
    return (
      <img
        src={identity.avatarUrl}
        /*
         * Empty alt ON PURPOSE. The name is always rendered next to this in text, so alt text here
         * would make a screen reader announce the same person twice.
         */
        alt=""
        width={s.px}
        height={s.px}
        loading="lazy"
        className={`${s.cls} shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${s.cls} flex shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-orange)] font-semibold text-[var(--color-text-on-accent)]`}
    >
      {initials(identity.displayName)}
    </span>
  );
}

/**
 * How long ago something happened, in words.
 *
 * ★ COARSE ON PURPOSE ★
 *
 * "3 minutes ago" implies a precision the board does not have — `lastPostAt` is whenever the row
 * was written, and a reader scanning for activity wants "today" versus "last month", not a
 * stopwatch. Coarse buckets also mean the string changes rarely, so a server-rendered page does not
 * disagree with the client the moment it hydrates.
 *
 * Anything in the future is clamped to "just now" rather than rendering "in 4 hours". Clock skew
 * between the database and a member's laptop is normal and is not worth showing them.
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(days / 365)}y ago`;
}

/** Thousands separator for counts. 1,204 replies reads; 1204 has to be counted. */
export function count(n: number): string {
  return n.toLocaleString('en-GB');
}
