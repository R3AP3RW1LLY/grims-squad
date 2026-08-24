import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getClaimedSystems, getColonyPlans } from '../../../../lib/api';
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

export default async function PlanningPage({
  searchParams,
}: {
  /** `?system=` arrives from the scout — see the note in new-plan.tsx. */
  searchParams: Promise<{ system?: string }>;
}) {
  const { system } = await searchParams;
  /*
   * Claims are fetched alongside, and failing soft: they are an extra prompt, and losing them must
   * never cost somebody the plan board they came here for.
   */
  const [read, claims] = await Promise.all([
    getColonyPlans('all'),
    getClaimedSystems().catch(() => null),
  ]);

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
          <NewPlan system={system} />
        </Section>

        {/*
          ★ SYSTEMS YOU TOOK AND HAVE NOT PLANNED — 2026-08-24 ★

          Every colonisation event the platform collected was about a construction site that already
          exists, so a system somebody claimed and never built on was invisible here — and those are
          precisely the ones still waiting to be planned, and the ones a member forgets.

          An offer rather than an automatic plan. Creating rows in somebody's planner because of
          something their game did is the kind of helpfulness that is indistinguishable from a bug
          when it is wrong, and a member who claimed a system to deny it to somebody else has not
          asked for a plan at all.
        */}
        {claims?.state === 'ok' && claims.data.claimed.length > 0 && (
          <Section title="Claimed, not yet planned">
            <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
              Read from your own journal. Start a plan for one, or leave it — nothing here changes
              until you do.
            </p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {claims.data.claimed.map((claim) => (
                <li
                  key={claim.systemName}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-2"
                >
                  <span className="text-sm text-[var(--color-text-primary)]">
                    {claim.systemName}
                  </span>
                  <span className="flex items-baseline gap-3">
                    <span className="font-mono text-[11px] text-[var(--color-text-dim)]">
                      claimed {new Date(claim.claimedAt).toLocaleDateString('en-GB')}
                    </span>
                    {/*
                      Straight into the form above with the system filled in — the same `?system=`
                      the scout page already uses, so there is one way to start a plan rather than
                      a second that could drift from it.
                    */}
                    <Link
                      href={`/colonisation/planning?system=${encodeURIComponent(claim.systemName)}`}
                      className="text-sm text-[var(--color-text-secondary)] underline decoration-[var(--color-border-subtle)] underline-offset-2 hover:text-[var(--color-text-primary)]"
                    >
                      Plan it
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

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
