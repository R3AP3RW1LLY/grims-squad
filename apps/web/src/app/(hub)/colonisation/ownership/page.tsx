import type { Metadata } from 'next';
import { getStationClaims } from '../../../../lib/api';
import { PageHeader, PageBody, Panel, CouldNotLoad } from '../../../../components/hub-page';
import { NoAccess } from '../../app/no-access';
import { ClaimsPanel } from './claims-panel';

export const metadata: Metadata = {
  title: "Station ownership — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

/**
 * Which stations the squadron holds.
 *
 * ★ A SCREEN FOR A TABLE THAT HAD NONE ★
 *
 * `station_ownership_claims` shipped with the buy-location ordering and is read on every
 * where-to-buy query. Nothing wrote to it — no route, no service method, no page — so the officer
 * override its schema describes at length could not be exercised by anybody.
 *
 * Officers only, because a claim changes where the whole squadron is sent to shop.
 */
export default async function StationOwnershipPage() {
  const read = await getStationClaims();

  if (read.state === 'forbidden') {
    return <NoAccess what="station ownership" permission="COLONY_MANAGE" />;
  }
  if (read.state !== 'ok') {
    return <CouldNotLoad what="the squadron's station claims" />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="STATION OWNERSHIP"
      />
      <PageBody
        lead={
          "Which stations count as ours when the platform decides where to send somebody shopping. Stations the squadron built through colonisation already count without a claim — this is for the ones we hold but did not build here, and for correcting the derived answer when it is wrong."
        }
        rail={
          <Panel title="How it is used">
            <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Where-to-buy leads with the build&rsquo;s own system, then the squadron&rsquo;s
              stations, then a member&rsquo;s, then squadron space, then everywhere else. A claim
              here moves a station into the second or third of those bands, and each stop on the
              route says which band it is in.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Members can switch the list to <strong>Closest</strong>, which sorts by distance and
              uses ownership only to break a tie — so a claim guides the default rather than forcing
              a long trip on anybody.
            </p>
          </Panel>
        }
      >
        <ClaimsPanel claims={read.data.claims} />
      </PageBody>
    </>
  );
}
