import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../components/hub-page';
import { getOps } from '../../../lib/api';
import { OpsBoard } from './ops-board';

/**
 * Operations — wings forming up, and what they need.
 *
 * ★ SQUADRON OWNER ★
 *
 * The coming-soon page that stood here promised "who is flying, what they are flying, when it
 * starts, and who still needs a seat". This is that, built on tables which have carried capacity
 * and standby overflow since the day they were designed and had never been used.
 *
 * ★ STANDBY IS NOT A REJECTION ★
 *
 * The rule the whole page is arranged around. A full op does not turn anybody away — it puts them
 * behind whoever committed first, and a drop-out promotes the next in order. So the board shows the
 * standby count as plainly as the going count: a queue people can see moving is one they join.
 */
export const metadata: Metadata = {
  title: "Operations — Grim's Squad",
  description: 'Wings forming up, what they are flying, and who still needs a seat.',
};

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const board = await getOps();

  return (
    <>
      <PageHeader
        eyebrow="Command"
        title="OPERATIONS"
        subtitle="Wings forming up, and who still needs a seat"
      />
      <PageBody lead="Say whether you are coming and the wing knows its strength before it forms. An op that is full does not turn you away — you go on standby, in the order you committed, and the first drop-out promotes you.">
        {board === null ? (
          <Section title="What is on">
            <CouldNotLoad what="the operations board" />
          </Section>
        ) : (
          <OpsBoard ops={board.ops} />
        )}
      </PageBody>
    </>
  );
}
