import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../components/hub-page';
import { getMiningRings, getMiningSessions } from '../../../lib/api';
import { RingTable, SessionTable } from './mining-tables';

/**
 * Mining — which rings are paying, and what your own evenings came to.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... it should be ultra feature ritch ... this must meet / exceed ED
 * tools as it works currently!"
 *
 * ★ THE PAGE IS THE PART EDMINER CANNOT HAVE ★
 *
 * The overlays do what a mining tool does: read the rock, count the tonnes. This page does the
 * thing that needs a squadron — every member's prospector limpet is a sample, and a hundred
 * members' rocks are a measurement where one commander's memory is an anecdote.
 *
 * Which is also why it starts empty and fills up. Nothing here can be seeded from an import; it is
 * worth exactly what the squadron has flown, and that is the honest way to present it.
 */
export const metadata: Metadata = {
  title: "Mining — Grim's Squad",
  description:
    'Which rings the squadron has been finding worth mining, measured across every prospector limpet fired.',
};

export const dynamic = 'force-dynamic';

export default async function MiningPage() {
  const [rings, sessions] = await Promise.all([getMiningRings(), getMiningSessions()]);

  return (
    <>
      <PageHeader
        eyebrow="Squadron"
        title="MINING"
        subtitle="The rings we have found worth the limpets, and what your evenings came to"
      />
      <PageBody
        wide
        lead="Every ring below is measured from rocks squadron members actually prospected in the last fortnight — not from a wiki, and not from one commander's good night. Pair the companion app and turn on mining telemetry, and your own rocks join the measurement. Refined tonnes score on the Deep Core board."
      >
        <Section title="Rings the squadron has been working">
          {rings === null ? (
            <CouldNotLoad what="the ring survey" />
          ) : (
            <RingTable rows={rings.rings} />
          )}
        </Section>

        <Section title="Your mining evenings">
          {sessions === null ? (
            <CouldNotLoad what="your mining history" />
          ) : (
            <SessionTable rows={sessions.sessions} />
          )}
        </Section>
      </PageBody>
    </>
  );
}
