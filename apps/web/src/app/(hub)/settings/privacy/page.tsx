import type { Metadata } from 'next';
import { getMyPrivacy } from '../../../../lib/api';
import { PrivacyForm } from './privacy-form';
import {
  PageHeader,
  PageBody,
  Panel,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export const metadata: Metadata = {
  title: "Privacy — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function PrivacySettingsPage() {
  const settings = await getMyPrivacy();

  /*
   * Counted for the rail, and worth counting: the toggles are individually
   * clear but collectively hard to hold in your head. "Two of six on" is the
   * answer to the question a member actually has, which is "how exposed am I".
   */
  const shown =
    settings === null
      ? 0
      : [
          settings.showOnPublicRoster,
          settings.showLocation,
          settings.showCredits,
          settings.showFleet,
          settings.showActivity,
          settings.showOnLeaderboard,
        ].filter(Boolean).length;

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="PRIVACY"
      />

      {settings === null ? (
        <CouldNotLoad what="your privacy settings" />
      ) : (
        <PageBody
          lead="Everything here starts switched off. Nothing on this list is shared with anyone until you turn it on, and each item is separate — showing your position does not also show your balance."
          rail={
            <>
              <Panel title="At a glance">
                <RailStat
                  label="Fields shared"
                  value={`${shown} of 6`}
                  tone={shown === 0 ? 'good' : 'default'}
                />
                <RailStat
                  label="On the roster"
                  value={settings.showOnPublicRoster ? 'Yes' : 'No'}
                />
                <RailStat
                  label="On leaderboards"
                  value={settings.showOnLeaderboard ? 'Yes' : 'No'}
                />
              </Panel>

              <Panel title="How this works">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  Changes save as you make them — there is no button to forget. A field you have not
                  turned on is left out of the answer entirely rather than sent blank, so nothing can
                  infer it from an empty space.
                </p>
              </Panel>

              <Panel title="Related">
                <a href="/roster" className="block text-sm text-[var(--color-brand-cyan-bright)]">
                  See the roster
                </a>
                <a
                  href="/settings/devices"
                  className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  What the companion app sends
                </a>
              </Panel>
            </>
          }
        >
          <PrivacyForm initial={settings} />
        </PageBody>
      )}
    </>
  );
}
