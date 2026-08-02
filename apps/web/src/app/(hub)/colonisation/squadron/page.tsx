import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyProjects } from '../../../../lib/api';
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

export default async function SquadronProjectsPage() {
  const read = await getColonyProjects('squadron');

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

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="SQUADRON PROJECTS"
        subtitle="What the squadron is building, and what it still needs"
      />
      <PageBody
        wide
        lead="Every site the squadron has taken on. Open one to see what it still needs, who has hauled to it, and where to buy the rest."
      >
        <Section title="Squadron projects">
          <ProjectBoard
            projects={squadron}
            emptyMessage="No squadron projects yet. An officer can post one from New project."
          />
        </Section>
      </PageBody>
    </>
  );
}
