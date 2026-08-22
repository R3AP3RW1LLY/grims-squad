import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../../components/hub-page';
import { NoAccess } from '../../app/no-access';
import { getScout } from '../../../../lib/api';
import { sweepNotice } from '@grims/shared/colony-scout';
import { ScoutForm } from './scout-form';
import { CandidateList } from './candidate-list';

/**
 * Finding the next system worth claiming.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool into our web and companion app that literally does what we just did here for
 * this planning and research and system selection?"
 *
 * ★ THIS IS THE STEP BEFORE PLANNING ★
 *
 * Planning lays out a system somebody has already chosen. This is the choosing: which systems can
 * be claimed at all, where the colonisation ship is bought, and — the part that is permanent —
 * whose power that purchase extends.
 *
 * ★ EVERYTHING IS IN THE URL ★
 *
 * The same rule the Freight Office follows. A search is a link, so "here is what I found near the
 * office" can be pasted to somebody else and open the same list.
 */
export const metadata: Metadata = {
  title: "Colonisation Scout — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default async function ScoutPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const anchor = one(sp['anchor']).trim();
  const range = one(sp['range']).trim();
  const prefer = one(sp['prefer']).trim();

  /*
   * Nothing is searched until somebody names an anchor. A sweep costs a galaxy query and several
   * hundred systems, so a page that ran one on arrival would feel slow every single time it opened.
   */
  const read = anchor === '' ? null : await getScout(anchor, { range, prefer });

  /*
   * Computed once, here, because it decides the HEADING as well as the banner. Working it out in
   * two places is how the two end up disagreeing — a title saying "nothing claimable" above a
   * notice saying the search never ran.
   */
  const notice =
    read?.state === 'ok'
      ? sweepNotice(read.data.incomplete ?? null, read.data.candidates.length)
      : null;

  if (read?.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="SCOUT"
        subtitle="Find the next system worth claiming"
      />
      <PageBody
        wide
        lead="Name a system to search around — usually the station you buy colonisation ships from, or a colony you already hold. Every candidate comes back with where its permit is bought and whose power that extends."
      >
        <Section title="Search">
          <ScoutForm query={{ anchor, range, prefer }} />
        </Section>

        {read === null ? null : read.state !== 'ok' ? (
          <Section title="Candidates">
            <CouldNotLoad what="the colonisation scout" />
          </Section>
        ) : read.data.unknownAnchor !== null ? (
          <Section title="Candidates">
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              {/*
                Named back, so a typo is obvious. An empty list would look like a real answer.
              */}
              We hold no coordinates for{' '}
              <strong className="text-[var(--color-text-primary)]">{read.data.unknownAnchor}</strong>
              . Check the spelling — it has to match the game.
            </p>
          </Section>
        ) : (
          <Section
            title={
              /*
               * ★ "NOTHING CLAIMABLE" IS A CLAIM ABOUT THE GALAXY — SQUADRON OWNER, 2026-08-22 ★
               *
               * "the scouting system in the colonization module is now no longer finding anything"
               *
               * It was finding things. The sweep was timing out, and a timed-out sweep hands back
               * the same empty list an empty region does — so this heading asserted there was
               * nothing out there, on a search that never completed.
               *
               * The heading has to stop making that claim before the notice below is worth
               * anything: a warning under a confident title reads as a footnote.
               */
              read.data.candidates.length === 0
                ? notice === null
                  ? 'Nothing claimable in range'
                  : 'Search did not finish'
                : `${read.data.candidates.length} claimable near ${read.data.anchor?.system ?? anchor}`
            }
          >
            {notice === null ? null : (
              <p
                className="m-0 mb-3 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)] px-4 py-3 text-sm text-[var(--color-semantic-warning)]"
                role="status"
              >
                {notice}
              </p>
            )}
            <CandidateList result={read.data} />
          </Section>
        )}
      </PageBody>
    </>
  );
}
