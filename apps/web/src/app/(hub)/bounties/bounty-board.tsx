'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BountyRow } from '../../../lib/api';
import { apiPost } from '../../../lib/api-client';

/**
 * The two bounty tables, filterable in the browser.
 *
 * ★ FILTERED CLIENT-SIDE FOR THE SAME REASON THE MARKET TABLE IS ★
 *
 * The board is capped at five hundred rows total and arrives in one read. Typing into the filter
 * has to narrow the list between keystrokes, and a round trip per keystroke is how that dies.
 */

const TH =
  'sticky top-0 z-10 bg-[var(--color-surface-panel)] py-3 pr-4 text-left font-mono text-[10px] ' +
  'uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';

const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

/**
 * How dark the data is, in the words a runner scans for.
 *
 * "Never seen" is deliberately the loudest phrase on the board: a station we hold NOTHING for is
 * worth more than any amount of staleness, and the copy has to sell that the way the points do.
 */
function ageOf(r: BountyRow): string {
  if (r.daysStale === null) return 'never seen';
  if (r.daysStale >= 365) {
    const y = r.daysStale / 365;
    return `${y.toFixed(1)}y dark`;
  }
  return `${r.daysStale}d dark`;
}

function padsOf(r: BountyRow): string {
  if (r.largePads === null || r.largePads < 0) return '—';
  return r.largePads > 0 ? `${r.largePads} large` : 'no large';
}

export function BountyBoardTables({
  rows,
  kind,
  activeProjects = 0,
}: {
  rows: readonly BountyRow[];
  kind: 'ops' | 'galaxy';
  /** Only meaningful for `ops`, where it decides which empty state is the true one. */
  activeProjects?: number;
}) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter(
      (r) =>
        r.stationName.toLowerCase().includes(q) || r.systemName.toLowerCase().includes(q),
    );
  }, [rows, query]);

  if (rows.length === 0) {
    /*
      ★ EMPTY BECAUSE IT IS CLEAR, OR EMPTY BECAUSE IT IS UNDEFINED ★

      This said "squadron space is lit" whenever the list was empty — a claim that every station
      near us has been observed inside the believability band. In production it was saying that
      while there were NO active colonisation projects at all, so there was no squadron space to
      be lit: the 200 ly radius has nothing to be a radius around.

      Reported by the squadron owner, who reasonably read the blank section as a broken feature.
      Telling somebody everything is fine is the worst possible response to "why is this empty",
      because it forecloses the question.
    */
    if (kind === 'ops' && activeProjects === 0) {
      return (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Squadron space is everywhere within 200 ly of an active colonisation project, and there
          are none running — so there is nothing to measure from yet. Start a project on{' '}
          <a
            href="/colonisation"
            className="text-[var(--color-brand-cyan-bright)] underline"
          >
            Colonisation
          </a>{' '}
          and the stale stations around it appear here at the next rebuild. The galaxy tail below
          is unaffected and is worth flying in the meantime.
        </p>
      );
    }

    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        {kind === 'ops'
          ? 'Nothing near our projects is past the band right now — squadron space is lit.'
          : 'No stale stations on the tail right now.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by station or system"
        aria-label="Filter bounties by station or system"
        className="w-full max-w-sm rounded-md border border-[var(--color-border-hairline)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-semantic-warning)]"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th className={TH}>Station</th>
              <th className={TH}>System</th>
              <th className={TH}>Type</th>
              <th className={TH}>Pads</th>
              {kind === 'ops' ? <th className={TH}>From ops</th> : null}
              <th className={TH}>Data age</th>
              <th className={`${TH} text-right`}>Points</th>
              {/*
                ★ THE OTHER WAY A BOUNTY GETS CLEARED — SQUADRON OWNER, 2026-08-16 ★

                Measured the morning this shipped: 72 of the 496 bounties on the board were on
                stations with NO MARKET. Flying to one found nothing to report, so nothing could
                refresh it, so it sat at the top of the board for ever — and the next member wasted
                the same evening.

                The filters shipped alongside remove the ones the catalogue knows about. The
                catalogue is a galaxy dump and it is wrong about some stations; the member in the
                cockpit is the only source that can settle it.
              */}
              <th className={`${TH} text-right`}>Nothing there?</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.stationKey}>
                <td className={`${TD} font-medium`}>
                  {r.stationName}
                  {r.jackpot ? (
                    <span className="ml-2 rounded-sm bg-[var(--color-semantic-warning)]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-semantic-warning)]">
                      Jackpot ×2
                    </span>
                  ) : null}
                </td>
                <td className={TD}>{r.systemName === '' ? '—' : r.systemName}</td>
                <td className={TD}>{r.stationType ?? '—'}</td>
                <td className={TD}>{padsOf(r)}</td>
                {kind === 'ops' ? (
                  <td className={TD}>
                    {r.distanceLy === null ? '—' : `${r.distanceLy.toFixed(0)} ly`}
                  </td>
                ) : null}
                <td
                  className={`${TD} ${r.daysStale === null ? 'font-semibold text-[var(--color-semantic-warning)]' : ''}`}
                >
                  {ageOf(r)}
                </td>
                <td className={`${TD} text-right font-mono`}>{r.points.toLocaleString()}</td>
                <td className={`${TD} text-right`}>
                  <NoMarketButton row={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length !== rows.length ? (
        <p className="text-xs text-[var(--color-text-secondary)]">
          {shown.length} of {rows.length} bounties match.
        </p>
      ) : null}
    </div>
  );
}

