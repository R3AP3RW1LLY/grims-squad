import type { Metadata } from 'next';
import {
  PageHeader,
  PageBody,
  Section,
  StatGrid,
  StatTile,
} from '../../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../../app/no-access';
import { getColonyProject } from '../../../../../lib/api';
import { NeedsTable } from './needs-table';
import { ShoppingList } from './shopping-list';
import { HaulerBoard } from './hauler-board';

/**
 * One colonisation project.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * Of what a squadron project does that a personal one does not: "Squadron projects also get a
 * shopping list from the Freight Office." That is the third section below — the outstanding needs,
 * each answered with the best place to actually buy it and what the rest of the build will cost.
 */
export const metadata: Metadata = {
  title: "Colonisation project — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default async function ColonyProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const query: Record<string, string> = {};
  for (const key of ['near', 'withinLy', 'largePad']) {
    const v = one(sp[key]);
    if (v !== '') query[key] = v;
  }

  const read = await getColonyProject(id, query);

  if (read.state === 'forbidden') {
    return <NoAccess what="this colonisation project" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const { project, needs, haulers, shopping, origin, unknownSystem } = read.data;
  const delivered = Math.max(0, project.required - project.remaining);

  return (
    <>
      <PageHeader
        eyebrow={project.owner === 'squadron' ? 'Squadron project' : 'Members’ project'}
        title={project.title.toUpperCase()}
        subtitle={`${project.systemName}${project.stationName === null ? '' : ` · ${project.stationName}`}`}
      />
      <PageBody wide>
        <StatGrid>
          <StatTile
            label="Still needed"
            value={project.needCount === 0 ? '—' : `${project.remaining.toLocaleString()} t`}
            tone={project.remaining > 0 ? 'warn' : 'default'}
          />
          <StatTile
            label="Delivered"
            value={project.required > 0 ? `${delivered.toLocaleString()} t` : '—'}
          />
          <StatTile label="Commodities" value={String(project.needCount)} />
          <StatTile
            label="Status"
            value={project.completedAt !== null ? 'Complete' : project.isPriority ? 'Current effort' : 'Live'}
            tone={project.completedAt !== null ? 'accent' : 'default'}
          />
        </StatGrid>

        {project.notes === null ? null : (
          <Section title="Notes">
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">{project.notes}</p>
          </Section>
        )}

        <Section title="What it still needs">
          <NeedsTable needs={needs} />
        </Section>

        <Section title="Where to buy it">
          <ShoppingList
            rows={shopping}
            projectId={project.id}
            origin={origin}
            unknownSystem={unknownSystem}
            query={query}
          />
        </Section>

        <Section title="Who has hauled">
          <HaulerBoard haulers={haulers} />
        </Section>
      </PageBody>
    </>
  );
}
