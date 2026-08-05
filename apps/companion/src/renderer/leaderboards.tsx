import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  LEADERBOARD_BADGES,
  TIER_LADDERS,
  type LeaderboardKey,
} from '@grims/shared/leaderboards';
import type { LeaderboardBoard, LeaderboardEntry } from '../hub-leaderboards.js';
import { Bar, C, Card, Empty, Problem, Section, Stat, Tabs, inputStyle } from './ui.js';
import { useLive } from './use-live.js';

/**
 * The leaderboards, in the app.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "make a new category called leaderboards ... gamify the colonization leaderboard, make badges
 * ect the same way were doing it for databounties ... make this work like the other ones too" —
 * and the standing rule that the app mirrors the website.
 *
 * One component for all three boards, because they ARE one thing three times: the same season
 * table, the same all-time table, the same tier ladder off the shared catalogue. Three page files
 * would be three copies that drift the first time one of them is touched.
 *
 * ★ THE LADDER COMES FROM @grims/shared, NOT FROM HERE ★
 *
 * Thresholds and badge names are read off the same catalogue the hub awards from, so the ladder
 * this page draws and the badge a member actually receives cannot disagree — which is precisely
 * the bug a member would report as "it says Gold and I got nothing".
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly leaderboards: {
      /** One board, season and all-time together. No month means the current season. */
      board(
        board: LeaderboardKey,
        month?: string,
      ): Promise<Answer<{ month: string; board: LeaderboardBoard }>>;
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

/**
 * The last twelve months, newest first, as `YYYY-MM`.
 *
 * Generated rather than fetched: a season is a calendar month, and the hub answers an empty table
 * for a month nobody scored in — which is a true answer, not an error to prevent.
 */
function recentMonths(now: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** `2026-08` → `August 2026`, so the picker reads as seasons rather than as a log format. */
function monthLabel(month: string): string {
  const parsed = Date.parse(`${month}-01T00:00:00Z`);
  if (!Number.isFinite(parsed)) return month;
  return new Date(parsed).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function StandingsTable({
  rows,
  emptyLine,
}: {
  rows: LeaderboardEntry[];
  emptyLine: string;
}): JSX.Element {
  if (rows.length === 0) return <Empty>{emptyLine}</Empty>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={TH}>#</th>
            <th style={TH}>Commander</th>
            <th style={{ ...TH, textAlign: 'right' }}>Points</th>
            <th style={{ ...TH, textAlign: 'right' }}>Claims</th>
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
                {r.claims.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The tier ladder: what lifetime points have earned, and what the next rung costs.
 *
 * The thresholds are deliberately the same on every board — "Gold is 25,000 wherever you earned
 * it" is the sentence the shared catalogue was built around — so this draws the shared ladder and
 * marks where THIS board's lifetime score sits on it.
 */
function TierLadder({
  board,
  lifetimePoints,
}: {
  board: LeaderboardKey;
  lifetimePoints: number;
}): JSX.Element {
  const tiers = LEADERBOARD_BADGES.filter((b) => b.board === board && b.kind === 'tier');
  const next = TIER_LADDERS[board].find((t) => t.at > lifetimePoints) ?? null;
  const held = [...TIER_LADDERS[board]].reverse().find((t) => t.at <= lifetimePoints) ?? null;

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {tiers.map((tier) => {
          const earned = (tier.threshold ?? Infinity) <= lifetimePoints;
          return (
            <span
              key={tier.key}
              title={tier.description}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '999px',
                border: `1px solid ${earned ? C.active : C.hairline}`,
                fontSize: '12px',
                // Earned tiers read as held; the rest read as the road ahead rather than as errors.
                color: earned ? C.text : C.faint,
              }}
            >
              <span aria-hidden="true">{tier.icon}</span>
              <span style={{ textTransform: 'capitalize' }}>
                {tier.key.split('-')[1] ?? tier.name}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: earned ? C.dim : C.faint }}>
                {(tier.threshold ?? 0).toLocaleString()}
              </span>
            </span>
          );
        })}
      </div>

      {next === null ? (
        <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.dim }}>
          Platinum held — the top of the ladder.
        </p>
      ) : (
        <div style={{ marginTop: '8px' }}>
          <Bar done={lifetimePoints} total={next.at} />
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: C.faint }}>
            {(next.at - lifetimePoints).toLocaleString()} lifetime points to{' '}
            <span style={{ textTransform: 'capitalize' }}>{next.tier}</span>
            {held === null ? '' : ` · holding ${held.tier.charAt(0).toUpperCase()}${held.tier.slice(1)}`}
          </p>
        </div>
      )}
    </div>
  );
}

