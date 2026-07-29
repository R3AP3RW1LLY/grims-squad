'use client';

import { useState } from 'react';
import type { DeviceRow } from '../../../../lib/api';
import { formatLocal } from '../../../../lib/time';
import { apiPost, apiDelete } from '../../../../lib/api-client';

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
  const [label, setLabel] = useState('');
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pair(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await apiPost<{ token: string; deviceId: string; label: string }>(
        '/v1/me/devices',
        { label },
      );
      setFreshToken(body.token);
      setDevices((d) => [
        {
          id: body.deviceId,
          label: body.label,
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...d,
      ]);
      setLabel('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

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
            No devices yet. Add one below, then paste the code into the app.
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

        {freshToken !== null && (
          <div className="mt-6 rounded border border-[var(--color-brand-orange)] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)]">
              Copy this now
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-primary)]">
              This is the only time it is shown. We keep only a fingerprint of it, so it cannot be
              displayed again — if you lose it, remove the device and add another.
            </p>
            <code className="mt-3 block break-all rounded bg-[var(--color-surface-panel-sunken)] p-3 font-mono text-sm text-[var(--color-text-primary)]">
              {freshToken}
            </code>
          </div>
        )}

        <form onSubmit={pair} className="mt-6 flex gap-3">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="desktop"
            maxLength={60}
            aria-label="Device name"
            className="flex-1 rounded border border-[var(--color-border-hairline)] bg-transparent px-3 py-2 text-[var(--color-text-primary)]"
          />
          <button
            type="submit"
            disabled={busy || label.trim() === ''}
            className="rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
          >
            Add device
          </button>
        </form>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          A name is how you tell &ldquo;the laptop I sold&rdquo; from &ldquo;this desktop&rdquo; when
          you come to remove one.
        </p>

        {error !== null && (
          <p role="alert" className="mt-4 text-sm text-[var(--color-semantic-hostile-bright)]">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
