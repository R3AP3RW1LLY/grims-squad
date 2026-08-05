'use client';

import { useMemo, useState } from 'react';
import type { AdminActivityRow } from '../../../lib/api';
import { lastSeen } from './activity-freshness';
import { squadronTenure } from './member-tenure';
import { voiceTime } from './voice-time';
import {
  EMPTY_FILTER,
  isFiltering,
  matchesFilter,
  rankLabel,
  distinct,
  type ActivityFilter,
} from './activity-filters';

/**
 * The activity roster.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "the table is also getting pretty squished, is there a better way to lay this out so its not
 * getting mangled? we really want this to look freaking awesome!"
 *
 * It was twelve columns across 1400px with a filter control under each heading, which is two tables
 * fighting for the same width. Every cell held one small fact and none of them had room.
 *
 * ★ SEVEN COLUMNS, BECAUSE FACTS COME IN GROUPS ★
 *
 * The twelve were never twelve independent things. A member's identity is their nickname AND their
 * commander name AND whether they have a hub account — three columns for one answer to "who is
 * this". Rank is their rung AND their appointment AND the rung above. Activity is three counters
 * read together, never apart.
 *
 * Grouped, each cell gets a primary line and a quieter second line, which is how the information
 * was actually shaped all along. Nothing was dropped: every value that was on screen before is
 * still on screen, with room to breathe.
 *
 * ★ AND THE FILTERS MOVED OUT OF THE HEADER ★
 *
 * Under-the-column was the right answer when columns and filters were one to one. They no longer
 * are — "Rank" now carries three facts and "This month" carries three counters — so a control
 * wedged under a heading would be ambiguous as well as cramped. A labelled panel above the table
 * says what each one filters, in words, and gives the table its full width back.
 */

/** Shared styling for every filter control. */
const CONTROL =
  'w-full rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-primary)] ' +
  'transition-colors hover:border-[var(--color-border-subtle)] ' +
  'focus:border-[var(--color-border-focus)] focus:outline-none';

const FIELD_LABEL =
  'mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]';

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

/** Elite session state, coloured by how much it can be relied on. */
const GAME_TONE: Record<string, string> = {
  observed: 'text-[var(--color-semantic-success)]',
  // Amber, not green. An assumption must not look like an observation at a glance either.
  assumed: 'text-[var(--color-semantic-warning)]',
  absent: 'text-[var(--color-text-secondary)]',
  unlinked: 'text-[var(--color-text-secondary)]',
  unknown: 'text-[var(--color-text-secondary)]',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={FIELD_LABEL}>{label}</span>
      {children}
    </label>
  );
}

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
    <Field label={label}>
      <select className={CONTROL} value={value} onChange={(e) => onChange(e.target.value)}>
        {/* "Any" rather than a blank. A blank first option reads as a missing value. */}
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

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
    <Field label={label}>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        placeholder="Any"
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
    </Field>
  );
}

/**
 * Voice TIME in the activity cell: how long, beside the join count's how often.
 *
 * ★ A DASH, NOT A ZERO — squadron owner, 2026-08-04 ★
 *
 * Minutes are banked only since the feature shipped, so zero is both "never spoke" and "before
 * we counted" — and this cell cannot tell them apart, so it must not print a figure that
 * claims to. The joins column keeps its zero because joins have been counted all along.
 */
function VoiceTime({ minutes }: { minutes: number }) {
  return (
    <div className="text-center">
      <div
        className={`font-mono text-sm tabular-nums ${
          minutes === 0 ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text-secondary)]'
        }`}
      >
        {voiceTime(minutes)}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
        voice time
      </div>
    </div>
  );
}

/** One counter in the activity cell: a number over its unit. */
function Count({ n, unit, strong = false }: { n: number; unit: string; strong?: boolean }) {
  return (
    <div className="text-center">
      <div
        className={`font-mono text-sm tabular-nums ${
          n === 0
            ? 'text-[var(--color-text-dim)]'
            : strong
              ? 'text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)]'
        }`}
      >
        {n.toLocaleString('en-GB')}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
        {unit}
      </div>
    </div>
  );
}

