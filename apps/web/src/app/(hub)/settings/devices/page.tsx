import type { Metadata } from 'next';
import {
  getMyDevices,
  getMyTelemetryConsent,
  getMe,
  getCompanionReleases,
} from '../../../../lib/api';
import { formatLocal } from '../../../../lib/time';
import { DevicesPanel } from './devices-panel';
import { TelemetryForm } from './telemetry-form';
import { CompanionDownload } from './download';
import {
  PageHeader,
  PageBody,
  Panel,
  Section,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export const metadata: Metadata = {
  title: "Companion app — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function DevicesPage() {
  const [devices, consent, me, releases] = await Promise.all([
    getMyDevices(),
    getMyTelemetryConsent(),
    getMe(),
    getCompanionReleases(),
  ]);

  const active = devices?.devices.length ?? 0;
  const lastSeen = devices?.devices
    .map((d) => d.lastUsedAt)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="COMPANION APP"
      />

      {devices === null || consent === null ? (
        <CouldNotLoad what="your paired devices" />
      ) : (
        <PageBody
          lead="The companion app reads your Elite Dangerous journals and keeps your squadron profile current. It is optional — everything here works without it, and running it is a recommendation rather than a requirement."
          rail={
            <>
              <Panel title="Status">
                <RailStat
                  label="Paired devices"
                  value={String(active)}
                  tone={active > 0 ? 'good' : 'default'}
                />
                <RailStat
                  label="Last upload"
                  value={
                    lastSeen === undefined
                      ? 'Never'
                      : formatLocal(lastSeen, me.user?.timezone ?? 'UTC', { withTime: false })
                  }
                />
                {/*
                  Counts what is SWITCHED OFF, because that is the exceptional
                  state now. Under opt-out "6 of 6 on" is the default and says
                  nothing; "2 switched off" is the fact worth surfacing.
                */}
                <RailStat
                  label="Switched off"
                  value={
                    consent.optOutCategories.length + consent.optOutEvents.length === 0
                      ? 'Nothing'
                      : `${consent.optOutCategories.length} categories, ${consent.optOutEvents.length} events`
                  }
                  tone={
                    consent.optOutCategories.length + consent.optOutEvents.length === 0
                      ? 'good'
                      : 'default'
                  }
                />
              </Panel>

              {/*
                The one thing that cannot be switched off, in the rail where it
                is visible while somebody works through the list. Burying "this
                part is not optional" below twenty toggles would be a way of not
                saying it.
              */}
              <Panel title="Always collected">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  That you played, and when. Nothing else. The monthly promotion check reads it, so
                  switching it off would stop you qualifying for promotions without telling you
                  why — which is why it is the one exception. Running the app at all is still
                  entirely optional.
                </p>
              </Panel>

              <Panel title="Never collected">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  Your chat, your friends list, how you died, or your credit balance. The filtering
                  happens on your own PC, before anything leaves it.
                </p>
              </Panel>

              <Panel title="Related">
                <a href="/companion" className="block text-sm text-[var(--color-brand-cyan-bright)]">
                  Get the app
                </a>
                <a
                  href="/settings/privacy"
                  className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
          {/*
            ★ THE DOWNLOAD COMES FIRST ★

            The order is: get it, pair it, choose what it sends. Somebody who
            has not installed the app cannot act on anything below, so putting
            the pairing panel above the download asks them to do step two first.
          */}
          <Section
            title="Download"
            description="Windows, macOS and Linux. Elite has had no native Mac client since 2015 and none on Linux, so players on both run it through CrossOver, Whisky or Proton — this is a normal Mac or Linux program that knows where those put the journal files."
          >
            <CompanionDownload assets={releases?.assets ?? []} />
          </Section>

                  Who can see this data
                </a>
              </Panel>
            </>
          }
        >
          <DevicesPanel initialDevices={devices.devices} timezone={me.user?.timezone ?? 'UTC'} />

          {/*
            ★ THE WHOLE CATALOGUE, BELOW THE DEVICES ★

            Devices first because pairing is what makes any of this happen, and
            somebody with no device paired has nothing to decide about yet.
          */}
          <Section
            title="What is collected"
            description="Everything is kept unless you switch it off. Each item says what it actually reveals — switching one off also deletes what has already been stored under it."
          >
            <TelemetryForm initial={consent} />
          </Section>
        </PageBody>
      )}
    </>
  );
}
