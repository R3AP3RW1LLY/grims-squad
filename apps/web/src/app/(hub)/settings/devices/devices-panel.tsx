'use client';

import { useState } from 'react';
import type { DeviceRow } from '../../../../lib/api';
import { formatLocal } from '../../../../lib/time';
import { apiDelete } from '../../../../lib/api-client';

/**
 * Pairing the companion app, and choosing what it may send.
 *
 * ★ THE TOKEN IS SHOWN ONCE ★
 *
 * We hold only its hash, so there is no "show it again" to build — and the
 * screen has to say so before the member navigates away, not after. It is
 * displayed as text they can copy rather than hidden behind a reveal, because
 * the next thing they will do is paste it into the app.
 *
 * ★ CONSENT IS A SEPARATE ACT FROM PAIRING ★
 *
 * Pairing a device is permission to TALK to us. It is not permission to
 * collect, and rolling the two together would make "install the app" mean
 * "agree to everything" — which is how you end up with consent nobody
 * remembers giving.
 */

export function DevicesPanel({
  initialDevices,
  timezone,
}: {
  initialDevices: DeviceRow[];
  /** The member's own zone. Passed in so the server renders the right time first go. */
  timezone: string;
}) {
  const [devices, setDevices] = useState(initialDevices);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/v1/me/devices/${encodeURIComponent(id)}`);
      setDevices((d) => d.filter((row) => row.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 space-y-12">
      {/*
        ★ THE CONSENT UI MOVED OUT OF HERE (2026-07-29) ★

        This section listed six optional categories with a checkbox each, under
        the heading "What the app may send" and the line "All off to start
        with". Every word of that is now wrong: telemetry is opt-out, the app
        sends what it reads, and a member declines by category OR by individual
        event.

        It lives in `telemetry-form.tsx`, which renders the catalogue the SERVER
        publishes — so the page cannot offer a switch the server would reject.
        This panel owns DEVICES and nothing else.
      */}

      {/* ---------------------------------------------------------- pairing */}
      <section>
        <h2 className="font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
          Paired devices
        </h2>

        {devices.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            No devices yet. Open the companion app and choose{' '}
            <span className="text-[var(--color-text-primary)]">Sign in with Discord</span> — it will
            bring you back here to confirm.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex items-center justify-between rounded border border-[var(--color-border-hairline)] p-4"
              >
                <span>
                  <span className="text-[var(--color-text-primary)]">{device.label}</span>
                  <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">
                    {device.lastUsedAt === null
                      ? 'Never used — it has not sent anything yet.'
                      : `Last sent ${formatLocal(device.lastUsedAt, timezone)}`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke(device.id)}
                  className="rounded border border-[var(--color-border-hairline)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {/*
          ★ THE KEY GENERATOR IS GONE — squadron owner, 2026-08-01 ★

          "COMPANION Discord login; remove key generator"

          This used to mint a `gsq_…` token, show it once in an orange box headed "copy this now",
          and ask the member to paste it into the app. Six steps, one of which was handling a live
          credential by hand — and the most likely place for it to end up was a chat message asking
          for help with the step before.

          The app now starts the link itself and sends the member here to approve it, so nothing is
          ever displayed that would be worth stealing. This panel keeps the half that is still
          needed: seeing what is connected, and disconnecting it.
        */}
        <div className="mt-6 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4">
          <p className="text-sm text-[var(--color-text-primary)]">
            Devices are added from the app itself. Open the companion, choose{' '}
            <span className="text-[var(--color-brand-cyan-bright)]">Sign in with Discord</span>, and
            approve it in the browser window it opens.
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Nothing to copy and no key to keep safe.{' '}
            <a href="/companion" className="text-[var(--color-brand-cyan-bright)] underline underline-offset-4">
              Get the companion app
            </a>
            .
          </p>
        </div>

        {error !== null && (
          <p role="alert" className="mt-4 text-sm text-[var(--color-semantic-hostile-bright)]">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
