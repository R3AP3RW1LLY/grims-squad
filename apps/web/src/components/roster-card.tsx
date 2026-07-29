import { Fragment } from 'react';
import { formatLocal } from '../lib/time';
import type { RosterMember } from '../lib/api';
import { RoleChip } from './role-chip';
import { SessionTimer } from './session-timer';

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
 * ★ THE REDESIGN, 2026-07-29 ★
 *
 * Same facts, laid out so they can be read. Three things were making it look
 * dishevelled, and none of them was the amount of information:
 *
 *   1. THE SAME FACTS RENDERED THREE TIMES. A verified member wears the Discord
 *      nickname `RANK - COMMANDER`, so the card showed "Cadet - PEBBLEMERCAHNT",
 *      then "CMDR PEBBLEMERCAHNT" directly beneath it, then "Cadet" again as a
 *      role chip. Two facts, three lines. See `nicknameNote`.
 *
 *   2. EVERY BLOCK ALIGNED DIFFERENTLY. Labels ran left, values and chips were
 *      pushed right by `justify-between`, and the pilot ranks wrapped centre —
 *      so nothing shared an edge and the interior gutter was ragged. Both label
 *      blocks now use ONE grid with a shared label column, so the values line up
 *      as a column down the card.
 *
 *   3. SIX CHIPS OF SIX DIFFERENT WIDTHS. "COMBAT Harmless" beside "EXOBIOLOGY
 *      Directionless" wrapped into a shape that changed on every card, which is
 *      what stopped the grid reading as a grid. They are a fixed 3x2 matrix now,
 *      so a reader can scan DOWN a column of cards and compare the same ladder
 *      in the same place.
 *
 * Nothing was removed.
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
 * The Discord nickname, but only when it says something the card does not
 * already say.
 *
 * ★ THE PROBLEM THIS SOLVES ★
 *
 * A verified member's nickname is composed as `RANK - COMMANDER`. Both halves
 * are already on the card — the commander name is the heading, the rank is a
 * chip in the squadron block — so printing the nickname too restated two facts
 * in a third place and made every card a line taller for nothing.
 *
 * ★ WHY IT IS CONSERVATIVE ★
 *
 * It only suppresses a prefix it can RECOGNISE as a role the member actually
 * holds. Somebody whose nickname is "Grimreaper - PEBBLEMERCAHNT" keeps it:
 * "Grimreaper" is a name they chose and is not ours to hide. Suppressing any
 * ` - ` prefix would have quietly eaten it.
 */