/**
 * "I flew there and there is no market."
 *
 * ★ IT PAYS THE SAME AS A MARKET REPORT — SQUADRON OWNER, 2026-08-16 ★
 *
 * The member did the work the bounty asked for: they flew out and found out. That the answer was
 * "nothing here" is the fault of the board that sent them, and a report that costs a trip and pays
 * nothing is a report nobody files — which leaves the bounty there for the next member.
 *
 * Confirmed before it fires, because it takes the station off the board for EVERYBODY on one
 * person's word. That is the deal the owner chose — one report from a verified commander — and the
 * price of trusting people is that the button has to say what it does before it does it.
 */
function NoMarketButton({ row }: { row: BountyRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  if (said !== null) {
    return <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{said}</span>;
  }

  const report = async (): Promise<void> => {
    const ok = window.confirm(
      `Report that ${row.stationName} has no market?

` +
        'This takes it off the board for everybody and pays you the ' +
        `${row.points.toLocaleString()} points the bounty was worth. An officer can put it back.`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      const out = await apiPost<{ paid: boolean; points?: number }>('/v1/bounties/no-market', {
        stationKey: row.stationKey,
      });
      // Two different truths. "Somebody beat you to it" is not a failure and must not read as one.
      setSaid(out.paid ? `+${(out.points ?? 0).toLocaleString()}` : 'already reported');
      router.refresh();
    } catch (err) {
      // The hub's own sentence — it names what would make this a yes.
      setSaid(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void report()}
      title="Report that this station has no commodity market. Pays the same as a market report."
      className="rounded border border-[var(--color-border-hairline)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-semantic-warning)] hover:text-[var(--color-semantic-warning)] disabled:opacity-40"
    >
      {busy ? '…' : 'No market'}
    </button>
  );
}

/** The signed-in member's own numbers, and the board's pulse. */
export function RunnerStrip({
  me,
  computedAt,
}: {
  me: {
    monthPoints: number;
    monthClaims: number;
    allTimePoints: number;
    allTimeClaims: number;
  } | null;
  computedAt: string | null;
}) {
  const refreshed = useMemo(() => {
    if (computedAt === null) return null;
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(computedAt)) / 60_000));
    return mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  }, [computedAt]);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]/60 px-4 py-3">
      {me === null ? (
        <span className="text-sm text-[var(--color-text-secondary)]">
          Sign in and pair the companion app to run bounties — credit lands the moment you open a
          market screen.
        </span>
      ) : (
        <>
          <Stat label="This season" value={`${me.monthPoints.toLocaleString()} pts`} />
          <Stat label="Season claims" value={String(me.monthClaims)} />
          <Stat label="All-time" value={`${me.allTimePoints.toLocaleString()} pts`} />
          <Stat label="All-time claims" value={String(me.allTimeClaims)} />
        </>
      )}
      {refreshed !== null ? (
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          Board refreshed {refreshed}
        </span>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
