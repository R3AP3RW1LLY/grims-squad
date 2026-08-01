'use client';

import { useMemo, useState } from 'react';
import type { AdminActivityRow } from '../../../lib/api';
import { lastSeen } from './activity-freshness';
import { squadronTenure } from './member-tenure';
import {
  EMPTY_FILTER,
  isFiltering,
  matchesFilter,
  rankLabel,
  distinct,
  type ActivityFilter,
} from './activity-filters';

/**
 * The activity roster, with every column filterable.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "we need to make these pages columns filterable please!" and "add a member for column that shows
 * how long a member has been in the Grim's Squad Discord server".
 *
 * ★ WHY THIS IS A CLIENT COMPONENT AND THE PAGE IS NOT ★
 *
 * Filtering a hundred and seventeen rows that are already on the page is instant in the browser and
 * a round trip on the server. Doing it in the URL would mean a navigation per keystroke on the name
 * box — visibly worse for the one filter most likely to be typed into.
 *
 * The trade is that the rows must be handed down as a prop. They already are: the page fetches them
 * for the table it used to render itself.
 *
 * ★ `now` COMES FROM THE SERVER ★
 *
 * Two columns are relative to the present — Last seen, and In squadron. A client component is still
 * rendered on the server first, so calling `Date.now()` during render would produce one answer in
 * the HTML and a different one at hydration, and React would replace the text and log a mismatch.
 * Taking the instant as a prop makes both renders agree. It goes stale until the next load, which
 * for "3 months" and "2 days" is not a number anybody is watching tick.
 */

/** Applies the row-level styling every filter control shares. */
const CONTROL =
  'w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] ' +
  'px-2 py-1 font-mono text-[11px] text-[var(--color-text-primary)] ' +
  'focus:border-[var(--color-brand-cyan)] focus:outline-none';

function Num({ n, dim = false }: { n: number; dim?: boolean }) {
  return (
    <span
      className={`font-mono ${n === 0 || dim ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'}`}
    >
      {n.toLocaleString('en-GB')}
    </span>
  );
}

/** How a commander name was proven. The tier is the point, not the tick. */
const VERIFY_LABEL: Record<string, string> = {
  inara_nonce: 'Inara',
  fdev_capi: 'Frontier',
  officer_manual: 'By officer',
};

const GAME_LABEL: Record<string, string> = {
  observed: 'Seen',
  // Shown distinctly from "Seen" on purpose. `assumed` means the upstream check FAILED and we
  // counted the month anyway (D26, fail open). An assumption must never be presented to an officer
  // as an observation.
  assumed: 'Assumed',
  absent: 'None',
  unlinked: 'No CMDR',
  unknown: 'Not checked',
};

/** A dropdown filter under a column heading. */
function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <select
      aria-label={`Filter by ${label}`}
      className={CONTROL}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {/* "Any" rather than a blank. A blank first option reads as a missing value. */}
      <option value="">Any</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A "minimum" filter on one of the counters. */
function Min({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      aria-label={`Minimum ${label}`}
      placeholder="min"
      className={CONTROL}
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        /*
         * An empty box is NO FILTER, not zero. Typing 0 and deleting it has to restore every row —
         * otherwise a filter stays applied with nothing on screen to show for it, which reads as
         * missing data rather than as a filter nobody cleared.
         */
        const raw = e.target.value.trim();
        if (raw === '') return onChange(null);
        const n = Number(raw);
        onChange(Number.isFinite(n) && n >= 0 ? Math.floor(n) : null);
      }}
    />
  );
}

