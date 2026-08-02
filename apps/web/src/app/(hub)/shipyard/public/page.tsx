import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { getSharedBuilds } from '../../../../lib/api';
import { BuildBoard } from '../build-board';

/**
 * ★ THE ONE SHIPYARD PAGE THAT IS MEANT TO BE FOUND ★
 *
 * Squadron owner, 2026-08-01: "the public page must also be visible along with the builds in them
 * to anyone not signed in from the homepage."
 *
 * So `robots` is NOT set to noindex here, unlike every other page under this layout. These builds
 * were deliberately published to the open web by the people who made them; a page that is public
 * but unlisted would be a strange half-measure — and the members who chose `public` chose it over
 * `squadron`, which already covers "anybody who might plausibly find this".
 */
export const metadata: Metadata = {
  title: "Public ship builds — Grim's Squad",
  description:
    "Elite Dangerous ship builds published by the commanders of Grim's Squad — full loadouts, jump ranges, shields and costs.",
};

export const dynamic = 'force-dynamic';

export default async function PublicBuildsPage() {
  const read = await getSharedBuilds('public');

  return (
    <>
      <PageHeader
        eyebrow="Shipyard"
        title="PUBLIC BUILDS"
        subtitle="Ships the squadron has published for anyone to use"
      />
      <PageBody
        wide
        lead="These are shared openly by the commanders who fly them. No account needed — open one to see the full loadout, what it costs, and what it does."
      >
        <Section title="Published by the squadron">
          {read === null ? (
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              The build list could not be loaded. Try again in a moment.
            </p>
          ) : (
            <BuildBoard
              builds={read.builds}
              emptyMessage="No builds have been published publicly yet."
            />
          )}
        </Section>
      </PageBody>
    </>
  );
}
