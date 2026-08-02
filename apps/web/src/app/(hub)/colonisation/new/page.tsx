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
        {/*
          ★ HOW TO START ONE — SQUADRON OWNER, 2026-08-02 ★

          "add a how to start a new project box to this page on both the website and app page for
          new projects please."

          Written as what happens FOR you rather than as steps to perform, because most of it is
          handled without being asked — and that is both the least obvious part and the reason to
          bother running the companion app at all.
        */}
        <Section title="How to start a project">
          <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
            <ol className="m-0 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              <li>
                Fly to your construction site and dock with the companion app running. It reads the
                depot the game reports and fills the form in — name, system, station and market id.
              </li>
              <li>
                Post it from the app, or fill the form below in by hand if you are away from the
                game, and choose whether it is the squadron&rsquo;s build or your own.
              </li>
              <li>
                From then on it keeps itself current. Every time anyone with the app docks there,
                what the site still needs is updated, and every delivery is recorded against the
                commander who made it.
              </li>
              <li>
                Members join the build and take on commodities, and the shopping list works out
                where to buy what is left and what it will cost.
              </li>
            </ol>
          </div>
        </Section>

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
