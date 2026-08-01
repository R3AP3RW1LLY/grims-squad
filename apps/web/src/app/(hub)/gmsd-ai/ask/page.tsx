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
 * ★ GATED ON AI_CHAT, NOT ON THE DATA ★
 *
 * Everything the assistant can reach is already visible to any signed-in member, so this shipped
 * ungated — refusing through one door what another gives away seemed wrong.
 *
 * The owner asked for a control, and they were asking a different question: not "who may see these
 * facts" but "who may use this feature". The model runs on the squadron's own card beside post
 * screening and artwork, and being able to take it off a rank — or hold it back while it is being
 * tuned — is operational.
 *
 * Checked against the real role table: every role granting any permission also grants AI_CHAT, so
 * nothing changes for anybody who can currently reach a members' page. The endpoint checks it too —
 * a hidden nav link is not a boundary.
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
