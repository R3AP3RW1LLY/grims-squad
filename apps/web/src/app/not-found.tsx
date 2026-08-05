import type { Metadata } from 'next';
import { FailurePage, FAILURE_LINK, FAILURE_LINK_PRIMARY } from '../components/failure-page';

export const metadata: Metadata = {
  title: "Not found — Grim's Squad",
  robots: { index: false, follow: false },
};

/**
 * A page that is not there.
 *
 * ★ NOT THE SAME EVENT AS A FAILURE, AND MUST NOT LOOK LIKE ONE ★
 *
 * A 404 is a working site answering a question correctly. Dressing it in the language of a broken
 * one — "something went wrong", "try again" — teaches members to retry things that will never
 * work, and hides real outages in the noise of mistyped links.
 *
 * ★ IT ALSO COVERS THE PRIVATE CASE, DELIBERATELY ★
 *
 * Several routes answer 404 for things that DO exist but are not this member's to see — a private
 * colonisation project, an officers' thread, another member's build. That is the cloak-404 rule
 * (INV-002 and `cloak-404.spec.ts`): "no such page" and "not yours" must be indistinguishable, or
 * the difference between them becomes a way to enumerate what exists. So this copy never promises
 * the page is absent, only that we have nothing to show them here — true either way.
 */
export default function NotFound() {
  return (
    <FailurePage
      eyebrow="Not found"
      title="NOTHING HERE"
      actions={
        <>
          <a href="/" className={FAILURE_LINK_PRIMARY}>
            Back to the hub
          </a>
          <a href="/forum" className={FAILURE_LINK}>
            The forum
          </a>
        </>
      }
    >
      <p>
        There is nothing at this address for you. The link may be old, it may have a typo in it, or
        it may point somewhere your account cannot go.
      </p>
      <p>
        If somebody sent you here and you think you should have access, ask an officer — some of the
        boards are open only to members, and a few only to the crew working them.
      </p>
    </FailurePage>
  );
}
