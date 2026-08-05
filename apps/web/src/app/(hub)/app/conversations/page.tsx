import type { Metadata } from 'next';
import { getAiConversationsGated, getMe } from '../../../../lib/api';
import { StepUp } from '../step-up';
import { NoAccess, AdminUnavailable } from '../no-access';
import { PageHeader, PageBody, StatGrid, StatTile } from '../../../../components/hub-page';
import { ConversationList } from './conversation-list';

export const metadata: Metadata = {
  title: "AI conversations — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * What members have asked GMSD AI, and what it told them.
 *
 * ★ SQUADRON OWNER — NON-NEGOTIABLE ★
 *
 * "Every conversation logged for officer review ... it also need to be visible to the webmaster
 * role! this is non-negotiable as the webmaster is the AI developer."
 *
 * Gated on AI_REVIEW, which is the same permission as the rest of the AI log. The webmaster
 * override already lives inside `effectiveMask`, so the requirement is met by USING that permission
 * rather than by carving out a second path that could drift from it — a separate webmaster check
 * here would be a second answer to a question that already has one.
 *
 * ★ WHY THIS SCREEN EXISTS AT ALL ★
 *
 * The assistant answers from retrieved facts, and when it is wrong there are exactly two causes: the
 * facts were wrong, or the model misread them. Those need opposite fixes — one is an ingest bug, the
 * other is a prompt — and the only way to tell them apart is to read what was retrieved alongside
 * what was said. A member reporting "it gave me a bad price" cannot supply that; this can.
 */
export default async function ConversationsPage() {
  const read = await getAiConversationsGated();
  /*
   * The MEMBER'S stored zone, not the browser's.
   *
   * `toLocaleString()` with no zone formats in whatever the device is set to, which is wrong for
   * anyone travelling or on a machine set to another country — and it renders differently on the
   * server and after hydration, so the timestamp visibly changes. There is a test that fails if a
   * members-area page does it, and it caught this one.
   */
  const me = await getMe();
  const viewerTz = me.user?.timezone ?? 'UTC';

  if (read.state === 'needs-step-up' || read.state === 'signed-out') return <StepUp />;
  if (read.state === 'forbidden') return <NoAccess what="AI conversations" permission="AI_REVIEW" />;
  if (read.state === 'unavailable') return <AdminUnavailable />;

  const threads = read.data.threads;
  const turns = threads.reduce((n, t) => n + t.turns, 0);
  const refusals = threads.reduce((n, t) => n + t.refusals, 0);
  const askers = new Set(threads.map((t) => t.userId ?? 'anonymous')).size;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="AI conversations"
        subtitle="What members asked GMSD AI, and what it answered"
      />
      <PageBody
        wide
        lead="Every question and every answer, grouped into conversations. When an answer is wrong the cause is either the facts it retrieved or the way it read them — and those need different fixes, so both are recorded."
      >
        <StatGrid>
          <StatTile label="Conversations" value={threads.length.toLocaleString()} tone="accent" />
          <StatTile label="Questions asked" value={turns.toLocaleString()} />
          <StatTile label="Members asking" value={askers.toLocaleString()} />
          {/*
            Refusals are not failures and are not shown as a fault. A question the assistant
            declined because it retrieved nothing is the design working — but a HIGH count means
            members are repeatedly asking about something we do not hold, which is the single most
            useful signal on this page for deciding what to ingest next.
          */}
          <StatTile
            label="Declined to answer"
            value={refusals.toLocaleString()}
            tone={refusals > turns / 2 && turns > 0 ? 'warn' : 'default'}
          />
        </StatGrid>

        <ConversationList threads={threads} viewerTz={viewerTz} />
      </PageBody>
    </>
  );
}
