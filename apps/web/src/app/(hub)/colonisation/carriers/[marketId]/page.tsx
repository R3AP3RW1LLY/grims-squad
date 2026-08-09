import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, PageBody, Section, StatGrid, StatTile } from '../../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../../app/no-access';
import { getCarrierManifest } from '../../../../../lib/api';
import { ShoppingList } from '../../[id]/shopping-list';

/**
 * One carrier's whole run.
 *
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "it can be active on many projects and it will give me an aggregated total of all materials needed
 * to get all the builds completed if i am buying and storing on a fleet carrier"
 *
 * ★ WHY THIS IS A PAGE OF ITS OWN AND NOT A PANEL ON A PROJECT ★
 *
 * It does not belong to a project. It spans them — every build this carrier is attached to — and
 * hanging it inside one of them would make the same numbers mean different things depending on which
 * build you happened to open it from.
 *
 * ★ AND THE TOTAL IS NOT THE SUM OF THOSE PAGES ★
 *
 * Worth saying on the page itself, because a member who has added up three project pages by hand
 * will get a different answer and be right to ask why. A carrier holds ONE hold. Each build reports
 * the whole of it as cover, correctly, because each is answering "what do the carriers attached to
 * me hold". Added together that counts the same cargo once per build. Here it is subtracted once.
 */
export const metadata: Metadata = {
  title: "Carrier run — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CarrierRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ marketId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { marketId } = await params;
  const sp = await searchParams;

  const one = (key: string): string | undefined => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };

  /* Carried onto the filter form so a chosen origin and radius survive submitting it. */
  const query: Record<string, string> = {};
  for (const key of ['near', 'withinLy', 'largePad', 'sort']) {
    const value = one(key);
    if (value !== undefined && value !== '') query[key] = value;
  }

  const read = await getCarrierManifest(marketId, query);
  if (read.state === 'forbidden') {
    // A carrier nobody has attached also lands here — the API cloaks it as not-visible rather than
    // confirming which market ids are real. Same screen, deliberately.
    return <NoAccess what="this carrier" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') return <AdminUnavailable />;

  const { carrier, projects, lines, shopping } = read.data;

  const stillToBuy = lines.reduce((sum: number, l) => sum + l.toBuy, 0);
  const aboard = lines.reduce((sum: number, l) => sum + Math.min(l.needed, l.aboard), 0);
  const needed = lines.reduce((sum: number, l) => sum + l.needed, 0);
  const cost = shopping.reduce((sum: number, r) => sum + (r.cost ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title={carrier.callsign === null ? carrier.name : `${carrier.name} · ${carrier.callsign}`}
        subtitle={
          projects.length === 1
            ? 'Everything the build this carrier serves still needs'
            : `Everything the ${projects.length} builds this carrier serves still need, added up once`
        }
      />
      <PageBody lead="One carrier, one hold. What is aboard is subtracted once from the combined need — not once per build, which is what adding the project pages together would do.">
        <StatGrid>
          <StatTile label="Builds served" value={String(projects.length)} />
          <StatTile label="Still needed" value={`${needed.toLocaleString()} t`} />
          <StatTile
            label="Aboard"
            value={`${aboard.toLocaleString()} t`}
            tone={aboard > 0 ? 'accent' : 'default'}
          />
          <StatTile
            label="Left to buy"
            value={`${stillToBuy.toLocaleString()} t`}
            tone={stillToBuy > 0 ? 'warn' : 'default'}
          />
        </StatGrid>

        <Section title="The builds this carrier is on">
          {projects.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              This carrier is not attached to any build yet. Attach it from a project&rsquo;s Carriers
              tab and its needs will appear here.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/colonisation/${p.id}`}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border-hairline)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] no-underline hover:border-[var(--color-border-subtle)]"
                  >
                    {p.title}
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                      {p.systemName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Combined manifest">
          {lines.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              Nothing outstanding. Every build this carrier serves has what it needs.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="py-2.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                      Commodity
                    </th>
                    <th className="py-2.5 pr-4 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                      Needed
                    </th>
                    <th className="py-2.5 pr-4 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                      Aboard
                    </th>
                    <th className="py-2.5 pr-4 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                      Left to buy
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {lines.map((l) => (
                    <tr key={l.commodity}>
                      <td className="border-t border-[var(--color-border-hairline)] py-2.5 pr-4">
                        {l.commodity}
                      </td>
                      <td className="border-t border-[var(--color-border-hairline)] py-2.5 pr-4 text-right">
                        {l.needed.toLocaleString()} t
                      </td>
                      <td className="border-t border-[var(--color-border-hairline)] py-2.5 pr-4 text-right text-[var(--color-text-secondary)]">
                        {l.aboard === 0 ? '—' : `${Math.min(l.needed, l.aboard).toLocaleString()} t`}
                      </td>
                      <td
                        className={`border-t border-[var(--color-border-hairline)] py-2.5 pr-4 text-right ${
                          l.toBuy === 0 ? 'text-[var(--color-semantic-success)]' : ''
                        }`}
                      >
                        {l.toBuy === 0 ? 'covered' : `${l.toBuy.toLocaleString()} t`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Where to buy it">
          {/*
            The same list the project page draws, priced on the AGGREGATE. A commodity two builds
            both want is quoted once, for the whole run, rather than twice for two part-loads.
          */}
          <ShoppingList
            rows={shopping}
            action={`/colonisation/carriers/${encodeURIComponent(marketId)}`}
            origin={null}
            unknownSystem={null}
            query={query}
          />
          {cost > 0 ? null : (
            <p className="mt-3 mb-0 text-sm text-[var(--color-text-secondary)]">
              Set an origin system above to price the run.
            </p>
          )}
        </Section>
      </PageBody>
    </>
  );
}
