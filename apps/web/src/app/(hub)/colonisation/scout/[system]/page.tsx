import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../../../components/hub-page';
import { NoAccess } from '../../../app/no-access';
import { getSystemSurvey, getMe } from '../../../../../lib/api';
import { formatLocal } from '../../../../../lib/time';

/**
 * A proper look at one candidate.
 *
 * ★ WHAT THE SEARCH CANNOT TELL YOU ★
 *
 * The candidate list knows a system is claimable and where its permit is bought. It cannot say
 * whether there is anything worth building on, because for an uninhabited system we hold a name and
 * a position and nothing else. This page is the fetch that answers that, and it caches what it
 * learns so the next member does not pay for it again.
 */
export const metadata: Metadata = {
  title: "System Survey — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function ls(v: number | null): string {
  if (v === null) return '—';
  return v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M Ls`
    : `${Math.round(v).toLocaleString()} Ls`;
}

export default async function SurveyPage({ params }: { params: Promise<{ system: string }> }) {
  const { system } = await params;
  const name = decodeURIComponent(system);
  const read = await getSystemSurvey(name);

  /*
   * The member's own timezone. `toLocaleDateString()` with no zone follows the DEVICE, which is
   * wrong for anyone on a machine set to another country and renders differently before and after
   * hydration. There is a test that fails if a members-area page does it, and it caught this one.
   */
  const me = await getMe();
  const viewerTz = me.user?.timezone ?? 'UTC';

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }

  const back = (
    <p className="m-0 mb-4 text-sm">
      <Link
        href="/colonisation/scout"
        className="text-[var(--color-brand-orange-bright)] underline hover:text-[var(--color-brand-orange)]"
      >
        ← Back to the scout
      </Link>
    </p>
  );

  if (read.state !== 'ok') {
    return (
      <>
        <PageHeader eyebrow="Colonisation" title="SURVEY" subtitle={name} />
        <PageBody wide>
          {back}
          <CouldNotLoad what="the system survey" />
        </PageBody>
      </>
    );
  }

  const s = read.data;

  if (s.notFound !== undefined) {
    return (
      <>
        <PageHeader eyebrow="Colonisation" title="SURVEY" subtitle={name} />
        <PageBody wide>
          {back}
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">
            {/*
              A system nobody has scanned and a system that does not exist look identical from here,
              and neither is our failure — so the sentence covers both honestly.
            */}
            Nothing is held for <strong className="text-[var(--color-text-primary)]">{s.notFound}</strong>.
            Either the name is wrong, or no commander has scanned it and shared the result.
          </p>
        </PageBody>
      </>
    );
  }

  const landable = s.bodies.filter((b) => b.landable);
  const ringed = s.bodies.filter((b) => b.hasRings);

  return (
    <>
      <PageHeader eyebrow="Colonisation" title="SURVEY" subtitle={s.system} />
      <PageBody
        wide
        lead="What is actually in this system: what can be landed on, how far out it sits, and which bodies carry rings."
      >
        {back}

        <Section title="At a glance">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Bodies', s.bodyCount === null ? 'unknown' : String(s.bodyCount)],
              ['Landable', String(s.landableCount)],
              ['Nearest landable', ls(s.nearestLandableLs)],
              ['Ringed bodies', String(s.ringedCount)],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-3"
              >
                <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  {k}
                </span>
                <span className="mt-1 block font-mono text-xl tabular-nums text-[var(--color-text-primary)]">
                  {v}
                </span>
              </div>
            ))}
          </div>

          {/*
            ★ ARRIVAL DISTANCE IS THE THING PEOPLE MISS ★

            A system with thirty landable bodies at 190,000 Ls is not a better system than one with
            six at 800 Ls — it is a worse one, permanently, on every single visit.
          */}
          {s.nearestLandableLs !== null && s.nearestLandableLs > 50_000 ? (
            <p className="m-0 mt-3 rounded border border-[var(--color-semantic-warning)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
              The closest landable body is {ls(s.nearestLandableLs)} from the arrival star — roughly
              a quarter of an hour of supercruise each way, on every visit, for the life of the
              colony.
            </p>
          ) : null}

          {!s.hasSlotData ? (
            <p className="m-0 mt-3 text-sm text-[var(--color-text-secondary)]">
              {/*
                Slot counts cannot be fetched from anywhere — somebody has to read them off the
                colonisation UI. Saying so is what gets them entered.
              */}
              No build slot counts recorded yet. They cannot be fetched from anywhere — open the
              colonisation UI in game and enter them on the planning page, and every plan for this
              system is checked against real numbers from then on.
            </p>
          ) : null}
        </Section>

        <Section title="Bodies">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr>
                  {['Body', 'Type', 'Landable', 'Arrival', 'Gravity', 'Rings', 'Orb slots', 'Surf slots'].map(
                    (h) => (
                      <th
                        key={h}
                        className="border-b border-[var(--color-border-hairline)] px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.14em] font-normal text-[var(--color-text-secondary)]"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {s.bodies.map((b) => (
                  <tr key={b.bodyId}>
                    <td className="border-b border-[var(--color-border-hairline)] px-2 py-1.5 text-[var(--color-text-primary)]">
                      {b.name}
                    </td>
                    <td className="border-b border-[var(--color-border-hairline)] px-2 py-1.5 text-[var(--color-text-secondary)]">
                      {b.subType ?? '—'}
                    </td>
                    <td className="border-b border-[var(--color-border-hairline)] px-2 py-1.5">
                      {b.landable ? (
                        <span className="text-[var(--color-semantic-success)]">yes</span>
                      ) : (
                        <span className="text-[var(--color-text-secondary)]">no</span>
                      )}
                    </td>
                    <td className="border-b border-[var(--color-border-hairline)] px-2 py-1.5 text-right font-mono tabular-nums text-[var(--color-text-secondary)]">
                      {ls(b.distanceLs)}
                    </td>
                    <td className="border-b border-[var(--color-border-hairline)] px-2 py-1.5 text-right font-mono tabular-nums text-[var(--color-text-secondary)]">
                      {b.gravity === null ? '—' : `${b.gravity.toFixed(2)}g`}
                    </td>
                    <td className="border-b border-[var(--color-border-hairline)] px-2 py-1.5 text-[var(--color-text-secondary)]">
                      {b.hasRings ? 'yes' : ''}
                    </td>
                    <td className="border-b border-[var(--color-border-hairline)] px-2 py-1.5 text-right font-mono tabular-nums text-[var(--color-text-secondary)]">
                      {b.orbitalSlots ?? '—'}
                    </td>
                    <td className="border-b border-[var(--color-border-hairline)] px-2 py-1.5 text-right font-mono tabular-nums text-[var(--color-text-secondary)]">
                      {b.surfaceSlots ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="m-0 mt-3 text-xs text-[var(--color-text-secondary)]">
            {landable.length} landable of {s.bodies.length} known · {ringed.length} carry rings
            {s.fetchedAt === null ? '' : ` · surveyed ${formatLocal(s.fetchedAt, viewerTz, { withTime: false })}`}
          </p>
        </Section>
      </PageBody>
    </>
  );
}
