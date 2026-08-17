import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  BountyBoard,
  BountyLeaderboard,
  BountyRow,
} from '../hub-bounties.js';
import { Button, C, Card, Empty, Problem, Section, Stat, Tabs, inputStyle } from './ui.js';
import { useLive } from './use-live.js';

/**
 * Data Bounties, in the app.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "create a new page under squadrons called Data bounty's ... turn this into our first offical
 * Data Runner Leaderboard please!" — and the standing rule that the app mirrors the website.
 *
 * This is the surface that matters most, because the app is where a bounty is PAID: the upload it
 * sends when the member opens a market screen is the claim. A runner plans against this list, then
 * flies with the app running — nothing to press, nothing to file.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly bounties: {
      board(): Promise<Answer<BountyBoard>>;
      leaderboard(month?: string): Promise<Answer<BountyLeaderboard>>;
      /** "I flew there and there is no market." Pays what the bounty was worth. */
      noMarket(
        stationKey: string,
      ): Promise<Answer<{ paid: boolean; stationName?: string; points?: number }>>;
    };
  }
}

const TH: JSX.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px 6px 0',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: C.faint,
  whiteSpace: 'nowrap',
};

const TD: JSX.CSSProperties = {
  padding: '7px 10px 7px 0',
  borderTop: `1px solid ${C.hairline}`,
  fontSize: '13px',
  color: C.dim,
  verticalAlign: 'middle',
};

function ageOf(r: BountyRow): string {
  if (r.daysStale === null) return 'never seen';
  if (r.daysStale >= 365) return `${(r.daysStale / 365).toFixed(1)}y dark`;
  return `${r.daysStale}d dark`;
}

function BountyTable({
  rows,
  kind,
  onChanged,
}: {
  rows: BountyRow[];
  kind: 'ops' | 'galaxy';
  /** Re-reads the board, so a station just reported leaves this screen rather than lingering. */
  onChanged: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter(
      (r) => r.stationName.toLowerCase().includes(q) || r.systemName.toLowerCase().includes(q),
    );
  }, [rows, query]);

  if (rows.length === 0) {
    return (
      <Empty>
        {kind === 'ops'
          ? 'Nothing near our projects is past the band right now — squadron space is lit.'
          : 'No stale stations on the tail right now.'}
      </Empty>
    );
  }

  return (
    <div>
      <input
        style={{ ...inputStyle, maxWidth: '260px', marginBottom: '10px' }}
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        placeholder="Filter by station or system"
        aria-label="Filter bounties by station or system"
      />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
          <thead>
            <tr>
              <th style={TH}>Station</th>
              <th style={TH}>System</th>
              {kind === 'ops' ? <th style={TH}>From ops</th> : null}
              <th style={TH}>Data age</th>
              <th style={{ ...TH, textAlign: 'right' }}>Points</th>
              {/*
                ★ THE OTHER WAY A BOUNTY GETS CLEARED — SQUADRON OWNER, 2026-08-16 ★

                72 of the 496 bounties on the board were on stations with NO MARKET. Flying to one
                found nothing to report, so nothing could refresh it, so it stayed for ever and the
                next member wasted the same evening.

                Here rather than only on the website because a member discovers this while sitting
                in the station. Making them alt-tab to a browser is how the report does not get
                filed.
              */}
              <th style={{ ...TH, textAlign: 'right' }}>Nothing there?</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.stationKey}>
                <td style={{ ...TD, color: C.text }}>
                  {r.stationName}
                  {r.jackpot ? (
                    <span
                      style={{
                        marginLeft: '8px',
                        fontSize: '10px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em',
                        color: C.warn,
                      }}
                    >
                      Jackpot ×2
                    </span>
                  ) : null}
                </td>
                <td style={TD}>{r.systemName === '' ? '—' : r.systemName}</td>
                {kind === 'ops' ? (
                  <td style={TD}>{r.distanceLy === null ? '—' : `${r.distanceLy.toFixed(0)} ly`}</td>
                ) : null}
                <td style={{ ...TD, color: r.daysStale === null ? C.warn : C.dim }}>{ageOf(r)}</td>
                <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.text }}>
                  {r.points.toLocaleString()}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <NoMarketButton row={r} onReported={onChanged} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length !== rows.length ? (
        <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.faint }}>
          {shown.length} of {rows.length} bounties match.
        </p>
      ) : null}
    </div>
  );
}