export function ActivityTable({
  rows,
  now,
}: {
  rows: AdminActivityRow[];
  /** The instant the server rendered at. See the note on hydration above. */
  now: number;
}) {
  const [filter, setFilter] = useState<ActivityFilter>(EMPTY_FILTER);
  const set = <K extends keyof ActivityFilter>(key: K, value: ActivityFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  // Dropdown contents come from the rows, so a rank added in Discord next month appears here on its
  // own and a rank nobody holds never clutters the list.
  const ranks = useMemo(() => distinct(rows, rankLabel), [rows]);
  const games = useMemo(() => distinct(rows, (r) => r.gameActivity), [rows]);

  const shown = useMemo(() => rows.filter((r) => matchesFilter(r, filter, now)), [rows, filter, now]);
  const filtering = isFiltering(filter);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
        <span>
          {filtering ? (
            <>
              Showing <span className="text-[var(--color-brand-cyan-bright)]">{shown.length}</span> of{' '}
              {rows.length}
            </>
          ) : (
            <>{rows.length} members</>
          )}
        </span>
        {/*
          Only offered when something is actually filtered. A permanently visible Clear invites the
          question "is anything filtered right now?", which is the question the count already
          answers.
        */}
        {filtering && (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="rounded border border-[var(--color-border-hairline)] px-2 py-1 uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] hover:border-[var(--color-brand-cyan)]"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-hairline)] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
              <th scope="col" className="py-3 pr-4">Member</th>
              <th scope="col" className="py-3 pr-4">In squadron</th>
              <th scope="col" className="py-3 pr-4">Hub</th>
              <th scope="col" className="py-3 pr-4">CMDR verified</th>
              <th scope="col" className="py-3 pr-4">Rank</th>
              <th scope="col" className="py-3 pr-4">Working toward</th>
              <th scope="col" className="py-3 pr-4">Messages</th>
              <th scope="col" className="py-3 pr-4">Forum</th>
              <th scope="col" className="py-3 pr-4">Voice</th>
              <th scope="col" className="py-3 pr-4">Elite</th>
              <th scope="col" className="py-3 pr-4">Last seen</th>
              <th scope="col" className="py-3">Qualifies</th>
            </tr>

            {/*
              ★ THE FILTERS SIT UNDER THEIR OWN COLUMNS ★

              Not in a toolbar above the table. A toolbar makes the reader match a control to a
              column by its name; a control in the column needs no matching at all, and there is
              never a question about which column a filter applies to.
            */}
            <tr className="border-b border-[var(--color-border-hairline)] align-top">
              <td className="py-2 pr-4">
                <input
                  type="search"
                  aria-label="Filter by member name"
                  placeholder="name, CMDR, id…"
                  className={CONTROL}
                  value={filter.member}
                  onChange={(e) => set('member', e.target.value)}
                />
              </td>
              <td className="py-2 pr-4">
                <Pick
                  label="time in squadron"
                  value={filter.tenure}
                  onChange={(v) => set('tenure', v as ActivityFilter['tenure'])}
                  options={[
                    { value: 'under1m', label: 'Under a month' },
                    { value: '1to6m', label: '1–6 months' },
                    { value: '6to12m', label: '6–12 months' },
                    { value: 'over1y', label: 'Over a year' },
                    { value: 'unknown', label: 'Unknown' },
                  ]}
                />
              </td>
              <td className="py-2 pr-4">
                <Pick
                  label="hub account"
                  value={filter.hub}
                  onChange={(v) => set('hub', v as ActivityFilter['hub'])}
                  options={[
                    { value: 'joined', label: 'Joined' },
                    { value: 'discord', label: 'Discord only' },
                  ]}
                />
              </td>
              <td className="py-2 pr-4">
                <Pick
                  label="commander verification"
                  value={filter.verified}
                  onChange={(v) => set('verified', v as ActivityFilter['verified'])}
                  options={[
                    { value: 'yes', label: 'Verified' },
                    { value: 'no', label: 'Not verified' },
                  ]}
                />
              </td>
              <td className="py-2 pr-4">
                <Pick
                  label="rank"
                  value={filter.rank}
                  onChange={(v) => set('rank', v)}
                  options={ranks.map((r) => ({ value: r, label: r }))}
                />
              </td>
              {/* Working toward is derived from Rank; filtering it as well would be two controls
                  for one fact. */}
              <td className="py-2 pr-4" />
              <td className="py-2 pr-4">
                <Min label="messages" value={filter.minMessages} onChange={(v) => set('minMessages', v)} />
              </td>
              <td className="py-2 pr-4">
                <Min label="forum posts" value={filter.minForum} onChange={(v) => set('minForum', v)} />
              </td>
              <td className="py-2 pr-4">
                <Min label="voice joins" value={filter.minVoice} onChange={(v) => set('minVoice', v)} />
              </td>
              <td className="py-2 pr-4">
                <Pick
                  label="Elite session"
                  value={filter.game}
                  onChange={(v) => set('game', v)}
                  options={games.map((g) => ({ value: g, label: GAME_LABEL[g] ?? g }))}
                />
              </td>
              <td className="py-2 pr-4">
                <Pick
                  label="last seen"
                  value={filter.seen}
                  onChange={(v) => set('seen', v as ActivityFilter['seen'])}
                  options={[
                    { value: 'live', label: 'In voice now' },
                    { value: 'active', label: 'Active' },
                    { value: 'quiet', label: 'Gone quiet' },
                  ]}
                />
              </td>
              <td className="py-2">
                <Pick
                  label="qualifies"
                  value={filter.qualifies}
                  onChange={(v) => set('qualifies', v as ActivityFilter['qualifies'])}
                  options={[
                    { value: 'yes', label: 'Yes' },
                    { value: 'no', label: 'No' },
                    { value: 'na', label: 'Top of ladder' },
                  ]}
                />
              </td>
            </tr>
          </thead>

          <tbody>
            {shown.map((r) => {
              const seen = lastSeen(r, now);
              const tenure = squadronTenure(r, now);

              return (
                <tr
                  key={r.discordId}
                  /*
                    ★ QUALIFYING ROWS ARE TINTED, NOT JUST TICKED ★

                    The question this table answers is "who is due a promotion on the 1st". Scanning
                    a Qualifies column down fifty rows to answer it is work; a tinted row answers it
                    at a glance.

                    ★ TWO TINTS, AND GONE-QUIET WINS ★

                    A member can be BOTH stale and qualifying: three months silent, then one message
                    and a session this month. Green alone would hide the thing an officer most needs
                    to see, so red takes precedence — the row still reads YES in the last column, so
                    nothing is lost by colouring it red.

                    `seen.tone`, not `goneQuiet` directly. Somebody sitting in a voice channel must
                    never be highlighted red for having gone quiet, however old their last message
                    is — that is the most obviously wrong thing this table could show, and it would
                    be showing it to an officer deciding who has left the squadron.
                  */
                  className={`border-b border-[var(--color-border-hairline)] ${
                    seen.tone === 'quiet'
                      ? 'bg-[color-mix(in_srgb,var(--color-semantic-hostile)_14%,transparent)]'
                      : r.qualifies
                        ? 'bg-[color-mix(in_srgb,var(--color-semantic-success)_10%,transparent)]'
                        : ''
                  }`}
                >
                  <td className="py-3 pr-4 text-[var(--color-text-primary)]">
                    {/*
                      ★ THE SERVER NICKNAME, WHICH IS THE IN-GAME NAME ★

                      By this squadron's convention the Discord nickname is the commander name, and
                      it is what officers recognise each other by.

                      The snowflake fallback is the last resort and should now be unreachable: the
                      bot records a name from every message and reconciles anyone it has activity
                      for but no name against, including members who have left. It stays because a
                      deleted Discord account genuinely has no name left to show, and a number is
                      more honest than a blank.
                    */}
                    {r.nick ?? r.displayName ?? r.handle ?? (
                      <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                        {r.discordId}
                      </span>
                    )}
                  </td>

                  {/*
                    ★ HOW LONG THEY HAVE BEEN IN THE SQUADRON ★

                    From Discord's join date, because nowhere else has it — Inara's commander
                    endpoint returns a squadron name and rank and no dates, there is no roster
                    endpoint, and the game's own journal never records when you joined one.

                    Where Discord cannot say — everybody who has left, whose join date it discards —
                    this falls back to the earliest activity we recorded and LABELS IT AS SUCH.
                    "Joined in March" and "first seen in March" are different claims and this column
                    must not blur them.
                  */}
                  <td className="py-3 pr-4 font-mono text-xs">
                    {tenure === null ? (
                      <span
                        className="text-[var(--color-text-secondary)]"
                        title="No join date from Discord and no recorded activity to fall back on."
                      >
                        Unknown
                      </span>
                    ) : (
                      <span
                        className={
                          tenure.source === 'joined'
                            ? 'text-[var(--color-text-primary)]'
                            : 'text-[var(--color-text-secondary)]'
                        }
                        title={
                          tenure.source === 'joined'
                            ? `Joined Discord ${new Date(tenure.at).toLocaleDateString('en-GB')}`
                            : `No Discord join date — they have left the server. First recorded activity ${new Date(tenure.at).toLocaleDateString('en-GB')}.`
                        }
                      >
                        {tenure.label}
                        {tenure.source === 'seen' && (
                          <span className="ml-1 text-[10px] text-[var(--color-brand-orange)]">
                            seen
                          </span>
                        )}
                      </span>
                    )}
                  </td>

                  {/*
                    Has an account here, versus present in Discord only. An officer needs to know
                    which, because someone who has never signed in cannot have linked a commander
                    and cannot be chased through the site.
                  */}
                  <td className="py-3 pr-4 font-mono text-xs">
                    {r.joinedWebsite ? (
                      <span className="text-[var(--color-brand-cyan-bright)]">
                        <span aria-hidden="true">✓ </span>Joined
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">Discord only</span>
                    )}
                  </td>

                  {/*
                    The commander name and HOW it was proven. Tier matters: an officer's manual
                    say-so and a name Inara returned for the member's own API key are not the same
                    claim, and collapsing them to a tick would present the weaker as the stronger.
                  */}
                  <td className="py-3 pr-4 font-mono text-xs">
                    {r.cmdrName !== null ? (
                      <span className="text-[var(--color-semantic-success)]">
                        <span aria-hidden="true">✓ </span>
                        {r.cmdrName}
                        <span className="ml-2 text-[10px] text-[var(--color-text-secondary)]">
                          {VERIFY_LABEL[r.verifiedVia ?? ''] ?? r.verifiedVia}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">Not verified</span>
                    )}
                  </td>

                  {/*
                    The rank they hold, then the rung above it. Both on the member line because "is
                    this person due a promotion" is the question this table exists to answer, and it
                    cannot be answered by activity counts alone.
                  */}
                  <td className="py-3 pr-4 font-mono text-xs text-[var(--color-brand-cyan-bright)]">
                    {/*
                      Rank, then the membership fallback, then Unranked. A full member of the
                      squadron shown as "Unranked" is both wrong and unwelcoming — they are a
                      member, they simply hold no rung yet.
                    */}
                    {r.currentRank ?? (
                      <span className="text-[var(--color-text-secondary)]">
                        {r.membershipRole ?? 'Unranked'}
                      </span>
                    )}
                    {/*
                      The APPOINTMENT, beneath the tenure rank rather than instead of it. They are
                      different axes: somebody can be a Cadet by tenure and a Squadron Leader by
                      appointment, and showing only the higher made a Squadron Leader appear to be
                      at the top of a ladder they are not on.
                    */}
                    {r.appointment !== null && (
                      <span className="mt-0.5 block text-[10px] text-[var(--color-brand-orange)]">
                        {r.appointment}
                      </span>
                    )}
                  </td>

                  <td className="py-3 pr-4 font-mono text-xs">
                    {r.nextRank !== null ? (
                      <span
                        className={
                          r.qualifies
                            ? 'text-[var(--color-semantic-success)]'
                            : 'text-[var(--color-text-secondary)]'
                        }
                      >
                        <span aria-hidden="true">↑ </span>
                        {r.nextRank}
                      </span>
                    ) : r.currentRank !== null ? (
                      /*
                        Genuinely the top of the TENURE ladder — Grand Master General, twelve
                        qualifying months. An achievement, not missing data.

                        Reached only when a tenure rank exists, which is what stops a leadership
                        appointment being labelled this way.
                      */
                      <span className="text-[var(--color-brand-orange)]">Top of ladder</span>
                    ) : (
                      /*
                        No mapped rank in Discord. Says so rather than showing a dash: "—" reads as
                        a rendering failure, and the real answer — nobody has given them a rank
                        role — is something an officer can act on.
                      */
                      <span className="text-[var(--color-text-secondary)]">No rank role</span>
                    )}
                  </td>

                  <td className="py-3 pr-4"><Num n={r.messageCount} /></td>
                  <td className="py-3 pr-4"><Num n={r.forumPostCount} /></td>
                  <td className="py-3 pr-4"><Num n={r.voiceJoinCount} /></td>
                  <td className="py-3 pr-4 font-mono text-xs text-[var(--color-text-secondary)]">
                    {GAME_LABEL[r.gameActivity] ?? r.gameActivity}
                  </td>

                  {/*
                    ★ LAST SEEN IN DISCORD, NOT ON THE WEBSITE ★

                    Squadron owner, 2026-07-29. Somebody can read the site every day without saying
                    a word to anyone, and a roster of silent accounts is exactly what this column
                    exists to surface.

                    ★ IN VOICE IS ITS OWN ANSWER, NOT A FRESHER TIMESTAMP ★

                    Somebody in comms is HERE. This column showed them as "3 days" — true of their
                    last message, and the wrong answer to the question the column exists for.

                    A dot as well as a colour, because "live" and "quiet" are both rendered in
                    colour and one of them must not depend on being able to tell red from cyan.
                  */}
                  <td className="py-3 pr-4 font-mono text-xs">
                    <span
                      className={
                        seen.tone === 'live'
                          ? 'text-[var(--color-brand-cyan-bright)]'
                          : seen.tone === 'quiet'
                            ? 'text-[var(--color-semantic-hostile-bright)]'
                            : 'text-[var(--color-text-secondary)]'
                      }
                      title={
                        seen.tone === 'live'
                          ? `In a voice channel since ${new Date(r.inVoiceSince ?? '').toLocaleString('en-GB')}`
                          : r.lastSeenAt === null
                            ? 'Nothing recorded in Discord at all'
                            : new Date(r.lastSeenAt).toLocaleString('en-GB')
                      }
                    >
                      {seen.tone === 'live' && <span aria-hidden="true">● </span>}
                      {seen.label}
                    </span>
                  </td>

                  <td className="py-3 font-mono text-xs">
                    {/*
                      ★ THREE ANSWERS, BECAUSE THERE ARE THREE ★

                      Somebody at the top of the ladder cannot qualify for a promotion — there is
                      none above them. Rendering that as "no" alongside everybody who simply has not
                      been active would read as a failure, and it is the opposite: they have
                      finished the ladder.

                      `qualifies` is false for them by design (see admin.store). This cell says WHY,
                      so the two read as one consistent answer rather than as a member who has
                      somehow stopped meeting the rules.
                    */}
                    {r.qualifies ? (
                      <span className="text-[var(--color-brand-cyan-bright)]">YES</span>
                    ) : r.nextRank === null && r.currentRank !== null ? (
                      <span
                        className="text-[var(--color-brand-orange)]"
                        title="At the top of the tenure ladder. There is no further rank to be promoted to."
                      >
                        n/a
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">no</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
          No activity recorded for this month yet.
        </p>
      )}

      {/*
        A filter that matches nothing says so. An empty table under a row of controls reads as
        broken data, and the fix — which filter to loosen — is not visible from it.
      */}
      {rows.length > 0 && shown.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
          No member matches these filters. <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="text-[var(--color-brand-cyan-bright)] underline"
          >
            Clear them
          </button>{' '}
          to see all {rows.length}.
        </p>
      )}
    </>
  );
}
