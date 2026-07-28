import { formatLocal } from '../lib/time';
import type { RosterMember } from '../lib/api';
import { RoleChip } from './role-chip';

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
 * How long ago, in units that are actually true.
 *
 * ★ THE BUG THIS REPLACES ★
 *
 * It used to compute ELAPSED 24-hour periods and then label them with CALENDAR
 * words: anything under a day became "today". A session fifteen hours ago read
 * as "today" even though it was the previous evening where the member lives —
 * and "today" is a claim about a calendar, not about elapsed time, so the two
 * were never the same statement.
 *
 * Elapsed hours are what we can compute correctly from an instant without
 * knowing anybody's calendar, so that is what it now says. Beyond a couple of
 * days hours stop being meaningful and it moves to days, then to a date.
 */
/**
 * How long a journal must have been quiet before we stop calling it "playing".
 *
 * The companion polls every twenty seconds, so a live session refreshes this
 * constantly. Five minutes covers a slow poll, a brief network drop and a
 * loading screen without leaving somebody marked online for an hour after they
 * quit — which is the failure that makes a presence indicator worthless.
 */
const PLAYING_WINDOW_MS = 5 * 60_000;

export function isPlayingNow(lastPlayingAt: string | null, now: number = Date.now()): boolean {
  if (lastPlayingAt === null) return false;
  const since = now - new Date(lastPlayingAt).getTime();
  return Number.isFinite(since) && since >= 0 && since < PLAYING_WINDOW_MS;
}

