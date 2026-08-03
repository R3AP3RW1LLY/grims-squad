import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getBuildTypes } from '../../../../lib/api';
import { BuildTypeTable } from './build-type-table';

/**
 * Every kind of construction site, and what it costs.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "ensure our baseline colonization setup we have now meets and exceeds the current feature and
 * system of raven colonial."
 *
 * This is the question a project page structurally cannot answer. A project has no needs until
 * somebody physically flies to the site and docks — so "what will a Coriolis cost me" was
 * unanswerable at exactly the moment it is worth asking, which is before you commit.
 */
export const metadata: Metadata = {
  title: "Build types — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BuildTypesPage() {
  const read = await getBuildTypes();

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const types = read.data.buildTypes;
  const observed = types.filter((t) => t.source === 'observed').length;

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="BUILD TYPES"
        subtitle="What every kind of construction site asks for"
      />
      <PageBody
        wide
        lead="Pick one to see its full bill of materials and what it would cost to buy near you."
      >
        <Section title="Every build type">
          <BuildTypeTable types={types} />
        </Section>

        {/*
          ★ WHERE THE NUMBERS COME FROM, SAID OUT LOUD ★

          Frontier publishes none of this. Every figure in circulation was gathered by players out
          of Frontier's own forum threads, and the lists disagree at the edges — so a page that
          presented them as fact would be overstating what anybody actually knows.

          The counter is real and it moves: a build type stops being a community figure the moment
          one of our own sites matches it exactly, commodity for commodity.
        */}
        <Section title="How much of this is measured">
          <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
            <p className="m-0 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Frontier publishes none of these figures. They were gathered by players and they
              disagree at the edges, so every row says where its numbers came from.
            </p>
            <p className="m-0 mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">
                {observed} of {types.length}
              </strong>{' '}
              have been confirmed against one of the squadron&rsquo;s own construction sites — the
              whole bill of materials matching, commodity for commodity. That number goes up every
              time somebody docks at a site we have not seen before.
            </p>
          </div>
        </Section>
      </PageBody>
    </>
  );
}
