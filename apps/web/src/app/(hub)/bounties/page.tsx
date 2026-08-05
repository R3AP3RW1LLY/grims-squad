import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../components/hub-page';
import { getBounties, getBountyLeaderboard } from '../../../lib/api';
import { BountyBoardTables, RunnerStrip } from './bounty-board';
import { LeaderboardTables } from './leaderboard';

/**
 * Data Bounties — the board and the Data Runner leaderboard.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "create a new page under squadrons called Data bounty's and create a list of all stations and
 * systems we need to dock at to shore up market data etc that is unknown or stale! any time
 * something goes stale it should automatically be added to the list, turn this into our first
 * offical Data Runner Leaderboard please! gamify this too"
 *
 * The mechanics live elsewhere — the worker rebuilds the board half-hourly, the companion upload
 * pays claims the moment a member docks and opens the market screen. This page is the shop window:
 * what is worth flying to, and who has been flying.
 */
export const metadata: Metadata = {
  title: "Data Bounties — Grim's Squad",
  description:
    'Stations whose market data has gone dark. Dock, open the market screen with the companion app paired, and the points are yours.',
};

export const dynamic = 'force-dynamic';

export default async function BountiesPage() {
  const [board, standings] = await Promise.all([getBounties(), getBountyLeaderboard()]);

  return (
    <>
      <PageHeader
        eyebrow="Squadron"
        title="DATA BOUNTIES"
        subtitle="The stations we are flying blind on, and the runners lighting them up"
      />
      <PageBody
        wide
        lead="Every station here has market data past the ninety-day believability band — or none at all. Dock at one with the companion app paired and open the commodities screen: the upload refreshes the squadron's data and banks the bounty automatically. Staler pays more, jackpots pay double, and each bounty pays exactly once."
      >
        <RunnerStrip me={board?.me ?? null} computedAt={board?.computedAt ?? null} />

        <Section title="Squadron space — within 200 ly of our active projects">
          {board === null ? (
            <CouldNotLoad what="the bounty board" />
          ) : (
            <BountyBoardTables
              rows={board.ops}
              kind="ops"
              activeProjects={board.activeProjects}
            />
          )}
        </Section>

        <Section title="The galaxy tail — the stalest data we hold anywhere">
          {board === null ? (
            <CouldNotLoad what="the bounty board" />
          ) : (
            <BountyBoardTables rows={board.galaxy} kind="galaxy" />
          )}
        </Section>

        <Section title="Data Runner leaderboard">
          {standings === null ? (
            <CouldNotLoad what="the leaderboard" />
          ) : (
            <LeaderboardTables standings={standings} />
          )}
        </Section>
      </PageBody>
    </>
  );
}