function lastSeen(iso: string, timezone: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';

  // A clock skewed slightly ahead should not produce "-1 hours ago".
  if (ms < 0) return 'just now';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.floor(ms / 86_400_000);
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
  const playing = isPlayingNow(member.lastPlayingAt);

  const membership = member.discordRoles.filter((r) => r.category === 'membership');
  const rank = member.discordRoles.filter((r) => r.category === 'rank');
  const awards = member.discordRoles.filter((r) => r.category === 'award');

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

  /*
   * ★ h-full ON BOTH THE <li> AND THE <a>, AND THE SECOND IS THE SUBTLE ONE ★
   *
   * The grid stretches the <li>, so the border already spans the row. But the
   * <a> inside it is what carries the padding and the content, and an anchor
   * that does not fill its parent leaves a short card sitting in the top of a
   * tall cell with dead space beneath it — visibly worse than the ragged rows
   * this was meant to fix.
   *
   * flex-col then lets the footer claim the slack with mt-auto, so the card
   * grows from the middle rather than trailing off.
   */
  return (
    <li className="h-full rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] transition-colors hover:border-[var(--color-border-active)]">
      <a
        href={`/members/${encodeURIComponent(member.handle)}`}
        className="flex h-full flex-col p-5"
      >
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
            {/*
              ★ A PLATFORM TITLE, NOT A SQUADRON RANK ★

              Webmaster grants every permission on the site and confers no
              standing in the squadron whatsoever. It sits here, beside the
              name, precisely so it is not mistaken for one — the squadron rows
              below are about the squadron, and this is about the website.

              The squadron ROLE line that used to sit here moved into those
              labelled rows: it said the same thing twice, and the unlabelled
              version was the one nobody could interpret.
            */}
            {member.siteRoles.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1.5">
                {member.siteRoles.map((r) => (
                  <span
                    key={r.name}
                    className="rounded border border-[var(--color-brand-cyan-bright)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-brand-cyan-bright)]"
                  >
                    {r.name}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>

        {/*
          ★ THREE LABELLED LINES, NOT A PILE OF CHIPS ★

          A wrapped list of eleven roles is a wall — the eye cannot tell which
          one is the rank and which opens a channel. Labelled rows answer the
          three questions somebody actually has about a squadron member:

            Membership   are they one of us, or an ally
            Rank         where do they sit in the ladder
            Awards       what have they earned

          Channel-access roles never arrive here at all; the API filters them,
          so this cannot accidentally start showing them.

          The awards row is OMITTED when empty rather than rendered blank. An
          empty line invites the reader to wonder what is missing, and most
          members have no award yet.
        */}
        <dl className="mt-4 space-y-2 border-t border-[var(--color-border-hairline)] pt-3 text-xs">
          {membership.length > 0 && (
            <RoleRow label="Squadron membership" roles={membership} />
          )}
          {rank.length > 0 && <RoleRow label="Squadron rank" roles={rank} />}
          {awards.length > 0 && <RoleRow label="Squadron awards" roles={awards} />}
        </dl>

        {/*
          The pilot ranks the GAME awards, which answer a different question
          from the rows above: those say where somebody sits in the squadron,
          these say what they are good at.

          Three at most, highest first — a commander who has ground every ladder
          would otherwise bury everything else. Sorted by INDEX, because
          alphabetically "Surveyor" beats "Elite", which is exactly backwards.
        */}
        {topRanks.length > 0 && (
          <ul
            className="mt-3 flex list-none flex-wrap items-center gap-1.5 p-0"
            /*
              ★ SAYING WHICH SOURCE, WITHOUT SPENDING A LINE ON IT ★

              A rank read from somebody's own game and a rank they typed into a
              website are different claims, and rendering them identically
              quietly promotes the second to the standing of the first.

              It lives in the tooltip rather than on the card because it matters
              to whoever asks "is this current?", and to nobody else — a visible
              "via Inara" on every chip would be noise on a card that is already
              dense, and would push the layout around depending on the source.
            */
            title={
              commander.rankSource === 'inara'
                ? `Pilot ranks via Inara${
                    commander.ranksFetchedAt === null
                      ? ''
                      : `, updated ${new Date(commander.ranksFetchedAt).toLocaleString()}`
                  }`
                : 'Pilot ranks from their game journal'
            }
          >
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

        {/*
          mt-auto pins this to the BOTTOM of the card, which is what makes
          uniform heights read as deliberate. Members have different numbers of
          roles and ranks, so without it the "Timezone" and "Last flew" lines
          land at a different height on every card and the eye has to hunt for
          them — the extra space then looks like a rendering fault rather than
          a layout.
        */}
        <dl className="mt-auto space-y-1.5 border-t border-[var(--color-border-hairline)] pt-4 text-xs">
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

          {/*
            "Playing now" outranks "last flew" — they are answers to the same
            question and the live one is strictly better. Shown with a dot as
            well as words: a colour alone is unreadable to anybody who cannot
            distinguish it, and "now" is worth being unambiguous about.
          */}
          {playing ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-secondary)]">Status</dt>
              <dd className="flex items-center gap-2 text-right text-[var(--color-semantic-success)]">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full bg-[var(--color-semantic-success)]"
                />
                Playing now
              </dd>
            </div>
          ) : (
            commander.lastPlayedAt !== null && (
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--color-text-secondary)]">Last flew</dt>
                <dd className="truncate text-right text-[var(--color-text-primary)]">
                  {lastSeen(commander.lastPlayedAt, viewerTimezone)}
                </dd>
              </div>
            )
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

/**
 * What time it is where they are, as `9:15 PM`.
 *
 * ★ COMPOSED FROM PARTS, NOT FORMATTED AND PATCHED ★
 *
 * `hour12: true` under en-GB renders "9:15 pm" — lowercase, and with a
 * non-breaking space that a naive `.toUpperCase()` on the whole string leaves
 * looking wrong. Other locales put the period first or use a different
 * separator entirely.
 *
 * Reading the parts and assembling them means the output is the same shape
 * whatever locale the runtime defaults to, which for a card comparing a dozen
 * members' clocks is the point.
 */
function localClock(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(new Date());

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const hour = get('hour');
    const minute = get('minute');
    const period = get('dayPeriod').toUpperCase();

    if (hour === '' || minute === '') return '';
    return `${hour}:${minute} ${period}`.trim();
  } catch {
    return '';
  }
}

/**
 * One labelled row of roles.
 *
 * The label is what makes a role legible: "Cadet" on its own could be a rank, a
 * division or a joke, and only its position in the list says which.
 */
function RoleRow({
  label,
  roles,
}: {
  label: string;
  roles: ReadonlyArray<{ name: string; colour: string | null }>;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 pt-0.5 text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="flex flex-wrap justify-end gap-1.5">
        {roles.map((r) => (
          <RoleChip key={r.name} name={r.name} colour={r.colour} />
        ))}
      </dd>
    </div>
  );
}
