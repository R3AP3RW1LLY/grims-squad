import type { Metadata } from 'next';
import { PageHeader } from '../../../components/hub-page';
import {
  ComingSoonBody,
  UnderConstruction,
  type ComingSoonCopy,
} from '../../../components/coming-soon';

/**
 * BGS — the faction, its systems, and this week's orders.
 *
 * Not built yet. Linked from the nav since it was written, with no route behind
 * it, so Background Simulation gave a bare 404.
 */
export const metadata: Metadata = {
  title: "BGS — Grim's Squad",
  robots: { index: false, follow: false },
};

const COPY: ComingSoonCopy = {
  eyebrow: 'Background simulation',
  title: 'RUNNING ENTIRELY IN THE BACKGROUND',
  /*
   * The one page where the name writes its own joke. Worth using once, and only
   * once — the second line has to be straight or the whole screen reads as
   * smug.
   */
  quip: 'The Background Simulation is, for the moment, living up to precisely half of its name.',
  promise:
    'This is where Blood Brothers from Alrai gets watched: which systems are moving, which way, and what the squadron should do about it this week.',
  bullets: [
    'Influence across every system the faction holds, day by day.',
    'States worth knowing about — expansion, war, and the awkward ones.',
    "This week's orders, so effort lands where it changes something.",
  ],
  meanwhile:
    'Until then the faction is tracked the honest way: by people checking Inara, comparing notes, and remembering what last week looked like.',
};

export default function BgsPage() {
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
