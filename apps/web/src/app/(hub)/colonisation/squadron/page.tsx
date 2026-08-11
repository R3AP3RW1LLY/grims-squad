import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { LiveRefresh } from '../../../../components/live-refresh';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyProjects } from '../../../../lib/api';
import { orderBoard, resolveSort } from '../board-order';
import { BoardSortLinks } from '../board-sort-links';
import { ProjectBoard } from '../project-board';

/**
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "remove colonization from the Logistics and Trade subcategory and create a colonization category
 * that matches up with the companion app please!"
 *
 * The companion has a collapsible Colonisation group with three destinations — New project,
 * Squadron projects, Members' projects — and the website had all three crammed onto one page as
 * sections under Logistics & Trade. Two apps describing one feature with different shapes is a
 * thing members have to learn twice.
 *
 * ★ NOINDEX, UNLIKE THE MARKET PAGES IT USED TO SIT BESIDE ★
 *
 * The commodities market and the Freight Office are deliberately indexable — they are Frontier's
 * own prices and the owner made them public. This is not: "Squadron projects members-only". A board
 * of what the squadron is building and where is operational, and it stays out of search results
 * whatever a permission check does.
 */
export const metadata: Metadata = {
  title: "Squadron projects — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SquadronProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const [read, params] = await Promise.all([getColonyProjects('squadron'), searchParams]);

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  /*
   * Filtered again even though the request asked for one owner. The endpoint's filter is the one
   * that matters, but a page titled "Squadron projects" that could render a personal one because a
   * parameter was dropped somewhere is a lie this costs one line to make impossible.
   */
  const squadron = read.data.projects.filter((p) => p.owner === 'squadron');

  /*
   * Ranked for the member reading it — nearest, most urgent, closest to done, or gone quiet. The
   * ranking itself is shared with the companion so the two boards cannot disagree about which build
   * wants somebody most. See board-order.ts.
   */
  const sort = resolveSort(params.sort);
  const board = orderBoard(squadron, read.data.you ?? null, sort);

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="SQUADRON PROJECTS"
        subtitle="What the squadron is building, and what it still needs"
      />
      {/*
        ★ A BOARD LEFT OPEN GOES QUIETLY WRONG ★

        Progress moves whenever ANY member hauls, and the companion re-reads both boards every
        sixty seconds for exactly that reason. The website only ever refreshed on a manual reload,
        so a board open on a second monitor showed tonnages that were true an hour ago.

        `telemetry` is the right signal rather than a new one: it fires when a device uploads its
        journal, and a colonisation delivery IS a journal upload.
      */}
      <LiveRefresh types={['telemetry']} />
      <PageBody
        wide
        lead="Every site the squadron has taken on. Open one to see what it still needs, who has hauled to it, and where to buy the rest."
      >
        <Section title={`Squadron projects (${squadron.length})`}>
          <BoardSortLinks
            basePath="/colonisation/squadron"
            current={sort}
            positionless={board.positionless}
          />
          <ProjectBoard
            projects={board.projects}
            notes={board.notes}
            emptyMessage="No squadron projects yet. An officer can post one from Start New Project."
          />
        </Section>
      </PageBody>
    </>
  );
}
