import type { Metadata } from 'next';
import {
  PageHeader,
  PageBody,
  Section,
  StatGrid,
  StatTile,
} from '../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyProject } from '../../../../lib/api';
import { NeedsTable } from './needs-table';
import { ShoppingList } from './shopping-list';
import { HaulerBoard } from './hauler-board';
import { DeliveryTimeline, HaulerChart } from './delivery-charts';
import { DeliveryLedger } from './delivery-ledger';
import { ProjectActions } from './project-actions';
import { Crew } from './crew';
import { CopySystem } from '../../../../components/copy-system';

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

  const { project, needs, haulers, shopping, deliveries, chart, can, origin, unknownSystem } =
    read.data;
  const delivered = Math.max(0, project.required - project.remaining);

  return (
    <>
      <PageHeader
        eyebrow={project.owner === 'squadron' ? 'Squadron project' : 'Members’ project'}
        title={project.title.toUpperCase()}
      />
      {/*
        ★ THE SYSTEM, WITH A COPY BUTTON — SQUADRON OWNER, 2026-08-03 ★

        "on the project titles where it lists the system they are in, can we add copy buttons ... so
        its easier to drop them into the galaxy / system maps."

        Lifted out of the header's subtitle to get it, because a subtitle is a string and a button
        is not. The system is what the galaxy map searches; the station is only there for orientation
        once you have arrived.
      */}
      <p className="-mt-4 mb-8 flex flex-wrap items-center gap-x-1 text-sm text-[var(--color-text-secondary)]">
        <span className="text-[var(--color-text-primary)]">{project.systemName}</span>
        <CopySystem system={project.systemName} />
        {project.stationName === null ? null : <span className="ml-2">· {project.stationName}</span>}
      </p>
      <PageBody wide>
        {/*
          ★ WHAT THE SITE ACTUALLY IS ★

          Worked out from what it asks for, not from anything anybody typed. The journal never says
          what is being built — but a build type's bill of materials is twenty-odd commodities at
          exact tonnages and no two share one, so the requirement identifies it.

          Absent until somebody has docked there, and absent for a build type we have not recorded,
          which is information rather than a gap.
        */}
        {project.identified === null ? null : (
          <p className="m-0 mb-6 flex flex-wrap items-baseline gap-x-2 text-sm text-[var(--color-text-secondary)]">
            <span>This is a</span>
            <a
              href={`/colonisation/build-types/${encodeURIComponent(project.identified.id)}`}
              className="text-[var(--color-brand-cyan-bright)] no-underline hover:underline"
            >
              {project.identified.displayName}
            </a>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
              tier {project.identified.tier} · {project.identified.location}
              {project.identified.padSize === 'none' ? '' : ` · ${project.identified.padSize} pad`} ·{' '}
              {project.identified.totalTonnes.toLocaleString()} t in total
            </span>
          </p>
        )}

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

        {/*
          Every one of these had a route and no button. `isPriority` in particular has been stored
          since the table existed, rendered as a badge in three places, and settable from nowhere.
        */}
        <div className="mb-8">
          <ProjectActions project={project} canManage={can.manage} isPoster={can.isPoster} />
        </div>

        {project.notes === null ? null : (
          <Section title="Notes">
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">{project.notes}</p>
          </Section>
        )}

        <Section title="What it still needs">
          <NeedsTable needs={needs} />
        </Section>

        {/*
          ★ WHO IS ON THIS, AND WHO IS COVERING WHAT ★

          Above the shopping list on purpose: this is what is GOING to happen, and everything below
          is detail about how. Somebody opening a build in order to help wants the first.
        */}
        <Section title="Who is on this build">
          <Crew projectId={project.id} needs={needs} />
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

        {/*
          ★ SQUADRON OWNER, 2026-08-02 ★

          "a stacked bar chart that shows commoditied selivered per hour per day like raven
          colonial", switchable between stacking by commodity and by commander.

          Above the leaderboard rather than below it: the shape of a build — did it go in over one
          night or three weeks, and did it stall — is the thing somebody opens this page to see.
        */}
        <Section title="Deliveries over time">
          <DeliveryTimeline chart={chart} />
        </Section>

        {/*
          The literal ledger. It answers "did my run land", which the leaderboard cannot — and which
          is the question somebody has in the ninety seconds after they undock.
        */}
        <Section title="Every delivery">
          <DeliveryLedger deliveries={deliveries} />
        </Section>

        <Section title="Who has hauled">
          <HaulerChart chart={chart} />
          <HaulerBoard haulers={haulers} />
        </Section>
      </PageBody>
    </>
  );
}
