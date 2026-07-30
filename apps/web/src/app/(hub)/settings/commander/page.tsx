import type { Metadata } from 'next';
import { getInaraStatus, getMe, getTimezones } from '../../../../lib/api';
import { SquadronStatus } from './squadron-status';
import { VerificationProvider } from './verification-state';
import { LiveRefresh } from '../../../../components/live-refresh';
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
import { SignatureEditor } from './signature-editor';
import { PrivacyControls, sharedFields } from '../privacy/body';
import { appVersionSummary } from '../../../../components/update-banner-rules';
import { getMyPrivacy, getUpdateStatus } from '../../../../lib/api';
import { SecurityBody } from '../security/body';
import { AccountBody } from '../account/body';

export const metadata: Metadata = {
  title: "Commander management — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

/**
 * ★ EVERYTHING ABOUT YOUR ACCOUNT, IN ONE PLACE ★
 *
 * Privacy, Security and Account were three more sidebar entries and three more
 * routes. Answering "how is my account set up" meant four page loads, and each
 * of those pages carried a "Related" panel whose entire job was hopping to the
 * other three — a rail full of links to the rest of the same page.
 *
 * They are tabs now. The old routes redirect rather than 404, because those
 * URLs are in bookmarks and quite possibly in a pinned Discord message.
 *
 * ★ WHAT DELIBERATELY DID NOT MOVE ★
 *
 * The companion app keeps its own sidebar entry. It is not a setting — it is
 * software somebody downloads and installs, and burying the download three
 * tabs deep in an account screen is how nobody finds it.
 *
 * Settings is FIRST and default, because it is the one people come back for.
 * Verification is second because it happens once, usually in somebody's first
 * week, and never again.
 */
const TABS: readonly PageTab[] = [
  { key: 'settings', label: 'Commander settings' },
  { key: 'verification', label: 'Name & verification' },
  /*
   * ★ PRIVACY IS NOT A TAB ANY MORE — squadron owner, 2026-07-29 ★
   *
   * Its content sits on this first tab, beneath the timezone. It was two
   * clicks and a page load away from the settings it belongs with, and a tab
   * holding five switches is a tab somebody has to remember exists.
   *
   * `?tab=privacy` still resolves: `resolveTab` falls back to the first tab for
   * anything it does not recognise, so an old bookmark lands on the page that
   * now holds the same controls rather than on a 404.
   */
  { key: 'security', label: 'Security' },
  /*
   * Squadron owner, 2026-07-30: "this should be built in a new tab on the commander profile page".
   *
   * Placed before Account rather than last: Account holds the things you touch once (export,
   * delete), and a tab people will actually visit should not sit behind them.
   */
  { key: 'signature', label: 'Forum signature' },
  { key: 'account', label: 'Account' },
];

export default async function CommanderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = resolveTab(TABS, params['tab']);

  /*
   * Privacy is fetched HERE as well as inside `PrivacyControls`, because the
   * rail summary and the switches must agree — and Next dedupes identical
   * fetches within one render, so this costs no second request.
   */
  const [status, me, zones, privacy, updates] = await Promise.all([
    getInaraStatus(),
    getMe(),
    getTimezones(),
    getMyPrivacy(),
    /*
     * The companion app's version, for the status rail. Squadron owner,
     * 2026-07-29.
     *
     * Fetched here with everything else rather than inside its own component,
     * so a slow release bucket cannot make this page render in two stages — and
     * so the rail is derived from exactly the same numbers as the update banner
     * in the layout above. Two places deriving that separately is how a member
     * ends up with a bar saying "update available" over a panel saying they are
     * current.
     */
    getUpdateStatus(),
  ]);

  /*
   * Null covers a signed-out read, an unreachable release bucket, and an API
   * that is down. An empty shape is passed rather than skipping the row: a
   * status panel with a hole in it reads as broken, and "Not installed" is the
   * honest answer when we have been told nothing.
   */
  const app = appVersionSummary(
    updates ?? { latestVersion: null, releasedAt: null, deviceVersions: [] },
  );

  const sharedFieldCount = sharedFields(privacy);
  const verified = status?.cmdrName ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="COMMANDER MANAGEMENT"
        action={<PageTabs tabs={TABS} current={tab} basePath="/settings/commander" />}
      />

      {/*
        The folded tabs fetch their own data and are rendered BEFORE the
        commander-specific branches, so a failure to load Inara status — which
        only the first two tabs need — cannot blank a privacy screen that never
        depended on it.
      */}
      {tab === 'signature' ? (
        <PageBody lead="How you appear on the forums. None of this changes your Discord photo.">
          <SignatureEditor
            discordAvatarUrl={me.user?.avatarUrl ?? null}
            /*
             * Real values, so the banner preview shows THEIR name and rank on first paint. A
             * generator that shows placeholders until a request lands is one people design
             * against the placeholder and then find looks wrong with their own details in it.
             */
            who={{
              commander: verified,
              rank: me.user?.rank ?? null,
              squadron: 'GRIM’S SQUAD',
            }}
          />
        </PageBody>
      ) : tab === 'security' ? (
        <SecurityBody />
      ) : tab === 'account' ? (
        <AccountBody />
      ) : status === null ? (
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
                {/*
                  Moved off the deleted Privacy tab. "How exposed am I" is the
                  question the toggles below answer collectively, and it is
                  hard to hold five switches in your head at once.
                */}
                <RailStat
                  label="Fields shared"
                  value={`${sharedFieldCount} of 5`}
                  tone={sharedFieldCount === 0 ? 'good' : 'default'}
                />

                {/*
                  ★ THE COMPANION APP — squadron owner, 2026-07-29 ★

                  "add a way to compare the members current version of the
                  companion app... if they do not have the app installed, add a
                  link to the download page, if they do run the app, show the
                  version here."

                  Derived by `appVersionSummary` from the SAME numbers the update
                  banner reads. That is the point of it living in that file: a
                  rail saying "v0.3.0" under a bar saying "update available" is
                  worse than either message on its own, and is exactly the
                  confusion being reported.

                  The version is what the app itself reported on its five-minute
                  poll, so it is what is actually installed rather than what we
                  hope is.
                */}
                <RailStat label="Companion app" value={app.label} tone={app.tone} />
                {app.href !== null && app.linkText !== null && (
                  <a
                    href={app.href}
                    className="mt-1 block text-xs text-[var(--color-brand-cyan-bright)] hover:underline"
                  >
                    {app.linkText}
                  </a>
                )}
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

          {/*
            ★ THE PRIVACY CONTROLS, ON THE PAGE THEY BELONG TO ★

            These had a tab of their own. Five switches do not need one, and a
            tab is a thing somebody has to remember exists — whereas the answer
            to "what does the squadron see about me" belongs beside the rest of
            a member's own settings, where they are already looking.

            Rendered as a SECTION rather than the whole body it used to be, so
            it inherits this page's rail instead of bringing a second one.
          */}
          <PrivacyControls />
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
          {/*
            ★ ONE STATUS, AND IT LISTENS ★

            These two panels each held a private `useState(initial)` copy of the
            verification status. Pasting a key into the form proved the
            commander name and updated the FORM, while the panel above it — the
            one that announces verification in the largest text on the page —
            went on saying "Not verified" until somebody reloaded by hand.

            `LiveRefresh` re-runs this server component when the API says the
            member's verification moved: their own action in another tab, an
            officer approving from the console, or the fifteen-minute squadron
            re-check finally getting an answer out of Inara. The provider adopts
            each fresh snapshot, which a `useState` initialiser could not do.
          */}
          <LiveRefresh types={['verification']} />
          <VerificationProvider initial={status}>
            <SquadronStatus />
            <InaraForm />
          </VerificationProvider>
        </PageBody>
      )}
    </>
  );
}
