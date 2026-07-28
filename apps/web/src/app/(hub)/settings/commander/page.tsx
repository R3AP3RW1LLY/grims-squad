import type { Metadata } from 'next';
import { getInaraStatus, getMe, getTimezones } from '../../../../lib/api';
import { SquadronStatus } from './squadron-status';
import { InaraForm } from './inara-form';
import { TimezoneForm } from './timezone-form';
import {
  PageHeader,
  PageBody,
  Panel,
  Section,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';
import { PageTabs, resolveTab, type PageTab } from '../../../../components/page-tabs';

export const metadata: Metadata = {
  title: "Commander management — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

/**
 * ★ TWO TABS, NOT ONE LONG PAGE ★
 *
 * Settings and verification are different jobs done at different times.
 * Verification happens once, usually in somebody's first week; settings change
 * whenever something moves. Stacked, the thing done constantly sat below the
 * thing done once, behind a scroll.
 *
 * Settings is FIRST and default, because it is the one people come back for.
 */
const TABS: readonly PageTab[] = [
  { key: 'settings', label: 'Commander settings' },
  { key: 'verification', label: 'Name & verification' },
];

export default async function CommanderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = resolveTab(TABS, params['tab']);

  const [status, me, zones] = await Promise.all([getInaraStatus(), getMe(), getTimezones()]);
  const verified = status?.cmdrName ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="COMMANDER MANAGEMENT"
        action={<PageTabs tabs={TABS} current={tab} basePath="/settings/commander" />}
      />

      {status === null ? (
        <CouldNotLoad what="your commander details" />
      ) : tab === 'settings' ? (
        <PageBody
          lead="How the hub shows things to you, and how it refers to your commander."
          rail={
            <>
              <Panel title="Status">
                <RailStat
                  label="Commander"
                  value={verified ?? 'Not verified'}
                  tone={verified === null ? 'default' : 'good'}
                />
                <RailStat label="Timezone" value={me.user?.timezone ?? 'UTC'} />
              </Panel>

              <Panel title="Related">
                <a
                  href="/settings/commander?tab=verification"
                  className="block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Verify your commander
                </a>
                <a
                  href="/settings/devices"
                  className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Companion app
                </a>
              </Panel>
            </>
          }
        >
          <Section
            title="Times and dates"
            description="Discord does not tell us where in the world you are, so this is the one thing we have to ask for."
          >
            <TimezoneForm initial={me.user?.timezone ?? 'UTC'} zones={zones?.timezones ?? ['UTC']} />
          </Section>
        </PageBody>
      ) : (
        <PageBody
          lead={
            /*
              ★ SAYS WHAT HAPPENS, NOT WHAT WE SUSPECT ★

              The old lead was "we can confirm which commander is yours, rather
              than taking your word for it" — which frames a routine setup step
              as a member being doubted, in the first sentence they read. It is
              also the wrong emphasis: the useful fact is that they never type
              their own name, not that we would decline to believe it.
            */
            "Two steps, both answered by Inara: which commander is yours, and whether you fly with Grim's Squad. You never type either — we read them from your Inara account, and your Discord name is kept matching."
          }
          rail={
            <>
              <Panel title="Status">
                <RailStat
                  label="Commander"
                  value={verified ?? 'Not verified'}
                  tone={verified === null ? 'default' : 'good'}
                />
                {/*
                  ★ THE SQUADRON, IN THE SAME BOX AS THE NAME ★

                  They are the two halves of being verified, and separating them
                  is what let a member read "Verified commander" while the
                  squadron half was still unconfirmed.

                  GREEN when Inara puts them in ours, matching the commander
                  line above. RED — not amber — when Inara puts them somewhere
                  else: that is not "needs attention", it is wrong, and worth
                  spotting from across the page. Plain when we have not asked,
                  which is neither.
                */}
                <RailStat
                  label="Squadron"
                  value={
                    status.squadronStatus === 'verified'
                      ? (status.inaraSquadron ?? status.expectedSquadron ?? "Grim's Squad")
                      : status.squadronCheckedAt == null
                        ? 'Not checked'
                        : (status.inaraSquadron ?? 'None on Inara')
                  }
                  tone={
                    status.squadronStatus === 'verified'
                      ? 'good'
                      : status.squadronCheckedAt == null
                        ? 'default'
                        : 'bad'
                  }
                />
                <RailStat label="Inara key" value={status.linked ? 'Linked' : 'None'} />
                <RailStat
                  label="Verified"
                  value={
                    status.verifiedAt === null
                      ? 'No'
                      : new Date(status.verifiedAt).toLocaleDateString('en-GB')
                  }
                />
              </Panel>

              {/*
                Inara approved our application on 2026-07-28, so the warning that
                stood here is gone. It is replaced rather than simply deleted:
                somebody who read the old panel needs to know the situation
                changed, not just find the explanation missing.
              */}
              <Panel title="How long it takes">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  Immediate. We ask Inara who the key belongs to and verify you from their answer —
                  no queue and nobody else involved. Inara limits us to a couple of calls a minute
                  across the whole squadron, so a busy moment may mean a short wait.
                </p>
              </Panel>

{/*
                "What Inara is for" stood here and was removed on the squadron
                owner's instruction: not information members need. The page now
                says what your state IS and what to do about it, and explains
                our architecture to nobody.
              */}
            </>
          }
        >
          {/*
            ★ ONE STATUS PANEL, NOT TWO ★

            A `VerificationBadge` stood here announcing "Verified commander,
            CMDR X" directly above `SquadronStatus`, which announces the same
            thing — and worse, the badge said VERIFIED on the strength of the
            NAME ALONE while the panel beneath it said partially verified. Two
            components disagreeing about the headline state of the page.

            SquadronStatus wins because it is the one that knows about both
            halves. The badge is deleted rather than reworded: two sources for
            one fact is the problem, not the wording of either.

            The prose that sat between and below them has moved into the rail,
            where the other explanatory panels already live — a settings page
            should open with your state, not with three paragraphs about it.
          */}
          <SquadronStatus initial={status} />
          <InaraForm initial={status} />
        </PageBody>
      )}
    </>
  );
}