export function LeaderboardPage({ board }: { board: LeaderboardKey }): JSX.Element {
  const [data, setData] = useState<{ month: string; board: LeaderboardBoard } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'season' | 'all'>('season');
  // Empty means "the current season" — the hub decides which month that is and echoes it back.
  const [month, setMonth] = useState('');

  /*
   * ★ THE INTERVAL READS A REF, NOT THE CLOSURE — same reasoning as commodity-detail.tsx ★
   *
   * `useLive` keeps the first render's loader, so a closure reading `month` directly would refetch
   * the mount-time season forever — quietly snapping the picker back sixty seconds after a member
   * chose a month. The ref is rewritten on every render and read at call time.
   */
  const monthRef = useRef(month);
  monthRef.current = month;

  const load = (): void => {
    const chosen = monthRef.current;
    void window.leaderboards.board(board, chosen === '' ? undefined : chosen).then((a) => {
      if (a.ok) {
        setData(a.data);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  useEffect(() => {
    // A fresh board starts from nothing rather than briefly wearing the previous board's numbers.
    setData(null);
    load();
  }, [board, month]);
  // A wingmate's delivery moves these tables — the standings re-read themselves every minute and
  // on window focus, with whichever season is currently chosen.
  useLive(load);

  const b = data?.board ?? null;
  // The hub's echo names the season once it answers; the member's pick fills in until it does.
  const shownMonth = data?.month ?? month;
  const seasonName = shownMonth === '' ? '' : monthLabel(shownMonth);

  return (
    <div>
      <Section title={b?.name ?? 'Leaderboard'}>
        <Card>
          {/* The hub's own sentence for what the points measure — printed, never paraphrased. */}
          <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
            {b === null ? 'Loading the board…' : b.measures}
          </p>
          {b?.me == null ? null : (
            <div style={{ marginTop: '12px', display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
              <Stat label="This season" value={`${b.me.seasonPoints.toLocaleString()} pts`} />
              <Stat
                label="Season rank"
                value={b.me.seasonRank === null ? '—' : `#${b.me.seasonRank}`}
              />
              <Stat label="Lifetime" value={`${b.me.lifetimePoints.toLocaleString()} pts`} />
            </div>
          )}
        </Card>
      </Section>

      {error !== null ? (
        <div style={{ marginBottom: '16px' }}>
          <Problem>{error}</Problem>
        </div>
      ) : null}

      <Section title="The ladder">
        <Card>
          {/*
            Drawn from lifetime points even before the member appears on a table — the ladder is
            what the board pays out in, and a new member's first question is what the rungs cost.
          */}
          <TierLadder board={board} lifetimePoints={b?.me?.lifetimePoints ?? 0} />
        </Card>
      </Section>

      <Section
        title="Standings"
        aside={
          <select
            style={{ ...inputStyle, width: 'auto', padding: '6px 10px' }}
            value={month}
            onChange={(e) => setMonth((e.target as HTMLSelectElement).value)}
            aria-label="Season month"
          >
            <option value="">Current season</option>
            {recentMonths(new Date()).map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        }
      >
        <Card>
          <Tabs
            current={tab}
            onChange={setTab}
            label="Leaderboard period"
            tabs={[
              {
                key: 'season',
                label: seasonName === '' ? 'Season' : `Season · ${seasonName}`,
              },
              { key: 'all', label: 'All-time' },
            ]}
          />
          <div style={{ marginTop: '10px' }}>
            {b === null ? (
              <Empty>Loading standings…</Empty>
            ) : tab === 'season' ? (
              <StandingsTable
                rows={b.season}
                emptyLine="Nobody has scored yet this season. The board is wide open."
              />
            ) : (
              <StandingsTable
                rows={b.allTime}
                emptyLine="Nobody has scored on this board yet. The first name here is remembered for it."
              />
            )}
          </div>
        </Card>
      </Section>
    </div>
  );
}
