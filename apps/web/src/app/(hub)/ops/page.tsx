import type { Metadata } from 'next';
import { PageHeader } from '../../../components/hub-page';
import {
  ComingSoonBody,
  UnderConstruction,
  type ComingSoonCopy,
} from '../../../components/coming-soon';

/**
 * Operations — wings forming up, and what they need.
 *
 * Not built yet. The nav has pointed here since the navigation was written and
 * the route did not exist, so clicking Operations produced a bare 404.
 */
export const metadata: Metadata = {
  title: "Operations — Grim's Squad",
  robots: { index: false, follow: false },
};

const COPY: ComingSoonCopy = {
  eyebrow: 'Squadron operations',
  title: 'THE WING BOARD IS STILL IN DRY DOCK',
  /*
   * The joke is at the developers, never at the squadron. "You are currently
   * organising ops by shouting" would be funny and would also be telling a
   * hundred members their method is bad — it works, it has worked for twenty
   * years, and this page is late.
   */
  quip: 'Somewhere in this codebase there is a very well-designed operations board. It has not been let out yet.',
  promise:
    'This is where a wing gets put together: who is flying, what they are flying, when it starts, and who still needs a seat.',
  bullets: [
    'Ops posted ahead of time, with the ships and roles they need.',
    'A place to say you are in, so nobody counts the wing twice.',
    'What happened afterwards — kills, hauls, and how the night went.',
  ],
  meanwhile:
    'Until it lands, ops run the way they always have: in Discord, at short notice, usually because somebody found something worth shooting.',
};

export default function OpsPage() {
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
