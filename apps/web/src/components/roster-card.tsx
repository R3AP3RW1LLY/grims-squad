import { formatLocal } from '../lib/time';
import type { RosterMember } from '../lib/api';

/**
 * One commander on the roster.
 *
 * ★ WHAT IS ON IT, AND WHY EACH THING EARNED ITS PLACE ★
 *
 * A card that shows everything shows nothing — the eye stops reading. Each of
 * these answers a question somebody actually has when scanning a squadron:
 *
 *   avatar + name      who is this
 *   CMDR name          what do I call them in game
 *   squadron roles     where do they sit in the squadron
 *   pilot ranks        what are they good at
 *   ship               what are they flying
 *   timezone           when are they around, which is the whole point of
 *                      scanning a roster before an operation
 *   last played        are they active, without anybody having to ask
 *
 * ★ WHAT IS NOT ON IT ★
 *
 * Credits, position and fleet, unless that member turned them on. Those are
 * governed by their own toggles and stay governed by them — being listed is not
 * consent to be inventoried.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''))
    .toUpperCase();
}

/**
 * "Today", "yesterday", or a date.
 *
 * Relative for the recent past because that is how people think about activity —
 * "three days ago" lands, "25 July" needs arithmetic. Beyond a week it flips to
 * a date, where relative phrasing stops being easier to read than the thing it
 * describes.
 */
function lastSeen(iso: string, timezone: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatLocal(iso, timezone, { withTime: false });
}

export function RosterCard({
  member,
  viewerTimezone,
}: {
  member: RosterMember;
  /** The READER's zone, for dates. Their own zone is shown as a fact about them. */
  viewerTimezone: string;
}) {
  const { commander } = member;

  /*
   * Three at most, highest first. A commander who has ground every ladder would
   * otherwise fill the card with rank names and bury everything else, and the
   * interesting thing about somebody is what they are BEST at.
   *
   * Sorted by INDEX, not by name. Alphabetically "Surveyor" beats "Elite",
   * which is exactly backwards — caught against real data, where a Trade Elite
   * was being listed below an Exploration Surveyor.
   */
  const topRanks = [...commander.ranks].sort((a, b) => b.index - a.index).slice(0, 3);

  return (
    <li className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] transition-colors hover:border-[var(--color-border-active)]">
      <a href={`/members/${encodeURIComponent(member.handle)}`} className="block p-5">
        <div className="flex items-start gap-4">
          {member.avatarUrl !== null ? (
            /* Served from our own API, at the size we asked Discord for. */
            <img
              src={member.avatarUrl}
              alt=""
              width={48}
              height={48}
              className="size-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            /*
              Initials, not a silhouette. A placeholder face makes every member
              without a picture look like the same stranger.
            */
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-orange)] font-semibold text-[var(--color-text-on-accent)]"
            >
              {initials(member.displayName)}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p
              className="truncate text-lg leading-tight text-[var(--color-brand-orange)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {member.displayName}
            </p>
            {member.cmdrName !== null && (
              <p className="mt-0.5 truncate font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]">
                CMDR {member.cmdrName}
              </p>
            )}
            {member.ranks.length > 0 && (
              <p className="mt-1.5 truncate text-xs text-[var(--color-text-secondary)]">
                {member.ranks.join(' · ')}
              </p>
            )}
          </div>
        </div>

        {topRanks.length > 0 && (
          <ul className="mt-4 flex list-none flex-wrap gap-1.5 p-0">
            {topRanks.map((r) => (
              <li
                key={r.key}
                className="rounded border border-[var(--color-border-hairline)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-secondary)]"
                title={`${r.label}: ${r.name}`}
              >
                {r.label} <span className="text-[var(--color-text-primary)]">{r.name}</span>
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-4 space-y-1.5 border-t border-[var(--color-border-hairline)] pt-3 text-xs">
          {commander.currentShip !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-secondary)]">Flying</dt>
              <dd className="truncate text-right text-[var(--color-text-primary)]">
                {commander.currentShip}
              </dd>
            </div>
          )}

          {/*
            Their zone, and what time it is THERE. The offset is the useful part
            — "Europe/London" means nothing to somebody working out whether to
            ping them now.
          */}
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-secondary)]">Timezone</dt>
            <dd className="truncate text-right text-[var(--color-text-primary)]">
              {member.timezone.replace(/_/g, ' ')}
              <span className="ml-2 font-mono text-[var(--color-brand-cyan-bright)]">
                {localClock(member.timezone)}
              </span>
            </dd>
          </div>

          {commander.lastPlayedAt !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-secondary)]">Last flew</dt>
              <dd className="truncate text-right text-[var(--color-text-primary)]">
                {lastSeen(commander.lastPlayedAt, viewerTimezone)}
              </dd>
            </div>
          )}

          {/*
            Only when the member turned it on. `'location' in member` rather than
            a null check: the API OMITS a field that was not consented to, and
            "opted out" and "opted in with nothing recorded" deserve different
            answers.
          */}
          {'location' in member && member.location != null && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-secondary)]">Last seen</dt>
              <dd className="truncate text-right font-mono text-[var(--color-text-primary)]">
                {member.location.system}
              </dd>
            </div>
          )}
        </dl>
      </a>
    </li>
  );
}

/** What time it is where they are. */
function localClock(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
  } catch {
    return '';
  }
}