export function nicknameNote(
  displayName: string,
  cmdrName: string | null,
  heldRoleNames: readonly string[],
): string | null {
  const nick = displayName.trim();

  // With no verified commander name the nickname IS the heading, so there is
  // nothing to add underneath it.
  if (nick === '' || cmdrName === null) return null;

  const cmdr = cmdrName.trim().toLowerCase();
  if (nick.toLowerCase() === cmdr) return null;

  // `lastIndexOf`, not `indexOf`: a rank may itself contain the separator far
  // less often than a commander name contains a hyphen, and the commander name
  // is the part that must survive intact.
  const sep = nick.lastIndexOf(' - ');
  if (sep > 0) {
    const prefix = nick.slice(0, sep).trim().toLowerCase();
    const rest = nick.slice(sep + 3).trim().toLowerCase();
    if (rest === cmdr && heldRoleNames.some((n) => n.trim().toLowerCase() === prefix)) {
      return null;
    }
  }

  return nick;
}

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
   * ★ ALL SIX LADDERS, ALWAYS, IN A FIXED ORDER ★
   *
   * This used to show the best three. That made two very different commanders
   * look identical — one who has never flown a combat ship, and one whose data
   * we simply do not have — and it made cards incomparable, because a member
   * with three ladders and a member with six produced lists of different
   * lengths in different orders.
   *
   * Fixed position is what lets somebody scan down a column of cards and see
   * who the better trader is. A ladder with no reading says so, and stays
   * clearly distinct from "Harmless", which is a rank a new pilot really holds.
   */
  const ranks = commander.ranks;

  const heading = member.cmdrName ?? member.displayName;
  const nickname = nicknameNote(
    member.displayName,
    member.cmdrName,
    member.discordRoles.map((r) => r.name),
  );

  /*
   * ★ h-full ON BOTH THE <li> AND THE <a>, AND THE SECOND IS THE SUBTLE ONE ★
   *
   * The grid stretches the <li>, so the border already spans the row. But the
   * <a> inside it is what carries the content, and an anchor that does not fill
   * its parent leaves a short card sitting in the top of a tall cell with dead
   * space beneath it — visibly worse than the ragged rows this was meant to fix.
   *
   * flex-col then lets the footer claim the slack with mt-auto, so the card
   * grows from the middle rather than trailing off.
   *
   * `overflow-hidden` is what lets the footer carry its own background right to
   * the rounded corners without a square edge poking out of them.
   */
  return (
    <li className="h-full">
      <a
        href={`/members/${encodeURIComponent(member.handle)}`}
        className="flex h-full flex-col overflow-hidden rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] transition-colors hover:border-[var(--color-border-active)]"
      >
        {/* ── who ─────────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3.5 px-5 pt-5">
          <span className="relative shrink-0">
            {member.avatarUrl !== null ? (
              /* Served from our own API, at the size we asked Discord for. */
              <img
                src={member.avatarUrl}
                alt=""
                width={52}
                height={52}
                className="size-13 rounded-full object-cover"
              />
            ) : (
              /*
                Initials, not a silhouette. A placeholder face makes every member
                without a picture look like the same stranger.
              */
              <span
                aria-hidden="true"
                className="flex size-13 items-center justify-center rounded-full bg-[var(--color-brand-orange)] text-lg font-semibold text-[var(--color-text-on-accent)]"
              >
                {initials(member.displayName)}
              </span>
            )}

            {/*
              A live marker on the face, so presence is caught while scanning
              rather than read at the bottom of the card.

              DECORATIVE ONLY, and deliberately so: the authoritative statement
              is the "Status — Playing now" row in the footer, which is a word
              and reaches a screen reader. A dot that was the only signal would
              be invisible to anybody who cannot distinguish it.

              The ring is drawn in the card's own background colour so it reads
              as a gap punched around the dot rather than as a second border.
            */}
            {playing && (
              <span
                aria-hidden="true"
                className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-[var(--color-semantic-success)] ring-2 ring-[var(--color-surface-panel)]"
              />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[19px] leading-tight text-[var(--color-brand-orange)]"
              style={{ fontFamily: 'var(--font-display)' }}
              title={heading}
            >
              {heading}
            </p>

            {/*
              ★ ONE TITLE LINE: WHAT THEY ARE, THEN WHAT THEY DO HERE ★

              "Commander" is a claim about the GAME — a proven commander name.
              "Webmaster" is a claim about this WEBSITE: it grants every
              permission on the platform and confers no standing in the squadron
              whatsoever. Different kinds of fact, so they are told apart by
              colour rather than by being stacked into two lines that look like a
              hierarchy — cyan for the game, orange for the site.

              The CMDR label appears only when the heading IS a commander name.
              Falling back to a Discord nickname and labelling it "Commander"
              would assert a verification that has not happened.
            */}
            {(member.cmdrName !== null || member.siteRoles.length > 0) && (
              /*
                ★ ONE LINE, NEVER WRAPPED ★

                This was `flex-wrap`, and with the verification badge competing
                for the same row it duly wrapped — "COMMANDER" on one line and
                "| WEBMASTER" on the next, which reads as two facts rather than
                one title. No wrapping now: the titles are short, and a long
                site role truncates rather than folding the line in half.
              */
              <p className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em]">
                {member.cmdrName !== null && (
                  <span className="shrink-0 text-[var(--color-brand-cyan-bright)]">Commander</span>
                )}
                {member.siteRoles.map((r, i) => (
                  <Fragment key={r.name}>
                    {/*
                      The divider belongs to the item that FOLLOWS it, and is
                      skipped for the first when there is no commander label in
                      front of it — otherwise the line opens with a stray bar.
                    */}
                    {(member.cmdrName !== null || i > 0) && (
                      <span aria-hidden="true" className="shrink-0 text-[var(--color-border-active)]">
                        |
                      </span>
                    )}
                    <span className="truncate text-[var(--color-brand-orange)]">{r.name}</span>
                  </Fragment>
                ))}
              </p>
            )}

            {nickname !== null && (
              <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]" title={nickname}>
                {nickname} on Discord
              </p>
            )}
          </div>
        </div>

        {/* ── where they sit in the squadron ──────────────────────────────── */}
        {/*
          ★ ONE GRID, SO THE VALUES SHARE AN EDGE ★

          These were `justify-between` rows: label hard left, chips hard right,
          and a gutter of whatever was left over in between. With chips of
          different widths on every card the right-hand edge was ragged and the
          left-hand one was too, which is most of what read as untidy.

          A fixed label column puts every value on the same line down the whole
          card — and the same column the footer below uses, so the two blocks
          line up with each other as well.

          Labels are short on purpose. "Squadron membership" forced a label
          column wide enough to squeeze the chips it was labelling; the section
          is already headed "Squadron", so the word was doing nothing twice.
        */}
        <div className="mt-4 px-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--color-text-dim)]">
            Squadron
          </p>
          <dl className="mt-2 grid grid-cols-[4.5rem_1fr] items-start gap-x-3 gap-y-2 text-xs">
            {membership.length > 0 && <RoleRow label="Member" roles={membership} />}
            {rank.length > 0 && <RoleRow label="Rank" roles={rank} />}
            {/*
              Omitted when empty rather than rendered blank. An empty line
              invites the reader to wonder what is missing, and most members
              have no award yet.
            */}
            {awards.length > 0 && <RoleRow label="Awards" roles={awards} />}

            {/*
              ★ WHY IT SITS HERE AND NOT BESIDE THE NAME ★

              It was in the header, top-right, and it took the width the
              commander name needed: "PEBBLEMERCAH…" truncated on a card with
              room to spare, and the title line beneath it wrapped "COMMANDER"
              and "| WEBMASTER" onto separate rows.

              This is where it belonged anyway. It is a SQUADRON fact — Inara
              confirming both the commander name and that they fly with us —
              so it reads as the fourth line of the squadron block, on the same
              label column as the three above it, and the name gets the whole
              width of the card back.
            */}
            <dt className="pt-0.5 text-[var(--color-text-secondary)]">Inara</dt>
            <dd className="flex min-w-0 flex-wrap gap-1.5">
              <VerificationBadge verified={member.squadronVerified} />
            </dd>
          </dl>
        </div>

        {/* ── what they are good at ───────────────────────────────────────── */}
        {/*
          The pilot ranks the GAME awards, which answer a different question
          from the rows above: those say where somebody sits in the squadron,
          these say what they are good at.

          ★ A MATRIX, NOT A WRAPPED LIST ★

          As chips these were six boxes of six different widths — "CQC Helpless"
          next to "EXOBIOLOGY Directionless" — so they wrapped into a different
          shape on every card. Three fixed columns put each ladder in the same
          position on every card, which is the whole reason for showing all six:
          you can scan a column and compare traders.
        */}
        <div className="mt-4 px-5">
          <p
            className="font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--color-text-dim)]"
            /*
              ★ SAYING WHICH SOURCE, WITHOUT SPENDING A LINE ON IT ★

              A rank read from somebody's own game and a rank they typed into a
              website are different claims, and rendering them identically
              quietly promotes the second to the standing of the first.

              It lives in the tooltip rather than on the card because it matters
              to whoever asks "is this current?", and to nobody else.
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
            Pilot ranks
          </p>

          {/*
            `pb-5` is not decoration. Without it the bottom row of rank values
            sits directly on the footer's border — the text and the rule touch,
            which reads as a rendering fault rather than as a divider. `mt-auto`
            on the footer only adds space when the card is SHORTER than its
            row; on the tallest card in a row there is no slack, which is
            exactly when the two collide.
          */}
          <ul className="mt-2 grid list-none grid-cols-3 gap-x-3 gap-y-2.5 p-0 pb-5">
            {ranks.map((r) => (
              <li key={r.key} className="min-w-0">
                <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-dim)]">
                  {r.label}
                </p>
                <p
                  className={`truncate text-[13px] leading-tight ${
                    r.name === null
                      ? /*
                          Dimmed, not omitted. "None" at full strength would read
                          as an achievement called None; removing the line would
                          make an unflown ladder indistinguishable from a missing
                          reading.
                        */
                        'text-[var(--color-text-dim)]'
                      : isElite(r.name)
                        ? /*
                            Elite is the top of a ladder and years of play. On a
                            roster it is the single thing people look for, and in
                            a uniform grid it was invisible.
                          */
                          'text-[var(--color-brand-cyan-bright)]'
                        : 'text-[var(--color-text-primary)]'
                  }`}
                  title={r.name === null ? `${r.label}: not reported` : `${r.label}: ${r.name}`}
                >
                  {r.name ?? 'None'}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* ── are they around ─────────────────────────────────────────────── */}
        {/*
          mt-auto pins this to the BOTTOM of the card, which is what makes
          uniform heights read as deliberate. Members have different numbers of
          roles, so without it these lines land at a different height on every
          card and the eye has to hunt for them — the extra space then looks like
          a rendering fault rather than a layout.

          It carries its own slightly sunken background: the block answers a
          different kind of question from everything above it, and a change of
          surface separates them without spending another hairline rule. The card
          had three stacked rules before, which is what made it look assembled
          out of parts.
        */}
        <dl className="mt-auto grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3 gap-y-1.5 border-t border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-5 py-4 text-xs">
          {commander.currentShip !== null && (
            <>
              <dt className="text-[var(--color-text-secondary)]">Flying</dt>
              <dd className="min-w-0 truncate text-[var(--color-text-primary)]">
                {commander.currentShip}
              </dd>
            </>
          )}

          {/*
            Their zone, and what time it is THERE. The offset is the useful part
            — "Europe/London" means nothing to somebody working out whether to
            ping them now.
          */}
          <dt className="text-[var(--color-text-secondary)]">Timezone</dt>
          <dd className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[var(--color-text-primary)]">
              {member.timezone.replace(/_/g, ' ')}
            </span>
            <span className="shrink-0 font-mono text-[var(--color-brand-cyan-bright)]">
              {localClock(member.timezone)}
            </span>
          </dd>

          {/*
            "Playing now" outranks "last flew" — they are answers to the same
            question and the live one is strictly better. Shown with a dot as
            well as words: a colour alone is unreadable to anybody who cannot
            distinguish it, and "now" is worth being unambiguous about.
          */}
          {playing ? (
            <>
              <dt className="text-[var(--color-text-secondary)]">Status</dt>
              <dd className="flex min-w-0 items-center gap-2 text-[var(--color-semantic-success)]">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full bg-[var(--color-semantic-success)]"
                />
                <span className="shrink-0">Playing now</span>
                {/*
                  Counting up from the LoadGame that started this session, in the
                  browser. "Playing now" answers whether; this answers how long,
                  which is what somebody deciding whether to ping them for a wing
                  actually wants — five minutes in is a different answer from
                  four hours in.

                  Rendered only while they ARE playing: the same number beside
                  "last flew" would be the age of a finished session, which is a
                  different fact wearing the same clothes.
                */}
                {commander.lastPlayedAt !== null && (
                  <SessionTimer startedAt={commander.lastPlayedAt} />
                )}
              </dd>
            </>
          ) : (
            commander.lastPlayedAt !== null && (
              <>
                <dt className="text-[var(--color-text-secondary)]">Last flew</dt>
                <dd className="min-w-0 truncate text-[var(--color-text-primary)]">
                  {lastSeen(commander.lastPlayedAt, viewerTimezone)}
                </dd>
              </>
            )
          )}

          {/*
            Only when the member turned it on. `'location' in member` rather than
            a null check: the API OMITS a field that was not consented to, and
            "opted out" and "opted in with nothing recorded" deserve different
            answers.
          */}
          {'location' in member && member.location != null && (
            <>
              <dt className="text-[var(--color-text-secondary)]">Last seen</dt>
              <dd className="min-w-0 truncate font-mono text-[var(--color-text-primary)]">
                {member.location.system}
              </dd>
            </>
          )}
        </dl>
      </a>
    </li>
  );
}

