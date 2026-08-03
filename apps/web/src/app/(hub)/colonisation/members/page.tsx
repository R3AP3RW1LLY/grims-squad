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
  title: "Members' projects — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function MemberProjectsPage() {
  const read = await getColonyProjects('personal');

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const personal = read.data.projects.filter((p) => p.owner === 'personal');

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="MEMBERS’ PROJECTS"
        subtitle="Builds members have asked the squadron for help with"
      />
      <PageBody
        wide
        lead="Somebody’s own construction site, posted so the squadron can see what it needs. Open one to take a commodity on."
      >
        <Section title="Members’ projects">
          <ProjectBoard
            projects={personal}
            emptyMessage="Nobody has posted a project yet. Post yours from Start New Project and the squadron can see what you need."
          />
        </Section>
      </PageBody>
    </>
  );
}
