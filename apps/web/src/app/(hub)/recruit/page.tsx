import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../components/hub-page';
import { getRecruitStatus } from '../../../lib/api';
import { RecruitPanel } from './recruit-panel';

/**
 * Recruiting — your link, and the commanders who came through it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "a unique discord invite link for all members that are inara veriefied in our platform! we want
 * this to be a leaderboard item and gamified too please! we want to encourage our playerbase to
 * beable to invite people into the squadron!"
 *
 * ★ THE PAGE HAS TO SELL IT, NOT JUST REPORT IT ★
 *
 * A member who cannot recruit yet is the most important reader here — they are one Inara key or one
 * month away — so the refusal is written as the next step rather than as a closed door, and the
 * ladder is shown to everybody so the reward is legible before anybody has earned it.
 */
export const metadata: Metadata = {
  title: "Recruiting — Grim's Squad",
  description:
    'Your own Discord invite, and credit for the commanders who came through it and stayed.',
};

export const dynamic = 'force-dynamic';

export default async function RecruitPage() {
  const status = await getRecruitStatus();

  return (
    <>
      <PageHeader
        eyebrow="Answer the Call"
        title="RECRUITING"
        subtitle="Your own door into the squadron, and the commanders who walked through it"
      />
      <PageBody
        lead="Every verified commander from Cadet upward gets a personal invite link. Anyone who joins through yours is tracked back to you — and you are credited as they stick around, verify their commander, start scoring, and make Cadet themselves. Nothing is paid for the join itself, because anybody can walk through a door."
      >
        {status === null ? (
          <Section title="Your link">
            <CouldNotLoad what="your recruiting" />
          </Section>
        ) : (
          <RecruitPanel status={status} />
        )}
      </PageBody>
    </>
  );
}
