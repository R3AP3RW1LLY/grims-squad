import type { Metadata } from 'next';
import { getMyDevices, getMyTelemetryConsent } from '../../../lib/api';
import { DevicesPanel } from './devices-panel';

export const metadata: Metadata = {
  title: "Companion app — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function DevicesPage() {
  const [devices, consent] = await Promise.all([getMyDevices(), getMyTelemetryConsent()]);

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[70ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Your account
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          COMPANION APP
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        {devices === null || consent === null ? (
          <div className="mt-8">
            <p className="text-lg text-[var(--color-text-primary)]">
              Sign in to pair the companion app.
            </p>
            <a
              href="/v1/auth/discord"
              className="mt-6 inline-block rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]"
            >
              Sign in with Discord
            </a>
          </div>
        ) : (
          <>
            <p className="mt-6 text-lg text-[var(--color-text-primary)]">
              The companion app reads your Elite Dangerous journals and keeps your squadron profile
              current. It is optional — everything here works without it, and running it is a
              recommendation rather than a requirement.
            </p>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              What it sends is decided on your own PC, before anything leaves it. Nothing is stored
              here until you choose a category below, and turning one off deletes what was already
              collected under it.
            </p>
            <DevicesPanel initialDevices={devices.devices} initialConsent={consent} />
          </>
        )}
      </div>
    </main>
  );
}
