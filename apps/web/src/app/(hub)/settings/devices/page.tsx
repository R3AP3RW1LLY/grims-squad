import type { Metadata } from 'next';
import { getMyDevices, getMyTelemetryConsent } from '../../../../lib/api';
import { DevicesPanel } from './devices-panel';
import {
  PageHeader,
  PageBody,
  Panel,
  RailStat,
  CouldNotLoad,
} from '../../../../components/hub-page';

export const metadata: Metadata = {
  title: "Companion app — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function DevicesPage() {
  const [devices, consent] = await Promise.all([getMyDevices(), getMyTelemetryConsent()]);

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
                  value={lastSeen === undefined ? 'Never' : new Date(lastSeen).toLocaleDateString()}
                />
                <RailStat
                  label="Extra categories"
                  value={`${consent.categories.length} of ${consent.available.length}`}
                />
              </Panel>

              {/*
                The baseline stated plainly, in the rail, where it is visible
                while somebody reads the opt-in list. Burying "this part is not
                optional" below six checkboxes would be a way of not saying it.
              */}
              <Panel title="Always collected">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  That you played, your ranks, and your ships. This is what the squadron runs on and
                  what the monthly rank check reads — it comes with running the app, which is itself
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
                  Who can see this data
                </a>
              </Panel>
            </>
          }
        >
          <DevicesPanel initialDevices={devices.devices} initialConsent={consent} />
        </PageBody>
      )}
    </>
  );
}
