import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyProjects } from '../../../../lib/api';
import { ProjectBoard } from './project-board';
import { PostProject } from './post-project';

/**
 * Colonisation.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "colonization ... will allow our members to post their colonization project to the squadron for
 * assistance etc. officers will be able to add Squadron specific and personal project and ladder
 * ranked members will be able to list personal projects."
 *
 * ★ NOINDEX, UNLIKE THE MARKET PAGES BESIDE IT ★
 *
 * The commodities market and the Freight Office are deliberately indexable — they are Frontier's
 * own prices and the owner made them public. This is not: "Squadron projects members-only". A board
 * of what the squadron is building and where is operational, and it stays out of search results
 * whatever a permission check does.
 */
export const metadata: Metadata = {
  title: "Colonisation — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ColonisationPage() {
  const read = await getColonyProjects('all');

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const squadron = read.data.projects.filter((p) => p.owner === 'squadron');
  const personal = read.data.projects.filter((p) => p.owner === 'personal');

  return (
    <>
      <PageHeader
        eyebrow="Logistics & Trade"
        title="COLONISATION"
        subtitle="What the squadron is building, and what it still needs"
      />
      <PageBody
        wide
        lead="Post a construction site and your companion app keeps it up to date — what it still needs, and who has hauled to it."
      >
        <Section title="Squadron projects">
          <ProjectBoard
            projects={squadron}
            emptyMessage="No squadron projects yet. An officer can post one below."
          />
        </Section>

        <Section title="Members' projects">
          <ProjectBoard
            projects={personal}
            emptyMessage="Nobody has posted a project yet. Post yours and the squadron can see what you need."
          />
        </Section>

        {/*
          Offered only to somebody who may actually post. A form that submits and then refuses is a
          worse experience than one that was never drawn — and the server checks COLONY_POST again
          on the write regardless, so this is presentation rather than protection.
        */}
        {read.data.can.post ? (
          <Section title="Post a project">
            <PostProject canPostSquadron={read.data.can.manage} />
          </Section>
        ) : null}
      </PageBody>
    </>
  );
}
