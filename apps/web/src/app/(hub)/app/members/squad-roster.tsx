'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '../../../../lib/api-client';
import type { SquadMemberRow } from '../../../../lib/api';
import { squadronTenure } from '../member-tenure';
import {
  confirmText,
  displayName,
  isTimedOut,
  offersFor,
  timeoutRemainingMinutes,
  DELETE_CHOICES,
  TIMEOUT_CHOICES,
  type Action,
} from './moderation-rules';

/**
 * Every member of the Discord server, with the tools to moderate them.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "we need to create a full on member roster that shows every member in our discord with full
 * administrative tools for them, kick, ban, timeout blah blah blah"
 *
 * ★ THE ACTIONS LIVE IN A PANEL, NOT IN THE ROW ★
 *
 * Four buttons on every one of a hundred and seventeen rows is four hundred and sixty-eight
 * chances to hit Ban while aiming for the row below. Selecting a member opens a panel with their
 * details and the actions in it, so every removal takes a deliberate second step — and there is
 * somewhere to put the reason, which is required and has nowhere to live in a table cell.
 */

const CONTROL =
  'w-full rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-primary)] ' +
  'transition-colors hover:border-[var(--color-border-subtle)] ' +
  'focus:border-[var(--color-border-focus)] focus:outline-none';

const FIELD_LABEL =
  'mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]';

type Presence = '' | 'timedout' | 'voice' | 'bot' | 'blocked';

function Badge({ tone, children }: { tone: 'quiet' | 'warn' | 'live' | 'dim'; children: React.ReactNode }) {
  const colour =
    tone === 'warn'
      ? 'border-[var(--color-semantic-warning)] text-[var(--color-semantic-warning)]'
      : tone === 'live'
        ? 'border-[var(--color-brand-cyan)] text-[var(--color-brand-cyan-bright)]'
        : tone === 'quiet'
          ? 'border-[var(--color-semantic-hostile)] text-[var(--color-semantic-hostile-bright)]'
          : 'border-[var(--color-border-hairline)] text-[var(--color-text-dim)]';

  return (
    <span
      className={`inline-block rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em] ${colour}`}
    >
      {children}
    </span>
  );
}

