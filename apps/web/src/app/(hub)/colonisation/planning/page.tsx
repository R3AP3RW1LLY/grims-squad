import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyPlans } from '../../../../lib/api';
import { PlanBoard } from './plan-board';
import { NewPlan } from './new-plan';

/**
 * Planning a system before any of it is built.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "ideally what we would like is the same interface that raven gives us, a layout of the system,
 * with spots on each planet that we can settle etc ... add a new page to colonization called
 * Planning."
 *
 * ★ A PLAN IS NOT A PROJECT ★
 *
 * A project tracks one construction site that already exists and is fed by the journal. A plan is
 * the shape of a system somebody INTENDS to build — thirty sites across a dozen bodies, ordered and
 * costed, argued over long before the first beacon drops. Nothing in the journal knows about it,
 * because none of it exists yet.
 */
export const metadata: Metadata = {
  title: "Planning — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PlanningPage() {
  const read = await getColonyPlans('all');

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const plans = read.data.plans;
  const squadron = plans.filter((p) => p.owner === 'squadron');
  const personal = plans.filter((p) => p.owner === 'personal');

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="PLANNING"
        subtitle="Lay out a whole system before you build any of it"
      />
      <PageBody
        wide
        lead="Name a system and its bodies are drawn from what commanders have scanned. Put builds on them, order them, and see what the whole thing costs before anybody flies anywhere."
      >
        <Section title="Start a plan">
          <NewPlan />
        </Section>

        <Section title="Squadron plans">
          <PlanBoard
            plans={squadron}
            empty="No squadron plans yet. An officer can start one above."
          />
        </Section>

        <Section title="Your plans">
          <PlanBoard
            plans={personal}
            empty="You have not planned a system yet. Yours are private until you make one a squadron plan."
          />
        </Section>
      </PageBody>
    </>
  );
}
