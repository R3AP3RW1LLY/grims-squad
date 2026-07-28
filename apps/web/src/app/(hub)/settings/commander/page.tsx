import type { Metadata } from 'next';
import { CheckBadgeIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
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
          lead="Link your Inara account and we can confirm which commander is yours, rather than taking your word for it. Your Discord nickname is then kept matching your in-game name."
          rail={
            <>
              <Panel title="Status">
                <RailStat
                  label="Commander"
                  value={verified ?? 'Not verified'}
                  tone={verified === null ? 'default' : 'good'}
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

              <Panel title="What Inara is for">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  Two things only: confirming your commander name, and checking you are in
                  Grim&rsquo;s Squad. Ranks, ships, loadouts and activity come from the{' '}
                  <a href="/companion" className="text-[var(--color-brand-cyan-bright)]">
                    companion app
                  </a>
                  , which reads the game&rsquo;s own journals and carries far more than Inara has.
                </p>
              </Panel>
            </>
          }
        >
          <VerificationBadge cmdrName={verified} />

          <p className="mt-6 max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Entirely optional. Without a key an officer verifies you by hand instead — it works just
            as well, it simply needs a person. Adding a key later upgrades you without anyone else
            being involved.
          </p>

          <div className="mt-6">
            {/*

              Where they stand, ABOVE the key form.

            

              A member arriving here wants to know whether they are verified before

              they want a form. Putting the form first answers a question they have

              not asked yet.

            */}
            <SquadronStatus initial={status} />
            <InaraForm initial={status} />
          </div>

          <div className="mt-14">
            <Section title="What we do with it">
              <ul className="space-y-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                <li>
                  We ask Inara which commander the key belongs to. That answer is what verifies you —
                  you never type your own commander name here.
                </li>
                <li>
                  The key is encrypted before it is stored and is never shown again, to you or to
                  anyone else.
                </li>
                <li>
                  Removing the key does not un-verify you. You proved it once; taking the key back is
                  about us not calling Inara on your behalf any more.
                </li>
              </ul>
            </Section>
          </div>
        </PageBody>
      )}
    </>
  );
}

/**
 * Verified, or not — at a glance.
 *
 * ★ AN ICON *AND* WORDS ★
 *
 * A tick on its own is a colour-coded state with no text: unreadable to anyone
 * who cannot tell the two colours apart, and meaningless to a screen reader.
 * The icon makes the state scannable; the words make it unambiguous.
 *
 * The unverified case says what to DO. "Not verified" alone is a diagnosis, and
 * somebody reading it has no idea whether they are supposed to act.
 */
function VerificationBadge({ cmdrName }: { cmdrName: string | null }) {
  if (cmdrName !== null) {
    return (
      <div className="flex items-start gap-4 rounded-lg border border-[var(--color-semantic-success)] bg-[color-mix(in_srgb,var(--color-semantic-success)_8%,transparent)] p-5">
        <CheckBadgeIcon
          aria-hidden="true"
          className="size-8 shrink-0 text-[var(--color-semantic-success)]"
        />
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-semantic-success)]">
            Verified commander
          </p>
          <p
            className="mt-1 text-xl text-[var(--color-text-primary)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            CMDR {cmdrName.toUpperCase()}
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Your Discord nickname is kept matching this name.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-4 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
      <ExclamationCircleIcon
        aria-hidden="true"
        className="size-8 shrink-0 text-[var(--color-semantic-warning)]"
      />
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-semantic-warning)]">
          Not verified
        </p>
        <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-[var(--color-text-primary)]">
          Nobody has confirmed which commander is yours yet. Link an Inara key below, or ask an
          officer to verify you by hand — both end in the same place.
        </p>
      </div>
    </div>
  );
}
