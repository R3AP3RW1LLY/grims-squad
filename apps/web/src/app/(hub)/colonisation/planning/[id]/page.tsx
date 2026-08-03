import type { Metadata } from 'next';
import {
  PageHeader,
  PageBody,
  Section,
  StatGrid,
  StatTile,
} from '../../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../../app/no-access';
import { getBuildTypes, getColonyPlan } from '../../../../../lib/api';
import { CopySystem } from '../../../../../components/copy-system';
import { SystemTree } from './system-tree';
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

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /*
   * Both at once. The catalogue is what fills the "add a build" lists, and fetching it after the
   * plan would show a tree whose controls are empty for a moment — which reads as a page that has
   * not finished rather than one that is waiting.
   */
  const [read, catalogue] = await Promise.all([getColonyPlan(id), getBuildTypes()]);

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const plan = read.data.plan;
  const buildTypes = catalogue.state === 'ok' ? catalogue.data.buildTypes : [];

  const costed = plan.sites.filter((s) => s.totalTonnes !== null);
  const tonnes = costed.reduce((sum, s) => sum + (s.totalTonnes ?? 0), 0);
  const bodiesWithSlots = plan.bodies.filter(
    (b) => b.orbitalSlots !== null || b.surfaceSlots !== null,
  ).length;

  /*
   * A rendering hint only — every write re-checks. A squadron plan is the squadron's so an officer
   * directs it; a personal one belongs to whoever started it. The same rule projects use.
   */
  const canEdit = plan.owner === 'personal' || plan.postedBy !== null;

  return (
    <>
      <PageHeader
        eyebrow={plan.owner === 'squadron' ? 'Squadron plan' : 'Your plan'}
        title={plan.title.toUpperCase()}
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
          <StatTile label="Sites planned" value={String(plan.sites.length)} />
          <StatTile
            label="To haul"
            value={costed.length === 0 ? '—' : `${tonnes.toLocaleString()} t`}
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

        <Section title="The system">
          <SystemTree plan={plan} buildTypes={buildTypes} canEdit={canEdit} />
        </Section>

        <Section title="Build order">
          <BuildOrder plan={plan} canEdit={canEdit} />
        </Section>
      </PageBody>
    </>
  );
}