const TH =
  'sticky top-0 z-10 bg-[var(--color-surface-panel)] py-3 pr-4 text-left font-mono text-[10px] ' +
  'uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';

export function ActivityTable({
  rows,
  now,
}: {
  rows: AdminActivityRow[];
  /**
   * The instant the server rendered at.
   *
   * Two columns are relative to the present. A client component is still rendered on the server
   * first, so `Date.now()` during render would put one answer in the HTML and a different one at
   * hydration, and React would swap the text and log a mismatch. Taking the instant as a prop makes
   * both renders agree.
   */
  now: number;
}) {
  const [filter, setFilter] = useState<ActivityFilter>(EMPTY_FILTER);
  const set = <K extends keyof ActivityFilter>(key: K, value: ActivityFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  // Dropdown contents come from the rows, so a rank role added in Discord next month appears here
  // on its own and a rank nobody holds never clutters the list.
  const ranks = useMemo(() => distinct(rows, rankLabel), [rows]);
  const games = useMemo(() => distinct(rows, (r) => r.gameActivity), [rows]);

  const shown = useMemo(() => rows.filter((r) => matchesFilter(r, filter, now)), [rows, filter, now]);
  const filtering = isFiltering(filter);

  return (
    <>
      {/*
        ★ THE FILTER PANEL ★

        A labelled grid rather than a row of bare controls. Eleven filters with no labels is a
        puzzle, and the two that need explaining most — "min" boxes and the three-state Qualifies —
        are exactly the ones a placeholder cannot carry.
      */}
      <div className="mb-5 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {/* Widest, and first, because it is the one most often reached for. */}
          <div className="col-span-2">
            <Field label="Member">
              <input
                type="search"
                placeholder="Name, CMDR or Discord ID…"
                className={CONTROL}
                value={filter.member}
                onChange={(e) => set('member', e.target.value)}
              />
            </Field>
          </div>

          <Pick
            label="In Discord"
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
          <Pick
            label="Rank"
            value={filter.rank}
            onChange={(v) => set('rank', v)}
            options={ranks.map((r) => ({ value: r, label: r }))}
          />
          <Pick
            label="Hub account"
            value={filter.hub}
            onChange={(v) => set('hub', v as ActivityFilter['hub'])}
            options={[
              { value: 'joined', label: 'Joined' },
              { value: 'discord', label: 'Discord only' },
            ]}
          />
          <Pick
            label="Commander"
            value={filter.verified}
            onChange={(v) => set('verified', v as ActivityFilter['verified'])}
            options={[
              { value: 'yes', label: 'Verified' },
              { value: 'no', label: 'Not verified' },
            ]}
          />
          <Pick
            label="Elite session"
            value={filter.game}
            onChange={(v) => set('game', v)}
            options={games.map((g) => ({ value: g, label: GAME_LABEL[g] ?? g }))}
          />
          <Pick
            label="Last seen"
            value={filter.seen}
            onChange={(v) => set('seen', v as ActivityFilter['seen'])}
            options={[
              { value: 'live', label: 'In voice now' },
              { value: 'active', label: 'Active' },
              { value: 'quiet', label: 'Gone quiet' },
            ]}
          />
          <Pick
            label="Qualifies"
            value={filter.qualifies}
            onChange={(v) => set('qualifies', v as ActivityFilter['qualifies'])}
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
              { value: 'na', label: 'Top of ladder' },
            ]}
          />
          <Min label="Min messages" value={filter.minMessages} onChange={(v) => set('minMessages', v)} />
          <Min label="Min forum" value={filter.minForum} onChange={(v) => set('minForum', v)} />
          <Min label="Min voice" value={filter.minVoice} onChange={(v) => set('minVoice', v)} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--color-border-hairline)] pt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          <span>
            {filtering ? (
              <>
                <span className="text-[var(--color-brand-cyan-bright)]">{shown.length}</span> of{' '}
                {rows.length} members
              </>
            ) : (
              <>{rows.length} members</>
            )}
          </span>
          {/*
            Offered only when something is actually filtered. A permanently visible Clear invites
            the question "is anything filtered right now?", which the count already answers.
          */}
          {filtering && (
            <button
              type="button"
              onClick={() => setFilter(EMPTY_FILTER)}
              className="rounded-md border border-[var(--color-border-hairline)] px-3 py-1 uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-colors hover:border-[var(--color-brand-cyan)] hover:bg-[var(--color-surface-panel-hover)]"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/*
        ★ THE HEADER STAYS PUT ★

        A hundred and seventeen rows is well past a screen. Scrolling the headings away turns the
        three number columns into three anonymous columns of numbers, at exactly the point somebody
        is comparing rows far apart.
      */}
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border-hairline)]">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <th scope="col" className={`${TH} pl-4`}>Member</th>
              <th scope="col" className={TH}>In Discord</th>
              <th scope="col" className={TH}>Rank</th>
              {/*
                "Activity", no longer "This month": the period control above the table can hand
                it a whole year now, and a year of counters under a heading that says "This
                month" is a heading that lies. The section title carries the period.
              */}
              <th scope="col" className={`${TH} text-center`}>Activity</th>
              <th scope="col" className={TH}>Elite</th>
              <th scope="col" className={TH}>Last seen</th>
              <th scope="col" className={`${TH} pr-4`}>Qualifies</th>
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

                    The question this table answers is "who is due a promotion on the 1st".
                    Scanning a Qualifies column down a hundred rows to answer it is work; a tinted
                    row answers it at a glance.

                    ★ TWO TINTS, AND GONE-QUIET WINS ★

                    A member can be BOTH stale and qualifying: three months silent, then one message
                    and a session this month. Green alone would hide the thing an officer most needs
                    to see, so red takes precedence — the row still reads YES in the last column, so
                    nothing is lost by colouring it red.

                    `seen.tone`, not `goneQuiet` directly. Somebody sitting in a voice channel must
                    never be highlighted red for having gone quiet, however old their last message
                    is — the most obviously wrong thing this table could show, to an officer
                    deciding who has left the squadron.
                  */
                  className={`border-b border-[var(--color-border-hairline)] transition-colors last:border-0 ${
                    seen.tone === 'quiet'
                      ? 'bg-[color-mix(in_srgb,var(--color-semantic-hostile)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-semantic-hostile)_20%,transparent)]'
                      : r.qualifies
                        ? 'bg-[color-mix(in_srgb,var(--color-semantic-success)_9%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-semantic-success)_16%,transparent)]'
                        : 'hover:bg-[var(--color-surface-panel-hover)]'
                  }`}
                >
                  {/*
                    ★ WHO THIS IS, IN ONE CELL ★

                    Nickname, commander name and hub account were three columns. They are one
                    question — "who am I looking at" — and the answer reads better stacked than
                    spread across a third of the table.

                    The nickname leads because by this squadron's convention it IS the in-game name,
                    and it is what officers recognise each other by.
                  */}
                  <td className="py-3 pl-4 pr-4">
                    <div className="font-medium text-[var(--color-text-primary)]">
                      {r.nick ?? r.displayName ?? r.handle ?? (
                        /*
                          The snowflake fallback should now be unreachable: the bot records a name
                          from every message and reconciles anyone it has activity for but no name
                          against, including members who have left. It stays because a deleted
                          Discord account genuinely has no name left, and a number is more honest
                          than a blank.
                        */
                        <span className="font-mono text-xs text-[var(--color-text-dim)]">
                          {r.discordId}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px]">
                      {r.cmdrName !== null ? (
                        <span className="text-[var(--color-semantic-success)]">
                          <span aria-hidden="true">✓ </span>
                          CMDR {r.cmdrName}
                          {/*
                            HOW it was proven, not just that it was. An officer's manual say-so and
                            a name Inara returned for the member's own API key are not the same
                            claim, and collapsing them to a tick presents the weaker as the stronger.
                          */}
                          <span className="ml-1 text-[var(--color-text-dim)]">
                            ({VERIFY_LABEL[r.verifiedVia ?? ''] ?? r.verifiedVia})
                          </span>
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-dim)]">No verified CMDR</span>
                      )}

                      {/*
                        Only shown when they have NOT signed in. An officer needs to know who cannot
                        be chased through the site; a badge on the eighty per cent who can would be
                        noise on every row.
                      */}
                      {!r.joinedWebsite && (
                        <span className="rounded border border-[var(--color-border-hairline)] px-1.5 py-px uppercase tracking-[0.1em] text-[var(--color-text-dim)]">
                          Discord only
                        </span>
                      )}
                    </div>
                  </td>

                  {/*
                    ★ HOW LONG THEY HAVE BEEN HERE ★

                    From Discord's join date, because nowhere else has it — Inara's commander
                    endpoint returns a squadron name and rank and no dates, there is no roster
                    endpoint, and the game's journal never records when you joined a squadron.

                    Where Discord cannot say — everybody who has left, whose join date it discards —
                    this falls back to the earliest activity we recorded and LABELS it. "Joined in
                    March" and "first seen in March" are different claims.
                  */}
                  <td className="py-3 pr-4">
                    {tenure === null ? (
                      <span
                        className="font-mono text-xs text-[var(--color-text-dim)]"
                        title="No join date from Discord, and no recorded activity to fall back on."
                      >
                        Unknown
                      </span>
                    ) : (
                      <span
                        className="font-mono text-xs text-[var(--color-text-primary)]"
                        title={
                          tenure.source === 'joined'
                            ? `Joined Discord ${new Date(tenure.at).toLocaleDateString('en-GB')}`
                            : `No Discord join date — they have left the server. First recorded activity ${new Date(tenure.at).toLocaleDateString('en-GB')}.`
                        }
                      >
                        {tenure.label}
                        {tenure.source === 'seen' && (
                          <span className="ml-1.5 text-[9px] uppercase tracking-[0.1em] text-[var(--color-brand-orange)]">
                            first seen
                          </span>
                        )}
                      </span>
                    )}
                  </td>

                  {/*
                    ★ RANK, APPOINTMENT AND THE RUNG ABOVE ★

                    Three columns before, and they are one subject. The appointment sits beneath the
                    tenure rank rather than instead of it: they are different axes, and showing only
                    the higher made a Squadron Leader appear to be at the top of a ladder they are
                    not on.
                  */}
                  <td className="py-3 pr-4">
                    <div className="font-mono text-xs">
                      {r.currentRank !== null ? (
                        <span className="text-[var(--color-brand-cyan-bright)]">{r.currentRank}</span>
                      ) : (
                        /*
                          A full member shown as "Unranked" is both wrong and unwelcoming — they are
                          a member, they simply hold no rung yet.
                        */
                        <span className="text-[var(--color-text-secondary)]">
                          {r.membershipRole ?? 'Unranked'}
                        </span>
                      )}
                    </div>

                    {r.appointment !== null && (
                      <div className="mt-0.5 font-mono text-[10px] text-[var(--color-brand-orange)]">
                        {r.appointment}
                      </div>
                    )}

                    <div className="mt-0.5 font-mono text-[10px]">
                      {r.nextRank !== null ? (
                        <span
                          className={
                            r.qualifies
                              ? 'text-[var(--color-semantic-success)]'
                              : 'text-[var(--color-text-dim)]'
                          }
                        >
                          <span aria-hidden="true">↑ </span>
                          {r.nextRank}
                        </span>
                      ) : r.currentRank !== null ? (
                        /*
                          Genuinely the top of the TENURE ladder — Grand Master General, twelve
                          qualifying months. An achievement, not missing data. Reached only when a
                          tenure rank exists, which is what stops an appointment being labelled so.
                        */
                        <span className="text-[var(--color-brand-orange)]">Top of ladder</span>
                      ) : (
                        /*
                          Says so rather than showing a dash: "—" reads as a rendering failure, and
                          the real answer — nobody has given them a rank role — is actionable.
                        */
                        <span className="text-[var(--color-text-dim)]">No rank role</span>
                      )}
                    </div>
                  </td>

                  {/*
                    ★ THE THREE COUNTERS, READ TOGETHER ★

                    They were never compared across columns — they are compared to each other, on
                    one member, to answer "what has this person actually been doing". Messages leads
                    because it is the counter promotion turns on.
                  */}
                  <td className="py-3 pr-4">
                    <div className="flex items-start justify-center gap-4">
                      <Count n={r.messageCount} unit="msg" strong />
                      <Count n={r.forumPostCount} unit="forum" />
                      <Count n={r.voiceJoinCount} unit="voice" />
                      {/*
                        Beside the join count, never instead of it — the owner asked for "how
                        long" ALONGSIDE the joins. Officer-only by construction: this table is
                        already behind the admin gate, and no member-facing payload carries the
                        figure.
                      */}
                      <VoiceTime minutes={r.voiceMinutes} />
                    </div>
                  </td>

                  <td className="py-3 pr-4">
                    <span
                      className={`font-mono text-xs ${GAME_TONE[r.gameActivity] ?? 'text-[var(--color-text-secondary)]'}`}
                      title={
                        r.gameActivity === 'assumed'
                          ? 'The upstream check could not run and the month was counted anyway. An assumption, not an observation.'
                          : undefined
                      }
                    >
                      {GAME_LABEL[r.gameActivity] ?? r.gameActivity}
                    </span>
                  </td>

                  {/*
                    ★ LAST SEEN IN DISCORD, NOT ON THE WEBSITE ★

                    Somebody can read the site every day without saying a word to anyone, and a
                    roster of silent accounts is what this column exists to surface.

                    ★ IN VOICE IS ITS OWN ANSWER, NOT A FRESHER TIMESTAMP ★

                    Somebody in comms is HERE. This showed them as "3 days" — true of their last
                    message, and the wrong answer to the question the column exists for. A dot as
                    well as a colour, because "live" and "quiet" are both rendered in colour and one
                    of them must not depend on telling red from cyan.
                  */}
                  <td className="py-3 pr-4">
                    <span
                      className={`font-mono text-xs ${
                        seen.tone === 'live'
                          ? 'text-[var(--color-brand-cyan-bright)]'
                          : seen.tone === 'quiet'
                            ? 'text-[var(--color-semantic-hostile-bright)]'
                            : 'text-[var(--color-text-secondary)]'
                      }`}
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

                  <td className="py-3 pr-4">
                    {/*
                      ★ THREE ANSWERS, BECAUSE THERE ARE THREE ★

                      Somebody at the top of the ladder cannot qualify — there is nothing above
                      them. Rendering that as "no" alongside everybody who simply has not been
                      active would read as a failure, and it is the opposite: they have finished the
                      ladder. `qualifies` is false for them by design (see admin.store); this cell
                      says WHY, so the two read as one consistent answer.
                    */}
                    {r.qualifies ? (
                      <span className="inline-block rounded-md border border-[var(--color-brand-cyan)] bg-[color-mix(in_srgb,var(--color-brand-cyan)_18%,transparent)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-cyan-bright)]">
                        Yes
                      </span>
                    ) : r.nextRank === null && r.currentRank !== null ? (
                      <span
                        className="inline-block rounded-md border border-[var(--color-brand-orange-dim)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-orange)]"
                        title="At the top of the tenure ladder. There is no further rank to be promoted to."
                      >
                        Top
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
                        No
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        // "Period", not "month" — the control above can hand this table a whole year now.
        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
          No activity recorded for this period yet.
        </p>
      )}

      {/*
        A filter that matches nothing says so. An empty table under a panel of controls reads as
        broken data, and the fix — which filter to loosen — is not visible from it.
      */}
      {rows.length > 0 && shown.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
          No member matches these filters.{' '}
          <button
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
