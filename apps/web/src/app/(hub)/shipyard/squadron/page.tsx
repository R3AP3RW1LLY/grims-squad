import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { getSharedBuilds } from '../../../../lib/api';
import { BuildBoard } from '../build-board';

export const metadata: Metadata = {
  title: "Squadron builds — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * What the squadron is flying.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "add a Squadron page and Public build pages to the Shipyard category please."
 *
 * ★ THIS BOARD INCLUDES THE PUBLIC ONES ★
 *
 * A build published to the whole internet is, necessarily, also visible to the squadron. Filtering
 * this page to `visibility = 'squadron'` exactly would hide the most widely shared builds from the
 * members they were shared with, which reads as a bug and is one.
 */
export default async function SquadronBuildsPage() {
  const read = await getSharedBuilds('squadron');

  return (
    <>
      <PageHeader
        eyebrow="Shipyard"
        title="SQUADRON BUILDS"
        subtitle="What people here are flying, and how they fitted it"
      />
      <PageBody
        wide
        lead="Every build a member has shared. Open one to see the whole loadout and what it does — and to take it into the outfitter and change it for yourself."
      >
        <Section title="Shared with the squadron">
          {read === null ? (
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              The build list could not be loaded. Refresh, or tell an officer if it keeps happening.
            </p>
          ) : (
            <BuildBoard
              builds={read.builds}
              emptyMessage="Nobody has shared a build yet. Fit one in the outfitter and choose who may see it — yours would be the first."
            />
          )}
        </Section>
      </PageBody>
    </>
  );
}
