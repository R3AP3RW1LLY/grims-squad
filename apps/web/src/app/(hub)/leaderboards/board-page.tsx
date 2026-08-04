import type { Metadata } from 'next';
import {
  LEADERBOARDS,
  LEADERBOARD_BADGES,
  TIER_LADDERS,
  type LeaderboardDef,
  type LeaderboardKey,
} from '@grims/shared';
import { PageBody, Section, CouldNotLoad } from '../../../components/hub-page';
import { getLeaderboards, type LeaderboardEntry, type LeaderboardStandings } from '../../../lib/api';

/**
 * One leaderboard: the running season, the all-time roll, and the tier ladder.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "make a new category called leaderboards ... gamify the colonization leaderboard, make badges ect
 * the same way were doing it for databounties ... then we also need to make a leaderboard and
 * gamify it for Trade routes make this work like the other ones too."
 *
 * ★ ONE COMPONENT, THREE THIN ROUTES ★
 *
 * The boards differ only in DATA — which the shared catalogue and the API both already express —
 * so three copies of this page would be three places for the table layout to drift apart.
 *
 * The routes are STATIC (`/leaderboards/bounties` and siblings, each a one-line page.tsx) rather
 * than a `[board]` segment, and that is not a style choice: the API's nav guard resolves every
 * sidebar href against a literal `page.tsx` on disk and deliberately refuses to wave dynamic
 * segments through (see nav.spec.ts, "no nav item points at a route that does not exist"). Three
 * named directories is what makes three sidebar entries provably real.
 *
 * ★ SEASON FIRST, SAME AS THE DATA BOUNTY BOARD ★
 *
 * Monthly seasons exist so a member joining in November is not staring up at totals accumulated
 * since August — the running month is the race everyone is actually in. All-time is the honour
 * roll behind it, and the tier ladder underneath says what the lifetime totals are FOR.
 */

const TH =
  'py-3 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

/**
 * What a scoring event is CALLED on each board.
 *
 * The API's field is `claims` everywhere, which is right for the wire and wrong for a column
 * header: a Colony Builder has never "claimed" anything — they delivered it. Keyed by board so an
 * unlisted future board falls back to the wire's own word rather than borrowing another board's.
 */
const CLAIMS_NOUN: Partial<Record<LeaderboardKey, string>> = {
  bounties: 'Claims',
  colony: 'Deliveries',
  trade: 'Sales',
};

