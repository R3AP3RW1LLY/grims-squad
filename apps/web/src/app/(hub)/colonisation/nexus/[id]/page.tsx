import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, PageBody, Section } from '../../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../../app/no-access';
import { getColonyBlocNexus, type ColonyBlocNexus } from '../../../../../lib/api';
import { BlocSystems } from './bloc-systems';

/**
 * What one group of systems can feed each other.
 *
 * ★ GAPS LEAD — THE SAME ORDERING EVERY PANEL ON THIS PLATFORM USES ★
 *
 * "Four systems feed each other" is pleasant and changes nothing. "Nothing you are building
 * produces Beryllium, so every tonne is a haul from outside — permanently" is the sentence somebody
 * acts on, so it goes first.
 *
 * ★ A REAL ROUTE AND A PAPER ONE ARE NEVER DRAWN THE SAME ★
 *
 * A group is routinely a mixture: one station finished and selling, three still being hauled to.
 * Presenting a predicted route identically to a real one would send somebody to a station that does
 * not exist, and a wasted trip is measured in hours.
 */
export const metadata: Metadata = {
  title: "Nexus — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const CELL = 'px-3 py-2 text-sm text-[var(--color-text-primary)]';
const HEAD =
  'px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';

/** How well we know what a system trades, said in a member's words rather than in ours. */
function BasisBadge({ basis }: { basis: 'measured' | 'predicted' | 'unknown' }) {
  const label =
    basis === 'measured' ? 'Standing' : basis === 'predicted' ? 'Planned' : 'Nothing planned';
  const tone =
    basis === 'measured'
      ? 'border-[var(--color-brand-cyan-bright)] text-[var(--color-brand-cyan-bright)]'
      : basis === 'predicted'
        ? 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)]'
        : 'border-[var(--color-semantic-hostile)] text-[var(--color-semantic-hostile)]';

  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] ${tone}`}
    >
      {label}
    </span>
  );
}

function Report({ nexus }: { nexus: ColonyBlocNexus }) {
  const { report } = nexus;

  if (report.systems < 2) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        {/*
          Said plainly. A group of one has nothing to compare against, and an empty table is what a
          failed load looks like too.
        */}
        A group needs more than one system before anything can feed anything else. Add another below.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* The sentences first, then the tables that back them. */}
      <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4">
        {nexus.summary.map((line) => (
          <p key={line} className="text-sm text-[var(--color-text-primary)]">
            {line}
          </p>
        ))}
      </div>

      {report.gaps.length === 0 ? null : (
        <div>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-semantic-hostile)]">
            Nothing here produces these
          </h3>
          <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
            A permanent haul from outside the group unless the plans change — not just during
            construction.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border-hairline)]">
                  <th className={HEAD}>Commodity</th>
                  <th className={HEAD}>Wanted by</th>
                </tr>
              </thead>
              <tbody>
                {report.gaps.map((gap) => (
                  <tr key={gap.commodity} className="border-b border-[var(--color-border-hairline)]">
                    <td className={CELL}>{gap.commodity}</td>
                    <td className={`${CELL} text-[var(--color-text-secondary)]`}>
                      {gap.wantedBy.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.links.length === 0 ? null : (
        <div>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            These can be supplied from inside the group
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border-hairline)]">
                  <th className={HEAD}>Commodity</th>
                  <th className={HEAD}>From</th>
                  <th className={HEAD}>To</th>
                  <th className={HEAD}>Flyable</th>
                </tr>
              </thead>
              <tbody>
                {report.links.map((link) => (
                  <tr
                    key={`${link.commodity}-${link.from}-${link.to}`}
                    className="border-b border-[var(--color-border-hairline)]"
                  >
                    <td className={CELL}>{link.commodity}</td>
                    <td className={`${CELL} font-mono text-xs`}>{link.from}</td>
                    <td className={`${CELL} font-mono text-xs`}>{link.to}</td>
                    <td className={CELL}>
                      {/*
                        The whole reason this column exists. "Tonight" means both ends are real,
                        standing stations; anything else is a route that exists on paper only, and
                        flying it would waste an evening.
                      */}
                      {link.flyableNow ? (
                        <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--color-brand-cyan-bright)]">
                          Tonight
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--color-text-secondary)]">
                          Once built
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.surplus.length === 0 ? null : (
        <div>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Produced with no buyer here
          </h3>
          <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
            {/*
              Not a fault, and said so. Selling outward is often the whole point of building a
              system — this is here because two systems both making the same thing and neither
              buying it is worth noticing before the second one is built.
            */}
            What the group sells to the wider galaxy.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border-hairline)]">
                  <th className={HEAD}>Commodity</th>
                  <th className={HEAD}>Sold by</th>
                </tr>
              </thead>
              <tbody>
                {report.surplus.map((row) => (
                  <tr key={row.commodity} className="border-b border-[var(--color-border-hairline)]">
                    <td className={CELL}>{row.commodity}</td>
                    <td className={`${CELL} text-[var(--color-text-secondary)]`}>
                      {row.soldBy.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default async function BlocNexusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const read = await getColonyBlocNexus(id);

  /*
   * ★ ONE ANSWER FOR "NOT YOURS" AND "NO SUCH GROUP" ★
   *
   * The API cloaks both behind RESOURCE_NOT_VISIBLE (INV-024) and the web client maps that to
   * `forbidden`, so there is no `missing` state to branch on and deliberately so — telling a reader
   * that a group exists but is not theirs is exactly the disclosure the cloak prevents.
   */
  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const nexus = read.data;

  return (
    <>
      <PageHeader
        eyebrow="Colonisation · Nexus"
        title={nexus.name.toUpperCase()}
        subtitle={nexus.note ?? 'What these systems can supply each other'}
      />
      <PageBody wide>
        <p className="mb-6 text-sm">
          <Link href="/colonisation/nexus" className="text-[var(--color-brand-cyan-bright)] hover:underline">
            ← All groups
          </Link>
        </p>

        <Section title="What this group can and cannot supply">
          <Report nexus={nexus} />
        </Section>

        <Section title="Systems in this group">
          <div className="mb-4 flex flex-wrap gap-2">
            {nexus.bases.map((b) => (
              <span
                key={b.systemName}
                className="flex items-center gap-2 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-1.5"
              >
                <span className="font-mono text-xs text-[var(--color-text-primary)]">
                  {b.systemName}
                </span>
                <BasisBadge basis={b.basis} />
              </span>
            ))}
          </div>

          {nexus.report.unplanned.length === 0 ? null : (
            <p className="mb-4 text-xs text-[var(--color-text-secondary)]">
              {/*
                Named rather than quietly dropped. A system missing from its own group reads as a
                bug — and saying so is also the nudge to go and plan it.
              */}
              Nothing is built or planned in {nexus.report.unplanned.join(', ')}, so{' '}
              {nexus.report.unplanned.length === 1 ? 'it contributes' : 'they contribute'} nothing
              here yet. Plan {nexus.report.unplanned.length === 1 ? 'it' : 'them'} and this fills in.
            </p>
          )}

          <BlocSystems
            blocId={nexus.id}
            systems={nexus.systems}
            mayEdit={nexus.mayEdit}
            owner={nexus.owner}
            visibility={nexus.visibility}
          />
        </Section>
      </PageBody>
    </>
  );
}