function Standings({ standings }: { standings: BountyLeaderboard }): JSX.Element {
  const [tab, setTab] = useState<'season' | 'all'>('season');
  const rows = tab === 'season' ? standings.season : standings.allTime;

  return (
    <div>
      <Tabs
        current={tab}
        onChange={setTab}
        label="Leaderboard period"
        tabs={[
          { key: 'season', label: `Season ${standings.month}` },
          { key: 'all', label: 'All-time' },
        ]}
      />
      {rows.length === 0 ? (
        <Empty>
          {tab === 'season'
            ? 'Nobody has banked a bounty yet this season. The board is wide open.'
            : 'No bounties have ever been claimed. First name here is remembered for it.'}
        </Empty>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
          <thead>
            <tr>
              <th style={TH}>#</th>
              <th style={TH}>Runner</th>
              <th style={{ ...TH, textAlign: 'right' }}>Points</th>
              <th style={{ ...TH, textAlign: 'right' }}>Claims</th>
              <th style={{ ...TH, textAlign: 'right' }}>Jackpots</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.handle}>
                <td style={{ ...TD, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                <td style={{ ...TD, color: C.text }}>{r.displayName}</td>
                <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {r.points.toLocaleString()}
                </td>
                <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {r.claims}
                </td>
                <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {r.jackpots > 0 ? r.jackpots : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function BountiesPage(): JSX.Element {
  const [board, setBoard] = useState<BountyBoard | null>(null);
  const [standings, setStandings] = useState<BountyLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    void window.bounties.board().then((a) => {
      if (a.ok) {
        setBoard(a.data);
        setError(null);
      } else setError(a.error);
    });
    void window.bounties.leaderboard().then((a) => {
      if (a.ok) setStandings(a.data);
    });
  };

  useEffect(load, []);
  // A bounty a wingmate just claimed must not sit on this screen looking claimable — the board
  // and the standings re-read themselves every minute and on window focus.
  useLive(load);

  return (
    <div>
      <Section title="Data Bounties">
        <Card>
          <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
            Every station here has market data past the ninety-day believability band — or none at
            all. Dock at one with this app running and open the commodities screen: the upload
            refreshes the squadron's data and banks the bounty. Staler pays more, jackpots pay
            double, and each bounty pays exactly once.
          </p>
          {board !== null ? (
            <div style={{ marginTop: '12px', display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
              <Stat label="This season" value={`${board.me.monthPoints.toLocaleString()} pts`} />
              <Stat label="Season claims" value={String(board.me.monthClaims)} />
              <Stat label="All-time" value={`${board.me.allTimePoints.toLocaleString()} pts`} />
            </div>
          ) : null}
        </Card>
      </Section>

      {error !== null ? <Problem>{error}</Problem> : null}

      <Section title="Squadron space — within 200 ly of our active projects">
        <Card>{board === null ? <Empty>Loading the board…</Empty> : <BountyTable rows={board.ops} kind="ops" onChanged={load} />}</Card>
      </Section>

      <Section title="The galaxy tail — the stalest data we hold anywhere">
        <Card>
          {board === null ? <Empty>Loading the board…</Empty> : <BountyTable rows={board.galaxy} kind="galaxy" onChanged={load} />}
        </Card>
      </Section>

      <Section title="Data Runner leaderboard">
        <Card>{standings === null ? <Empty>Loading standings…</Empty> : <Standings standings={standings} />}</Card>
      </Section>
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
 * Confirmed before it fires, because one person's word takes the station off the board for
 * EVERYBODY. That is the deal the owner chose — trusted on one report from a verified commander —
 * and the price of trusting people is that the button says what it does before it does it.
 *
 * Deliberately the same sentence, the same confirmation and the same two outcomes as the website:
 * they are one feature on two screens.
 */
function NoMarketButton({
  row,
  onReported,
}: {
  row: BountyRow;
  onReported: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  if (said !== null) {
    return <span style={{ fontSize: '11px', color: C.dim }}>{said}</span>;
  }

  const report = (): void => {
    const ok = window.confirm(
      `Report that ${row.stationName} has no market?\n\n` +
        'This takes it off the board for everybody and pays you the ' +
        `${row.points.toLocaleString()} points the bounty was worth. An officer can put it back.`,
    );
    if (!ok) return;

    setBusy(true);
    void window.bounties.noMarket(row.stationKey).then((a) => {
      setBusy(false);
      if (a.ok) {
        // Two different truths. "Somebody beat you to it" is not a failure and must not read as one.
        setSaid(a.data.paid ? `+${(a.data.points ?? 0).toLocaleString()}` : 'already reported');
        onReported();
      } else {
        // The hub's own sentence — it names what would make this a yes.
        setSaid(a.error);
      }
    });
  };

  return (
    <Button disabled={busy} onClick={report}>
      {busy ? '…' : 'No market'}
    </Button>
  );
}