/**
 * Whether Inara confirms this commander AND their squadron.
 *
 * ★ A GLYPH AS WELL AS A COLOUR ★
 *
 * Green-versus-grey is nothing to a reader who cannot distinguish them, and
 * this is the one claim on the card that other members will act on. The tick
 * and the ring carry the same meaning as the colour, and the words carry it to
 * a screen reader.
 *
 * The title says WHAT was checked. "Not verified" without it invites the reader
 * to assume the worst about a member who simply has not linked a key yet.
 */
function VerificationBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
        verified
          ? 'border-[var(--color-semantic-success)] text-[var(--color-semantic-success)]'
          : 'border-[var(--color-border-hairline)] text-[var(--color-text-dim)]'
      }`}
      title={
        verified
          ? 'Inara confirms this commander name and that they fly with the squadron.'
          : 'Inara has not yet confirmed both the commander name and squadron membership.'
      }
    >
      <span aria-hidden="true">{verified ? '✓' : '○'}</span>
      {verified ? 'Inara verified' : 'Not verified'}
    </span>
  );
}

/**
 * The top of a ladder.
 *
 * Matched on the PREFIX because Frontier extended the top rank into "Elite I"
 * through "Elite V"; an equality check would have highlighted the original
 * Elite and quietly ignored everybody who had gone further.
 */
function isElite(name: string): boolean {
  return /^elite\b/i.test(name.trim());
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
 *
 * A fragment, not a wrapper: the parent is the grid, and a <div> around each
 * pair would make the row a single cell and lose the shared label column that
 * the alignment depends on.
 */
function RoleRow({
  label,
  roles,
}: {
  label: string;
  roles: ReadonlyArray<{ name: string; colour: string | null }>;
}) {
  return (
    <>
      <dt className="pt-0.5 text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="flex min-w-0 flex-wrap gap-1.5">
        {roles.map((r) => (
          <RoleChip key={r.name} name={r.name} colour={r.colour} />
        ))}
      </dd>
    </>
  );
}