export function SquadRoster({ rows, now }: { rows: SquadMemberRow[]; now: number }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [presence, setPresence] = useState<Presence>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const roles = useMemo(
    () => [...new Set(rows.flatMap((r) => r.roles))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (
        term !== '' &&
        // The Discord id is searchable on purpose: it is what an officer has in hand after copying
        // somebody out of Discord's own UI, and the one identifier that is never ambiguous.
        ![r.nick, r.globalName, r.username, r.cmdrName, r.handle, r.discordId]
          .filter((v): v is string => v !== null)
          .join(' ')
          .toLowerCase()
          .includes(term)
      ) {
        return false;
      }

      if (role !== '' && !r.roles.includes(role)) return false;

      if (presence === 'timedout' && !isTimedOut(r, now)) return false;
      if (presence === 'voice' && r.inVoiceSince === null) return false;
      if (presence === 'bot' && !r.isBot) return false;
      if (presence === 'blocked' && r.moderatable) return false;

      return true;
    });
  }, [rows, search, role, presence, now]);

  const selected = rows.find((r) => r.discordId === selectedId) ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-4 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-1">
              <span className={FIELD_LABEL}>Member</span>
              <input
                type="search"
                placeholder="Name, CMDR or Discord ID…"
                className={CONTROL}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Discord role</span>
              <select className={CONTROL} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Any</option>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Show</span>
              <select
                className={CONTROL}
                value={presence}
                onChange={(e) => setPresence(e.target.value as Presence)}
              >
                <option value="">Everyone</option>
                <option value="timedout">Currently timed out</option>
                <option value="voice">In voice now</option>
                <option value="blocked">Out of the bot&rsquo;s reach</option>
                <option value="bot">Bots</option>
              </select>
            </label>
          </div>

          <div className="mt-3 border-t border-[var(--color-border-hairline)] pt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            <span className="text-[var(--color-brand-cyan-bright)]">{shown.length}</span> of {rows.length}{' '}
            in the server
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--color-border-hairline)]">
          <ul className="list-none divide-y divide-[var(--color-border-hairline)] p-0">
            {shown.map((r) => {
              const tenure = squadronTenure({ joinedAt: r.joinedAt, activeSince: null }, now);
              const active = r.discordId === selectedId;

              return (
                <li key={r.discordId}>
                  {/*
                    The whole row selects. A small "manage" link on the right would be the only
                    target on a line an officer is already pointing at.
                  */}
                  <button
                    type="button"
                    onClick={() => setSelectedId(active ? null : r.discordId)}
                    className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors ${
                      active
                        ? 'bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)]'
                        : 'hover:bg-[var(--color-surface-panel-hover)]'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[var(--color-text-primary)]">
                        {displayName(r)}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {r.rank !== null && (
                          <span className="font-mono text-[10px] text-[var(--color-brand-cyan-bright)]">
                            {r.rank}
                          </span>
                        )}
                        {r.appointment !== null && (
                          <span className="font-mono text-[10px] text-[var(--color-brand-orange)]">
                            {r.appointment}
                          </span>
                        )}
                        {r.cmdrName !== null && (
                          <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                            CMDR {r.cmdrName}
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="flex shrink-0 items-center gap-1.5">
                      {isTimedOut(r, now) && <Badge tone="warn">Timed out</Badge>}
                      {r.inVoiceSince !== null && <Badge tone="live">In voice</Badge>}
                      {r.isBot && <Badge tone="dim">Bot</Badge>}
                      {/*
                        Marked on the row, not only in the panel. An officer scanning for somebody
                        to action should be able to see who is out of reach without opening each in
                        turn.
                      */}
                      {!r.moderatable && !r.isBot && <Badge tone="dim">Outranks bot</Badge>}
                      <span className="w-28 text-right font-mono text-[10px] text-[var(--color-text-dim)]">
                        {tenure?.label ?? 'unknown'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {shown.length === 0 && (
            <p className="px-4 py-6 text-sm text-[var(--color-text-secondary)]">
              Nobody matches. Clear the filters to see all {rows.length}.
            </p>
          )}
        </div>
      </div>

      <ManagePanel
        key={selected?.discordId ?? 'none'}
        member={selected}
        now={now}
        onChanged={() => {
          /*
           * A kicked or banned member leaves the roster entirely, so the panel would be left
           * pointing at somebody who is no longer in the list. Clearing the selection first means
           * the refreshed page shows the prompt to choose somebody rather than a stale panel.
           */
          setSelectedId(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * The actions for one member.
 *
 * ★ `key` FORCES A REMOUNT PER MEMBER ★
 *
 * Without it, selecting a second member keeps the first one's typed reason and chosen duration in
 * state. A reason written about one person, submitted against another, is the worst possible bug on
 * a page that bans people — and it would look like it worked.
 */
function ManagePanel({
  member,
  now,
  onChanged,
}: {
  member: SquadMemberRow | null;
  now: number;
  /** Re-pulls the roster from the server after an action lands. */
  onChanged: () => void;
}) {
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(TIMEOUT_CHOICES[1]?.minutes ?? 60);
  const [deleteDays, setDeleteDays] = useState(0);
  const [busy, setBusy] = useState<Action | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (member === null) {
    return (
      <aside className="rounded-lg border border-dashed border-[var(--color-border-hairline)] p-6">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Choose a member to see their roles, how long they have been here, and the moderation
          tools.
        </p>
      </aside>
    );
  }

  const offers = offersFor(member, now);

  async function run(action: Action, destructive: boolean) {
    if (member === null) return;

    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setProblem('Give a reason first. It goes to the squadron audit log and to the one in Discord.');
      return;
    }

    /*
     * The confirmation names the person and says whether they can come back. "Are you sure?" is a
     * button people learn to click; the difference between kick and ban is the entire decision.
     */
    if (destructive && !window.confirm(confirmText(action, member, action === 'ban' ? deleteDays : 0))) {
      return;
    }

    setBusy(action);
    setProblem(null);
    setDone(null);

    try {
      const res = await apiPost<{ applied: boolean; problem?: string }>(
        `/v1/admin/squad/${member.discordId}/moderate`,
        {
          action,
          reason: trimmed,
          ...(action === 'timeout' ? { minutes } : {}),
          ...(action === 'ban' ? { deleteMessageDays: deleteDays } : {}),
        },
      );

      if (res.applied) {
        setDone(`Done. ${displayName(member)} — ${action}.`);
        /*
         * ★ THE PAGE UPDATES IN PLACE, WITHOUT A RELOAD ★
         *
         * Squadron owner, 2026-08-01: "we need this to happen so we can see the changes have been
         * made as they happen". A reload threw away the scroll position, the search box and the
         * selected member — after every single action, while working through a queue of them.
         *
         * `router.refresh()` re-renders the server component with fresh data and leaves all of that
         * alone. Discord stays the authority on what happened: nothing is guessed at client-side,
         * the server is simply asked again.
         */
        onChanged();
      } else {
        setProblem(res.problem ?? 'Discord refused, and gave no reason.');
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside className="h-fit rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-5">
      <h2 className="text-lg text-[var(--color-text-primary)]">{displayName(member)}</h2>
      <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-dim)]">{member.discordId}</p>

      <dl className="mt-4 space-y-2 border-t border-[var(--color-border-hairline)] pt-4 text-xs">
        <Row label="Joined Discord">
          {member.joinedAt === null
            ? 'Unknown'
            : new Date(member.joinedAt).toLocaleDateString('en-GB')}
        </Row>
        <Row label="Hub account">{member.hasAccount ? (member.handle ?? 'Yes') : 'Discord only'}</Row>
        <Row label="Commander">{member.cmdrName ?? 'Not verified'}</Row>
        {isTimedOut(member, now) && (
          <Row label="Timed out">
            {timeoutRemainingMinutes(member, now)} minutes left
          </Row>
        )}
        <Row label="Discord roles">
          {member.roles.length === 0 ? 'None' : member.roles.join(', ')}
        </Row>
      </dl>

      {!member.moderatable && (
        /*
          Said once, at the top of the actions, rather than repeated on four disabled buttons. It
          is one fact about this member and it has one fix.
        */
        <p className="mt-4 rounded-md border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] p-3 text-xs text-[var(--color-text-secondary)]">
          {member.notModeratableBecause}
        </p>
      )}

      <div className="mt-4 border-t border-[var(--color-border-hairline)] pt-4">
        <label className="block">
          <span className={FIELD_LABEL}>Reason (required)</span>
          <textarea
            rows={2}
            className={CONTROL}
            placeholder="Written to the audit log, and to Discord's"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className={FIELD_LABEL}>Timeout length</span>
            <select
              className={CONTROL}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {TIMEOUT_CHOICES.map((c) => (
                <option key={c.minutes} value={c.minutes}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={FIELD_LABEL}>On ban</span>
            <select
              className={CONTROL}
              value={deleteDays}
              onChange={(e) => setDeleteDays(Number(e.target.value))}
            >
              {DELETE_CHOICES.map((c) => (
                <option key={c.days} value={c.days}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {offers.map((o) => (
            <button
              key={o.action}
              type="button"
              disabled={o.blockedBecause !== null || busy !== null}
              title={o.blockedBecause ?? undefined}
              onClick={() => void run(o.action, o.destructive)}
              className={`rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                o.destructive
                  ? 'border-[var(--color-semantic-hostile)] text-[var(--color-semantic-hostile-bright)] hover:bg-[color-mix(in_srgb,var(--color-semantic-hostile)_16%,transparent)]'
                  : 'border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-panel-hover)]'
              }`}
            >
              {busy === o.action ? 'Working…' : o.label}
            </button>
          ))}
        </div>

        {problem !== null && (
          <p className="mt-3 rounded-md border border-[var(--color-semantic-hostile)] bg-[color-mix(in_srgb,var(--color-semantic-hostile)_10%,transparent)] p-3 text-xs text-[var(--color-semantic-hostile-bright)]">
            {problem}
          </p>
        )}
        {done !== null && (
          <p className="mt-3 text-xs text-[var(--color-semantic-success)]">{done}</p>
        )}
      </div>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
        {label}
      </dt>
      <dd className="m-0 text-right text-[var(--color-text-secondary)]">{children}</dd>
    </div>
  );
}
