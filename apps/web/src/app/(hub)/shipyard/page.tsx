import type { Metadata } from 'next';
import { PageHeader, PageBody, Section } from '../../../components/hub-page';
import { PageTabs, resolveTab, type PageTab } from '../../../components/page-tabs';
import { getShipyardShipsGated, getShipyardOutfitGated, getMe } from '../../../lib/api';
import { NoAccess, AdminUnavailable } from '../app/no-access';
import { StepUp } from '../app/step-up';
import { Outfitter } from './outfitter';
import { AiBuilder } from './ai-builder';
import { ShipPicker } from './ship-picker';

export const metadata: Metadata = {
  title: "Shipyard — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The Shipyard.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "we also want a page under squadron called Shipyard that operates like the signature builder, 2
 * options build my own or AI Assisted build, build my own should give a builder that looks and
 * feels like coriolis, works the same way etc but styled to match our theme, brand and style etc!
 * clean workflow professional looks! the AI assisted, should again be a stepper that asks questions
 * and answers to gather the information it needs to make a reliable build."
 *
 * ★ TWO WAYS IN, ONE SET OF NUMBERS ★
 *
 * The builder and the assistant compute their figures with the same code — `computeStats`, over the
 * same module tables. Two implementations would drift and the page would end up disagreeing with
 * itself about the same ship, which is worse than having only one of the two.
 *
 * The difference between them is who chooses the modules. In the builder that is the member; in the
 * assisted path it is the fitting engine, searching every hull Frontier ships against a role and a
 * budget. Neither asks a language model, because a model asked for a loadout invents modules and
 * quotes jump ranges it made up.
 */
const TABS: readonly PageTab[] = [
  { key: 'build', label: 'Build my own' },
  { key: 'assisted', label: 'AI assisted build' },
];

export default async function ShipyardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Whether to offer saving at all. A visitor may plan a ship; keeping one needs an account.
  const me = await getMe();
  const tab = resolveTab(TABS, params['tab']);
  const shipId = typeof params['ship'] === 'string' ? params['ship'] : null;

  /*
   * The ship list is needed by the picker on the build tab and by nothing else; the outfitting
   * payload is only fetched once a hull is chosen — it is a few hundred kilobytes and there is no
   * sense sending it to somebody still deciding.
   */
  /*
   * Fetched for BOTH tabs now. The assisted builder offers "I have a ship in mind", which needs the
   * same hull list the build tab's picker uses — it is a few kilobytes of names and prices, unlike
   * the outfitting payload below.
   */
  const shipsRead = await getShipyardShipsGated();
  const outfitRead =
    tab === 'build' && shipId !== null ? await getShipyardOutfitGated(shipId) : null;

  /*
   * ★ A REFUSAL IS NOT A 2FA PROMPT ★
   *
   * `SHIPYARD_VIEW` can now refuse somebody, so the three ways this page can fail are told apart:
   * a lost session or a genuine step-up gets the code box, a missing permission gets the screen
   * that NAMES the permission, and everything else gets "the API is down". Collapsing them is what
   * produced the loop `no-access.tsx` was written for.
   */
  const failure = [shipsRead, outfitRead].find((r) => r !== null && r.state !== 'ok') ?? null;
  if (failure !== null) {
    if (failure.state === 'needs-step-up' || failure.state === 'signed-out') return <StepUp />;
    if (failure.state === 'forbidden') {
      return <NoAccess what="the Shipyard" permission="SHIPYARD_VIEW" />;
    }
    return <AdminUnavailable />;
  }

  const ships = shipsRead?.state === 'ok' ? shipsRead.data : null;
  const outfit = outfitRead?.state === 'ok' ? outfitRead.data : null;

  return (
    <>
      <PageHeader
        eyebrow="Squadron"
        title="SHIPYARD"
        subtitle={
          outfit === null
            ? 'Outfit a ship, or let the assistant fit one for you'
            : `${outfit.ship.name} — outfitting`
        }
        tabs={<PageTabs tabs={TABS} current={tab} basePath="/shipyard" />}
      />

      <PageBody
        wide
        lead={
          tab === 'build'
            ? 'Every hull the game has, every module that fits it, and what the result actually does. Mass, jump range and the power budget update as you change things — nothing is submitted and nothing is saved until you want it to be.'
            : 'Tell us what the ship is for, then either name a hull or give us a budget. The fitting engine does the rest from the game’s own data — so what it names is a ship you can walk into a shipyard and buy.'
        }
      >
        {tab === 'assisted' ? (
          <AiBuilder ships={ships?.ships ?? []} />
        ) : outfit !== null ? (
          <Section
            title="Outfitting"
            description="Slot sizes are shown beside each dropdown — a module larger than its slot is not offered, and a smaller one usually saves weight."
          >
            <Outfitter payload={outfit} signedIn={me.user !== null} />
          </Section>
        ) : ships === null ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            The ship list could not be loaded. Refresh, or ask an officer if it keeps happening.
          </p>
        ) : (
          <Section
            title="Choose a hull"
            description="Prices are the hull alone, before anything is fitted. Landing pad size decides where a ship can dock at all, which is usually the first thing that rules one out."
          >
            <ShipPicker ships={ships.ships} />
          </Section>
        )}
      </PageBody>
    </>
  );
}
