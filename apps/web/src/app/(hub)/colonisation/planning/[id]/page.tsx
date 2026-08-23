import type { Metadata } from 'next';
import {
  PageHeader,
  PageBody,
  Section,
  StatGrid,
  StatTile,
} from '../../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../../app/no-access';
import { getBuildTypes, getColonyPlan, getSystemAdvice } from '../../../../../lib/api';
import { SystemAdvicePanel } from './system-advice';
import { SystemSummary } from './system-summary';
import { CopySystem } from '../../../../../components/copy-system';
import { PageTabs, resolveTab, type PageTab } from '../../../../../components/page-tabs';
import { SystemTree } from './system-tree';
import { planProgress } from '@grims/shared/colony-plan-progress';
import { EconomyAndMarkets } from './economy-markets';
import { BuildOrder } from './build-order';

/**
 * One system, laid out.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "a layout of the system, with spots on each planet that we can settle etc."
 *
 * Two views of the same plan, side by side: the SYSTEM answers "where can this go", and the BUILD
 * ORDER answers "in what order, and what does it cost". They are the same sites — a build appears
 * in both — because those are genuinely the two questions, and forcing somebody to hold one in
 * their head while reading the other is what makes a spreadsheet feel like work.
 */
export const metadata: Metadata = {
  title: "Plan — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The plan page's two halves, as tabs — the app's keys and labels, in the app's order.
 *
 * The project page took the app's tabs on 2026-08-04 so a member switching between the two finds
 * the same things in the same places. A plan page that stayed a single scrolling column would have
 * reintroduced exactly the split that change closed.
 *
 * It earns them on its own merits too: THE SYSTEM is a tree of every body in the system, and BUILD
 * ORDER sat underneath it — so on any real plan, reading the order meant scrolling past the whole
 * galaxy to reach it.
 */
const TABS: readonly PageTab[] = [
  { key: 'system', label: 'The system' },
  { key: 'order', label: 'Build order' },
  /*
   * ★ ITS OWN TAB — SQUADRON OWNER, 2026-08-10 ★
   *
   * The economy and the system effects were rendered at the bottom of the build-order tab, under an
   * editable list that runs to eighty-one rows on the owner's own plan. The most consequential fact
   * about a plan — what the system permanently becomes — sat below a fortnight of scrolling.
   *
   * And it was on the wrong tab: the economy is decided by WHICH builds are in the plan, not by
   * their sequence, which the panel itself says in as many words.
   */
  { key: 'economy', label: 'Economy & markets' },
];

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // A real URL, not client state: a tab survives a refresh and can be sent to somebody.
  const raw = sp['tab'];
  const tab = resolveTab(TABS, Array.isArray(raw) ? raw[0] : raw);

  /*
   * Both at once. The catalogue is what fills the "add a build" lists, and fetching it after the
   * plan would show a tree whose controls are empty for a moment — which reads as a page that has
   * not finished rather than one that is waiting.
   */
  const [read, catalogue] = await Promise.all([getColonyPlan(id), getBuildTypes()]);

  /*
   * ★ FETCHED AFTER THE PLAN, NOT BESIDE IT ★
   *
   * The advice needs the system NAME, which only the plan carries — and it does a survey lookup and
   * may call the assistant, so it is the slowest thing on this page. Running it in the same
   * Promise.all would mean the plan itself waited on an answer nobody has asked to see yet.
   *
   * Fails soft, like every advisory read on this platform: a plan with no advice is worth far more
   * than no plan.
   */
  const advice =
    read.state === 'ok' && read.data.plan.systemName
      ? await getSystemAdvice(read.data.plan.systemName).catch(() => null)
      : null;

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const plan = read.data.plan;
  const buildTypes = catalogue.state === 'ok' ? catalogue.data.buildTypes : [];

  const costed = plan.sites.filter((s) => s.totalTonnes !== null);

  /*
   * ★ WHAT HAS ACTUALLY BEEN BUILT — SQUADRON OWNER, 2026-08-11 ★
   *
   * "can we track the remaining To haul or add in the To haul card the remaining | whats been
   * hauled"
   *
   * Answerable only since a planned site can point at the project it became. Sites with a project
   * report MEASURED tonnages off a commander's journal; the rest are catalogue ESTIMATES. The card
   * says which is which rather than blending them into one confident figure — see the hint below.
   */
  const progress = planProgress(
    plan.sites.map((s) => ({
      id: s.id,
      totalTonnes: s.totalTonnes,
      project:
        s.project === null || s.project === undefined
          ? null
          : {
              required: s.project.required,
              remaining: s.project.remaining,
              completedAt: s.project.completedAt === null ? null : new Date(s.project.completedAt),
            },
    })),
  );
  const tonnes = progress.totalTonnes;
  const bodiesWithSlots = plan.bodies.filter(
    (b) => b.orbitalSlots !== null || b.surfaceSlots !== null,
  ).length;

  /*
   * ★ THE SERVER'S ANSWER, NOT THIS PAGE'S GUESS ★
   *
   * This was `plan.owner === 'personal' || plan.postedBy !== null`, which looked like the projects
   * rule and was always TRUE: `postedBy` is a display name from an inner join on a NOT NULL column,
   * so it is never null. Every member saw the full editing UI for every squadron plan, and every
   * click came back "Only officers can change a squadron plan."
   *
   * Still only a rendering hint — every write re-checks — but a hint that disagrees with the rule
   * it is hinting at is worse than none, because it reads as a broken app rather than as a rank you
   * do not hold.
   */
  const canEdit = read.data.can.edit;

  return (
    <>
      <PageHeader
        eyebrow={plan.owner === 'squadron' ? 'Squadron plan' : 'Your plan'}
        title={plan.title.toUpperCase()}
        tabs={
          <PageTabs
            tabs={TABS}
            current={tab}
            basePath={`/colonisation/planning/${encodeURIComponent(id)}`}
          />
        }
      />
      <p className="-mt-4 mb-8 flex flex-wrap items-center gap-x-1 text-sm text-[var(--color-text-secondary)]">
        <span className="text-[var(--color-text-primary)]">{plan.systemName}</span>
        <CopySystem system={plan.systemName} />
        <span className="ml-2">· revision {plan.version}</span>
        {plan.postedBy === null ? null : <span>· started by {plan.postedBy}</span>}
      </p>

      <PageBody wide>
        <StatGrid>
          <StatTile label="Bodies" value={String(plan.bodies.length)} />
          {/* The breakdown only appears once something has actually been posted — "0 complete ·
              0 building · 81 planned" on a fresh plan is three numbers saying one thing. */}
          {progress.complete + progress.building === 0 ? (
            <StatTile label="Sites planned" value={String(plan.sites.length)} />
          ) : (
            <StatTile
              label="Sites planned"
              value={String(plan.sites.length)}
              hint={`${progress.complete} complete · ${progress.building} building · ${progress.planned} planned`}
            />
          )}
          <StatTile
            label="To haul"
            value={
              costed.length === 0
                ? '—'
                : `${progress.remainingTonnes.toLocaleString()} t of ${tonnes.toLocaleString()}`
            }
            /*
              The gap stated plainly. Most sites in a plan have never been placed, so their tonnage
              is a catalogue estimate — presenting "13% hauled" as measured fact would be a guess
              wearing a measurement's clothes, on the figure a squadron plans a fortnight around.
            */
            hint={
              progress.measuredSites === 0
                ? 'Nothing posted as a project yet, so every figure is a catalogue estimate.'
                : `${progress.hauledTonnes.toLocaleString()} t hauled${
                    progress.pctHauled === null ? '' : ` (${progress.pctHauled}%)`
                  } · measured across ${progress.measuredSites} build${
                    progress.measuredSites === 1 ? '' : 's'
                  }, estimated for ${progress.estimatedSites}`
            }
            tone={tonnes > 0 ? 'accent' : 'default'}
          />
          <StatTile
            label="Slots recorded"
            value={`${bodiesWithSlots} of ${plan.bodies.length}`}
            tone={bodiesWithSlots === 0 ? 'warn' : 'default'}
          />
        </StatGrid>

        {/*
          ★ WHERE THE BODIES CAME FROM, AND WHEN ★

          Every figure on this page rests on a body list somebody else scanned and shared. A page
          that cannot date its own foundation is asking to be trusted blindly.
        */}
        {plan.bodiesFetchedAt === null ? null : (
          <p className="m-0 mb-6 font-mono text-[11px] text-[var(--color-text-secondary)]">
            Bodies read from what commanders have scanned, on{' '}
            {new Date(plan.bodiesFetchedAt).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            . Slot counts are read off the game by members and are not predicted.
          </p>
        )}

        {tab !== 'system' ? null : (
          <Section title="The system">
            {/*
              ★ THE SUMMARY BEFORE THE TREE — SQUADRON OWNER, 2026-08-23 ★

              A member opening a plan wants to know what the system IS before they start reading
              which body has what on it. Same order as the reference layout, and the same reason the
              build books lead with reasoning rather than the build list.
            */}
            <SystemSummary plan={plan} buildTypes={buildTypes} />
            <SystemTree plan={plan} buildTypes={buildTypes} canEdit={canEdit} />
            {advice !== null && advice.state === 'ok' && (
              <SystemAdvicePanel advice={advice.data} canDraft={canEdit} />
            )}
          </Section>
        )}

        {tab !== 'order' ? null : (
          <Section title="Build order">
            <BuildOrder plan={plan} canEdit={canEdit} />

            {/*
              ★ THE BUILD BOOK — SQUADRON OWNER, 2026-08-16 ★

              "the build guide generator is also not anywhere i can find it?"

              A plain link, and a download rather than a page. The book is read BESIDE the game — on
              a second monitor, or on paper — and a browser tab is the one place it cannot be while
              somebody is flying. It carries the build id and body id on every row so they can be
              typed straight into the game's own planner.
            */}
            <p className="m-0 mt-4 text-[11px] text-[var(--color-text-secondary)]">
              <a
                href={`/v1/logistics/colony/plans/${plan.id}/book`}
                className="text-[var(--color-brand-orange)] no-underline hover:underline"
              >
                Download the build book
              </a>{' '}
              — one page per system, with every build id and body id, ready to print.
            </p>
          </Section>
        )}

        {tab !== 'economy' ? null : (
          <Section title="Economy &amp; markets">
            <EconomyAndMarkets plan={plan} />
          </Section>
        )}
      </PageBody>
    </>
  );
}