/** `YYYY-MM`, strictly — anything else in the query string is ignored rather than forwarded. */
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/** The month `delta` months away from `month`, computed in UTC — the clock the seasons run on. */
function shiftMonth(month: string, delta: number): string {
  const at = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function boardDef(key: LeaderboardKey): LeaderboardDef {
  const def = LEADERBOARDS.find((b) => b.key === key);
  /*
   * Unreachable while the thin routes and the catalogue agree — each route names a key the union
   * forces to exist here. Thrown rather than soft-rendered because a page for a board the
   * catalogue does not know is a build error, not a runtime condition to design copy for.
   */
  if (def === undefined) throw new Error(`No leaderboard definition for '${key}'.`);
  return def;
}

/** Page metadata for one board — used by each thin route, so the titles cannot drift. */
export function boardMetadata(key: LeaderboardKey): Metadata {
  const def = boardDef(key);
  return {
    title: `${def.name} leaderboard — Grim's Squad`,
    description: def.measures,
  };
}

/**
 * The shared `PageHeader`'s props for one board.
 *
 * The header itself is rendered by each thin route rather than in here — `hub-page.spec` holds
 * every rendering page.tsx to the shared header, and it is right to: the page is where somebody
 * looking for the header goes. One helper computing the props is what keeps three headers being
 * one design.
 */
export function boardHeaderProps(key: LeaderboardKey): {
  eyebrow: string;
  title: string;
  subtitle: string;
} {
  return {
    eyebrow: 'Leaderboards',
    title: boardDef(key).name.toUpperCase(),
    subtitle: 'Season standings, the all-time roll, and the tier ladder',
  };
}

export async function LeaderboardBoardBody({
  boardKey,
  searchParams,
}: {
  boardKey: LeaderboardKey;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const def = boardDef(boardKey);

  const sp = await searchParams;
  const rawMonth = typeof sp['month'] === 'string' ? sp['month'] : undefined;
  const askedMonth = rawMonth !== undefined && MONTH_RE.test(rawMonth) ? rawMonth : undefined;

  const data = await getLeaderboards(askedMonth);
  const standings = data?.boards.find((b) => b.key === def.key) ?? null;

  /*
   * The month the tables actually describe. The response's own echo wins so a mislabelled query
   * cannot mislabel a table; the request's month covers the picker while the API is unreachable.
   */
  const shownMonth = data?.month ?? askedMonth ?? currentMonth();

  return (
    <PageBody wide lead={def.measures}>
      <MeStrip standings={standings} pointsNoun={def.pointsNoun} />

      <Section title={`Season ${shownMonth}`}>
        <MonthPicker board={def.key} shownMonth={shownMonth} />
        {standings === null ? (
          <CouldNotLoad what="the season standings" />
        ) : (
          <StandingsTable
            rows={standings.season}
            claimsNoun={CLAIMS_NOUN[def.key] ?? 'Claims'}
            empty={`Nobody has scored on the ${def.name} board this season. The month is wide open.`}
          />
        )}
      </Section>

      <Section title="All-time">
        {standings === null ? (
          <CouldNotLoad what="the all-time standings" />
        ) : (
          <StandingsTable
            rows={standings.allTime}
            claimsNoun={CLAIMS_NOUN[def.key] ?? 'Claims'}
            empty={`Nobody has ever scored on the ${def.name} board. The first name here is remembered for it.`}
          />
        )}
      </Section>

      <Section
        title="The tier ladder"
        description="Lifetime points, whichever season they were earned in. The thresholds are the same on every board — Gold is 25,000 wherever you earned it — and each tier pays out as a badge on your dashboard and beside your forum posts."
      >
        <TierLadder boardKey={def.key} lifetimePoints={standings?.me?.lifetimePoints ?? null} />
      </Section>
    </PageBody>
  );
}

/**
 * The season selector: previous month, the month on screen, and the way back.
 *
 * Links rather than a control with state, so a season is an ADDRESS — a member arguing about
 * March's standings in Discord pastes a URL and everybody sees March. History runs all the way
 * back; a month before the boards existed simply shows its empty table, which is the true answer.
 * Forward stops at the running month, because a season that has not happened has no standings to
 * show and a link to it would promise otherwise.
 */
function MonthPicker({ board, shownMonth }: { board: LeaderboardKey; shownMonth: string }) {
  const now = currentMonth();
  const prev = shiftMonth(shownMonth, -1);
  const next = shownMonth < now ? shiftMonth(shownMonth, 1) : null;

  const LINK =
    'rounded-md border border-[var(--color-border-hairline)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-semantic-warning)]/50 hover:text-[var(--color-text-primary)]';

  return (
    <nav aria-label="Season" className="mb-4 flex flex-wrap items-center gap-2">
      <a href={`/leaderboards/${board}?month=${prev}`} className={LINK}>
        ← {prev}
      </a>
      <span
        aria-current="true"
        className="rounded-md border border-[var(--color-semantic-warning)] px-3 py-1.5 font-mono text-xs text-[var(--color-semantic-warning)]"
      >
        {shownMonth}
      </span>
      {next !== null && (
        /* The running month gets the bare URL — one canonical address for "this season". */
        <a
          href={next === now ? `/leaderboards/${board}` : `/leaderboards/${board}?month=${next}`}
          className={LINK}
        >
          {next} →
        </a>
      )}
    </nav>
  );
}

/** One standings table. The rank is the row's position — the API sends the rows already ordered. */
function StandingsTable({
  rows,
  claimsNoun,
  empty,
}: {
  rows: readonly LeaderboardEntry[];
  claimsNoun: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={TH}>#</th>
            <th className={TH}>Runner</th>
            <th className={`${TH} text-right`}>Points</th>
            <th className={`${TH} text-right`}>{claimsNoun}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.handle}>
              <td className={`${TD} font-mono text-xs`}>{i + 1}</td>
              <td className={`${TD} font-medium`}>{r.displayName}</td>
              <td className={`${TD} text-right font-mono`}>{r.points.toLocaleString()}</td>
              <td className={`${TD} text-right font-mono`}>{r.claims.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The signed-in member's own line, above the tables — the same strip the Data Bounty board opens
 * with, because "how am I doing" is the question a member opens a leaderboard to answer.
 */
function MeStrip({
  standings,
  pointsNoun,
}: {
  standings: LeaderboardStandings | null;
  pointsNoun: string;
}) {
  /* Nothing to describe while the standings are unreachable — the sections below say so. */
  if (standings === null) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]/60 px-4 py-3">
      {standings.me === null ? (
        <span className="text-sm text-[var(--color-text-secondary)]">
          Nothing scored on this board yet — your line appears here with your first points.
        </span>
      ) : (
        <>
          <MeStat
            label="Season rank"
            value={standings.me.seasonRank === null ? '—' : `#${standings.me.seasonRank}`}
          />
          <MeStat
            label="This season"
            value={`${standings.me.seasonPoints.toLocaleString()} ${pointsNoun}`}
          />
          <MeStat
            label="Lifetime"
            value={`${standings.me.lifetimePoints.toLocaleString()} ${pointsNoun}`}
          />
        </>
      )}
    </div>
  );
}

function MeStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

/**
 * The board's own ladder — Courier to Trade Baron, Bricklayer to Worldshaper — from the shared
 * catalogue: the same defs the awarding sweep walks, so the ladder on screen cannot promise a
 * threshold the sweep will not pay, and every rank NAME is unique across boards (the owner's
 * instruction: a rank must say which board it was earned on).
 */
function TierLadder({
  boardKey,
  lifetimePoints,
}: {
  boardKey: LeaderboardKey;
  /** Null while the standings are unreachable — the ladder still shows what the tiers take. */
  lifetimePoints: number | null;
}) {
  const tiers = TIER_LADDERS[boardKey].map(({ tier, at }) => ({
    tier,
    at,
    badge: LEADERBOARD_BADGES.find((b) => b.key === `${boardKey}-${tier}`) ?? null,
  }));

  return (
    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {tiers.map(({ tier, at, badge }) => {
        const earned = lifetimePoints !== null && lifetimePoints >= at;
        return (
          <li
            key={tier}
            className={`rounded border px-4 py-3 ${
              earned
                ? 'border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)]'
                : 'border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                {tier}
              </p>
              {earned && (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-semantic-warning)]">
                  Earned
                </span>
              )}
            </div>
            <p className="mt-1 text-2xl leading-none">
              <span aria-hidden="true" className="mr-2">
                {badge?.icon ?? '🎖️'}
              </span>
              <span
                className="align-middle text-lg text-[var(--color-text-primary)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {at.toLocaleString()}
              </span>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {badge?.description ?? `${at.toLocaleString()} lifetime points on this board.`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
