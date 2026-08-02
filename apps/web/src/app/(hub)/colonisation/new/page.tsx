import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyProjects } from '../../../../lib/api';
import { PostProject } from '../post-project';

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
  title: "New colonisation project — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  /*
   * Read for the RIGHTS, not for the list. `getColonyProjects` is what says whether this member may
   * post at all and whether they may post on the squadron's behalf — the same call the boards make,
   * so this page cannot reach a different answer from the one beside it.
   */
  const read = await getColonyProjects('all');

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="NEW PROJECT"
        subtitle="Post a construction site so the squadron can help build it"
      />
      <PageBody lead="Post the site and your companion app keeps it up to date from then on — what it still needs, and who has hauled to it.">
        {/*
          Drawn only for somebody who may actually post. A form that submits and then refuses is
          worse than one that was never drawn — and the server checks COLONY_POST again on the write
          regardless, so this is presentation rather than protection.

          When they may not, the page says what it is and what they can still do, rather than
          rendering an empty shell.
        */}
        <Section title="Post a project">
          {read.data.can.post ? (
            <PostProject canPostSquadron={read.data.can.manage} />
          ) : (
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              Posting a colonisation project belongs to a higher rank. The squadron and members’
              boards are still yours to read and haul to.
            </p>
          )}
        </Section>
      </PageBody>
    </>
  );
}
