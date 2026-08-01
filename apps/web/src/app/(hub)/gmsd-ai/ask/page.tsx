import type { Metadata } from 'next';
import { PageHeader, PageBody } from '../../../../components/hub-page';
import { AskChat } from './ask-chat';

export const metadata: Metadata = {
  title: "Ask GMSD AI — Grim's Squad",
  robots: { index: false, follow: false },
};

/**
 * Ask GMSD AI.
 *
 * ★ THE PAGE ALL THE INGESTION WAS FOR ★
 *
 * Six sources, 448,676 systems and stations, eighteen million live prices, our own guides — none of
 * it was reachable by a member until this existed. Every question here runs the same four
 * retrievals the knowledge layer was built around, and the model only ever reads what they return.
 *
 * ★ NOTHING IS FETCHED ON THE SERVER ★
 *
 * There is no state to render: an empty conversation IS the initial state. Making this a server
 * component that fetched something would add a round trip before the page could paint, to display
 * a text box.
 *
 * ★ NO STEP-UP, NO PERMISSION ★
 *
 * Unlike the rest of the GMSD AI section, this is an ordinary member page. Everything it can reach
 * is already visible to any signed-in member — the galaxy dump, market prices, ship data, and the
 * guides board, which the reference ingest reads only while it is public. Gating it would mean the
 * same facts are available through the forum and refused through the thing built to find them.
 *
 * The route itself still requires signing in: every conversation is logged for officer review, and
 * a log of anonymous questions is one nobody can act on.
 */
export default function AskPage() {
  return (
    <>
      <PageHeader
        eyebrow="GMSD AI"
        title="Ask GMSD AI"
        subtitle="Answered from squadron data, with its sources shown"
      />
      <PageBody
        wide
        lead="It searches what we hold — systems and stations, live market prices, ships and modules, and our own guides — and answers from what it finds. When the answer is not in there it says so instead of guessing, which is the whole reason it is worth asking."
      >
        <AskChat />
      </PageBody>
    </>
  );
}
