import type { Metadata } from 'next';
import {
  PageHeader,
  PageBody,
  Section,
  StatGrid,
  StatTile,
} from '../../../../components/hub-page';
import { PageTabs, resolveTab, type PageTab } from '../../../../components/page-tabs';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyProject, getMe } from '../../../../lib/api';
import { NeedsTable } from './needs-table';
import { ShoppingList } from './shopping-list';
import { Carriers } from './carriers';
import { HaulerBoard } from './hauler-board';
import { DeliveryTimeline } from './delivery-charts';
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

/**
 * The project page's sections, as tabs.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "ensure that the colonization pages on the website match the layout and look including tabs on
 * the companion app! were aiming for full parridy please!"
 *
 * These are the app's `PROJECT_TABS` verbatim — same keys, same labels, same order — because the
 * whole point is that a member switching between the two finds the same six things in the same six
 * places. The app got tabs first, at the owner's request: "tab this out please so the project pages
 * are nice and clean and crisp and clear." It was seven sections in one column, two of which are
 * forty-row tables.
 *
 * ★ THE ORDER IS THE APP'S, AND THAT MEANS DROPPING AN ARGUMENT THIS PAGE USED TO MAKE ★
 *
 * Carriers used to sit immediately above "Where to buy", with a comment explaining why: what is
 * already in a hold changes what still needs buying, so reading the shopping list first is reading
 * it against the wrong number.
 *
 * That argument is about ADJACENCY IN A COLUMN, and a tab strip has none — nobody reads tabs left
 * to right. So the ordering trick no longer delivers the thing it was defending, and the fact it
 * was defending is now said out loud on the shopping list itself instead.
 */
const TABS: readonly PageTab[] = [
  { key: 'needs', label: 'Needs' },
  { key: 'buy', label: 'Where to buy' },
  { key: 'crew', label: 'Crew' },
  { key: 'carriers', label: 'Carriers' },
  { key: 'deliveries', label: 'Deliveries' },
  { key: 'haulers', label: 'Haulers' },
];

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
  /*
   * ★ `sort` WAS MISSING FROM THIS LIST, AND THAT MADE THE CONTROL A PROP ★
   *
   * The Prefer select has offered Local first / Cheapest anywhere / Closest anywhere since the day
   * the local-first work shipped. Choosing one submitted the form, put `?sort=cheapest` in the URL,
   * and then this loop dropped it on the floor — so the API never saw it, the answer never changed,
   * and the select snapped back to "Local first" on every submit because its `defaultValue` reads
   * from the same `query` object.
   *
   * The whole point of that control is recorded at shopping-list.tsx: a shopping list once sent
   * somebody ninety-six light years to save five percent. The control that exists so a member can
   * ask for exactly that was wired to nothing.
   */
  for (const key of ['near', 'withinLy', 'largePad', 'sort']) {
    const v = one(sp[key]);
    if (v !== '') query[key] = v;
  }

  /*
   * A real URL, not client state. `PageTabs` renders anchors, so a tab survives a refresh, can be
   * linked to — "look at the Carriers tab" is a URL rather than an instruction — and works before
   * any JavaScript has loaded.
   */
  const tab = resolveTab(TABS, one(sp['tab']));

  /*
   * Carried onto every tab link. A member who set a 200 ly radius and then opened Carriers should
   * not come back to Where to buy and find it silently reset to the default.
   */
  const filters = new URLSearchParams(query).toString();

  /*
   * ★ THE MEMBER'S STORED TIMEZONE, NEVER THE SERVER'S — REPORTED 2026-08-04 ★
   *
   * The delivery ledger is server-rendered, and it used to format its timestamps with a bare
   * `toLocaleString` — which on a server is the SERVER's zone, unlabelled: a plausible time that
   * is simply wrong for anyone living elsewhere. The stored zone is known before the first byte
   * of HTML (see lib/time.ts), so the ledger renders the member's own clock with no flicker and
   * no hydration mismatch. Fetched alongside the project read because neither waits on the other.
   */
  const [read, me] = await Promise.all([getColonyProject(id, query), getMe()]);
  const viewerTz = me.user?.timezone ?? 'UTC';

  if (read.state === 'forbidden') {
    return <NoAccess what="this colonisation project" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const {
    project,
    needs,
    haulers,
    shopping,
    deliveries,
    chart,
    carriers,
    can,
    origin,
    unknownSystem,
  } = read.data;
  const delivered = Math.max(0, project.required - project.remaining);

  return (
    <>
      <PageHeader
        eyebrow={project.owner === 'squadron' ? 'Squadron project' : 'Members’ project'}
        title={project.title.toUpperCase()}
        /*
         * Through the header, which renders them ABOVE the rule — the placement the owner asked to
         * be the default for this kind of tab. The query the filters live in is carried along, so
         * switching tabs does not silently reset somebody's shopping radius.
         */
        tabs={
          <PageTabs
            tabs={TABS}
            current={tab}
            basePath={`/colonisation/${encodeURIComponent(id)}${filters === '' ? '' : `?${filters}`}`}
          />
        }
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

        {tab !== 'needs' ? null : (
          <Section title="What it still needs">
            <NeedsTable needs={needs} />
          </Section>
        )}

        {tab !== 'crew' ? null : (
          <Section title="Who is on this build">
            <Crew projectId={project.id} needs={needs} />
          </Section>
        )}

        {tab !== 'carriers' ? null : (
          <Section title="Fleet carriers on this build">
            <Carriers
              projectId={project.id}
              carriers={carriers}
              needs={needs}
              canManage={can.manage}
            />
          </Section>
        )}

        {tab !== 'buy' ? null : (
          <Section title="Where to buy it">
            <ShoppingList
              rows={shopping}
              projectId={project.id}
              origin={origin}
              unknownSystem={unknownSystem}
              query={query}
              onCarriers={carriers.reduce((sum, c) => sum + c.totalTonnes, 0)}
            />
          </Section>
        )}

        {/*
          ★ SQUADRON OWNER, 2026-08-02 ★

          "a stacked bar chart that shows commoditied selivered per hour per day like raven
          colonial", switchable between stacking by commodity and by commander.

          Above the leaderboard rather than below it: the shape of a build — did it go in over one
          night or three weeks, and did it stall — is the thing somebody opens this page to see.
        */}
        {tab !== 'deliveries' ? null : (
          <Section title="Deliveries over time">
            <DeliveryTimeline chart={chart} />
          </Section>
        )}

        {/*
          The literal ledger. It answers "did my run land", which the leaderboard cannot — and which
          is the question somebody has in the ninety seconds after they undock.
        */}
        {tab !== 'deliveries' ? null : (
          <Section title="Every delivery">
            <DeliveryLedger deliveries={deliveries} tz={viewerTz} />
          </Section>
        )}

        {/*
          The ranked list only. Its chart moved onto the Deliveries toggle as a third view — two
          stacked bar charts with commander names in both, on adjacent sections, read as duplication
          however different their axes were. A leaderboard is not replaceable by a bar: "am I third
          or fourth" is a question people genuinely have about their own name.
        */}
        {tab !== 'haulers' ? null : (
          <Section title="Who has hauled">
            <HaulerBoard haulers={haulers} />
          </Section>
        )}
      </PageBody>
    </>
  );
}
