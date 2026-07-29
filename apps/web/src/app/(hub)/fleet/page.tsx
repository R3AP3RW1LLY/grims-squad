import type { Metadata } from 'next';
import { PageHeader } from '../../../components/hub-page';
import {
  ComingSoonBody,
  UnderConstruction,
  type ComingSoonCopy,
} from '../../../components/coming-soon';

/**
 * Fleet — ships, builds, and what the doctrine asks for.
 *
 * Not built yet. In the nav since it was written, with no route behind it, so
 * Fleet gave a bare 404.
 */
export const metadata: Metadata = {
  title: "Fleet — Grim's Squad",
  robots: { index: false, follow: false },
};

const COPY: ComingSoonCopy = {
  eyebrow: 'Squadron fleet',
  title: 'THE HANGAR IS PRESSURISED, THE DOORS ARE NOT',
  quip: 'We can already see every ship you own. We simply have nowhere dignified to put them yet.',
  /*
   * "We can already see every ship you own" is true — the companion app reports
   * the fleet and the profile page shows it — and it is the sort of true thing
   * that sounds sinister if left hanging. The promise line answers it
   * immediately: this is the member's own fleet, shown back to them.
   */
  promise:
    'This is where your ships live: what you fly, how it is fitted, and which builds the squadron leans on when an op needs a particular job doing.',
  bullets: [
    'Your own hangar, pulled from the journal rather than typed in twice.',
    'Builds worth copying, with the reason they are put together that way.',
    'What the doctrine asks for, so a new commander knows what to work toward.',
  ],
  meanwhile:
    'For now your fleet already shows on your profile, and builds get passed around the way they always have — in Discord, usually with a screenshot and an opinion.',
};

export default function FleetPage() {
  return (
    <>
      {/*
        The shared hub header, rendered here rather than inside `ComingSoonBody`.

        Every other page in the members' area does the same, and `hub-page.spec`
        holds each page file to it — a page that delegates its header to a
        component is indistinguishable, to that guard, from one that has no
        header at all. It is also simply clearer read here.
      */}
      <PageHeader
        eyebrow={COPY.eyebrow}
        title={COPY.title}
        action={<UnderConstruction />}
      />
      <ComingSoonBody copy={COPY} />
    </>
  );
}
