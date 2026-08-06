import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../../components/hub-page';
import { getRoutes } from '../../../../lib/api';
import { RunForm } from './run-form';
import { RouteList } from './route-list';

/**
 * The Freight Office — plan a hauling run.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a trade route planner that is very granular and will allow one to selct any buyable and sellable
 * commodity / mineable etc this will be its own system (create a name that makes sense for it)."
 *
 * The name is the owner's, from a shortlist. It reads as a PLACE you go to get work, which is the
 * same shape as Shipyard → Outfitter and says what the page is for without explaining itself.
 *
 * ★ EVERYTHING IS IN THE URL ★
 *
 * A plan is a link. "Here is the run I am doing tonight" pasted into Discord opens the same
 * routes for whoever clicks it — which is most of what a squadron wants from a trade tool, and is
 * free if the state lives in the query string instead of in a component.
 */
export const metadata: Metadata = {
  title: "Freight Office — Grim's Squad",
  description:
    'Plan an Elite Dangerous trade run: pick your hull, your range and your cargo, and get the route with real prices, real supply and honest tonnage.',
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

const KEYS = [
  'near',
  'cargo',
  'buyWithinLy',
  'sellWithinLy',
  'budget',
  // `largePad` is kept alongside `padSize` so a bookmarked or shared link from before 2026-08-06
  // still filters the way its author meant. The API accepts both; 'large' and the old flag agree.
  'largePad',
  'padSize',
  'carriers',
  'freshDays',
  'commodity',
  'sort',
];

export default async function FreightOfficePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;

  const query: Record<string, string> = {};
  for (const key of KEYS) {
    const v = one(sp[key]);
    if (v !== '') query[key] = v;
  }

  /*
   * ★ NOTHING IS PLANNED UNTIL SOMEBODY ASKS ★
   *
   * An unasked page renders the form and no routes. A member with a paired device HAS an origin —
   * their ship's position — so the planner could run on arrival, and it deliberately does not:
   * a page that spends a few seconds of queries before anybody has said what they fly is one that
   * feels slow every single time it is opened.
   */
  const asked = Object.keys(query).length > 0;
  const plan = asked ? await getRoutes(query) : null;

  return (
    <>
      <PageHeader
        eyebrow="Logistics & Trade"
        title="FREIGHT OFFICE"
        subtitle="Pick the cargo, the hull and the range — get the run"
      />
      <PageBody
        wide
        lead="Routes are built from live prices reported by commanders flying the game. Tonnage is what you can actually load, not what your hold could hold."
      >
        <Section title="Your run">
          <RunForm query={query} plan={plan} />
        </Section>

        {!asked ? null : plan === null ? (
          <Section title="Routes">
            <CouldNotLoad what="the route planner" />
          </Section>
        ) : (
          <Section
            title={
              plan.routes.length === 0
                ? 'No routes found'
                : `Best runs from ${plan.origin?.system ?? 'here'}`
            }
          >
            {/*
              The hold and the credits come from the form the member just submitted, so the
              manifest agrees with the tonnages the rows quote rather than assuming a ship of its
              own. The default matches the form's.
            */}
            <RouteList
              plan={plan}
              cargo={Number(query['cargo'] ?? '') || 64}
              budget={Number(query['budget'] ?? '') || null}
            />
          </Section>
        )}
      </PageBody>
    </>
  );
}
