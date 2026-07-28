'use client';

import { useState } from 'react';
import type { DeviceRow, TelemetryConsent } from '../../../lib/api';
import { errorFromResponse } from '../../../lib/api-error';

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

const CATEGORY_COPY: Record<string, { label: string; help: string }> = {
  session: {
    label: 'That I played',
    help: 'Only that you launched the game, and when. Nothing about what you did. This is the one the monthly rank check looks at — without it you cannot qualify for a promotion.',
  },
  profile: {
    label: 'My ranks and squadron standing',
    help: 'Combat, trade, exploration, the naval ranks and your progress toward the next one, plus your squadron rank as the game reports it.',
  },
  fleet: {
    label: 'My ships',
    help: 'The ships you own, where they are parked, and the modules fitted to the one you are flying. Never what any of it is worth.',
  },
};

function readCsrf(): string {
  // Deliberately readable — that is the whole mechanism. The __Host- prefix is
  // used over https and not over plain http, so both spellings are checked.
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}

export function DevicesPanel({
  initialDevices,
  initialConsent,
}: {
  initialDevices: DeviceRow[];
  initialConsent: TelemetryConsent;
}) {
  const [devices, setDevices] = useState(initialDevices);
  const [consent, setConsent] = useState(initialConsent);
  const [label, setLabel] = useState('');
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purged, setPurged] = useState<number | null>(null);

  async function pair(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setPurged(null);
    try {
      const res = await fetch('/v1/me/devices', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': readCsrf() },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw await errorFromResponse(res);

      const body = (await res.json()) as { token: string; deviceId: string; label: string };
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
      const res = await fetch(`/v1/me/devices/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': readCsrf() },
      });
      if (!res.ok) throw await errorFromResponse(res);
      setDevices((d) => d.filter((row) => row.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleCategory(category: string, on: boolean) {
    const next = on
      ? [...consent.categories, category]
      : consent.categories.filter((c) => c !== category);

    setBusy(true);
    setError(null);
    setPurged(null);
    try {
      /*
       * The WHOLE set is sent, not one flag. A screen that patched a single
       * toggle would race itself when two are changed quickly, and the second
       * request would overwrite the first with a stale view of the rest.
       */
      const res = await fetch('/v1/me/telemetry-consent', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': readCsrf() },
        body: JSON.stringify({ categories: next }),
      });
      if (!res.ok) throw await errorFromResponse(res);

      const saved = (await res.json()) as { categories: string[]; purged: number };
      // The SERVER's answer, not the optimistic guess. A consent control that
      // shows what you asked for rather than what was stored is a lie.
      setConsent((c) => ({ ...c, categories: saved.categories }));
      if (saved.purged > 0) setPurged(saved.purged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 space-y-12">
      {/* ---------------------------------------------------------- consent */}
      <section>
        <h2 className="font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
          What the app may send
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          All off to start with. Turning one off again deletes what has already been collected under
          it.
        </p>

        <ul className="mt-5 space-y-4">
          {consent.available.map((category) => {
            const copy = CATEGORY_COPY[category] ?? { label: category, help: '' };
            const on = consent.categories.includes(category);
            return (
              <li key={category} className="rounded border border-[var(--color-border-hairline)] p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={(e) => void toggleCategory(category, e.target.checked)}
                    className="mt-1 h-4 w-4 accent-[var(--color-brand-orange)]"
                  />
                  <span>
                    <span className="text-[var(--color-text-primary)]">{copy.label}</span>
                    <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">
                      {copy.help}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {purged !== null && (
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
            {purged === 1 ? '1 stored event was' : `${purged} stored events were`} deleted.
          </p>
        )}
      </section>

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
                      : `Last sent ${new Date(device.lastUsedAt).toLocaleString()}`}
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
