'use client';

import { useState } from 'react';
import type { PrivacySettings } from '../../../lib/api';

/**
 * The privacy toggles.
 *
 * Each switch is saved on its own the moment it changes. No "save" button, on
 * purpose: a member who flips a switch to hide their credit balance and then
 * closes the tab has, as far as they are concerned, hidden it. A form that
 * needed submitting would leave it visible and give them no reason to think so.
 *
 * Saving one toggle sends ONLY that toggle. Sending the whole object back would
 * overwrite any change made in another tab, and the direction of that overwrite
 * is unpredictable — which is not acceptable for a privacy control.
 */

interface Toggle {
  key: keyof PrivacySettings;
  label: string;
  help: string;
}

const TOGGLES: readonly Toggle[] = [
  {
    key: 'showOnPublicRoster',
    label: 'List me on the public roster',
    help: 'Off by default. While this is off you do not appear on the roster at all, whatever else you turn on here.',
  },
  {
    key: 'showLocation',
    label: 'Show my last known position',
    help: 'The system and station your commander was last seen at.',
  },
  {
    key: 'showCredits',
    label: 'Show my credit balance',
    help: 'Most commanders leave this off.',
  },
  { key: 'showFleet', label: 'Show my ships', help: 'The ships you own and their names.' },
  {
    key: 'showActivity',
    label: 'Show my activity',
    help: 'Message and voice totals. Officers see activity for rank progression regardless of this setting — this controls whether it is shown to everyone else.',
  },
  {
    key: 'showOnLeaderboard',
    label: 'Include me on leaderboards',
    help: 'Off by default. Leaderboards are opt-in, separately from the roster.',
  },
];

function readCsrf(): string {
  // The CSRF cookie is deliberately readable — that is the whole mechanism. Its
  // name carries the __Host- prefix over https and not over plain http, so both
  // spellings are checked rather than assuming the deployed one.
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}

export function PrivacyForm({ initial }: { initial: PrivacySettings }) {
  const [settings, setSettings] = useState<PrivacySettings>(initial);
  const [busy, setBusy] = useState<keyof PrivacySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function set(key: keyof PrivacySettings, value: boolean) {
    const previous = settings[key];
    // Optimistic, then reverted on failure. A switch that stays where the
    // member put it while the save is failing is a lie about a privacy setting.
    setSettings((s) => ({ ...s, [key]: value }));
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/v1/me/privacy', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': readCsrf() },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const saved = (await res.json()) as PrivacySettings;
      // Trust the SERVER's answer over the optimistic guess, so a rejected or
      // adjusted value shows what is actually stored.
      setSettings(saved);
    } catch {
      setSettings((s) => ({ ...s, [key]: previous }));
      setError('That change was not saved. Your setting is unchanged — please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-10">
      {error !== null && (
        <p
          role="alert"
          className="mb-6 rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {error}
        </p>
      )}

      <ul className="space-y-1">
        {TOGGLES.map((t) => {
          const on = settings[t.key];
          return (
            <li key={t.key} className="border-b border-[var(--color-border-hairline)] py-5">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <label
                    htmlFor={`toggle-${t.key}`}
                    className="block text-[var(--color-text-primary)]"
                  >
                    {t.label}
                  </label>
                  <p
                    id={`help-${t.key}`}
                    className="mt-1 max-w-[60ch] text-sm text-[var(--color-text-muted)]"
                  >
                    {t.help}
                  </p>
                </div>
                {/*
                  A real checkbox. A styled div with role="switch" loses keyboard
                  behaviour, form semantics and the screen-reader announcement of
                  its own state — none of which are worth trading for a nicer
                  default appearance on a privacy control.
                */}
                <input
                  id={`toggle-${t.key}`}
                  type="checkbox"
                  role="switch"
                  checked={on}
                  disabled={busy === t.key}
                  aria-describedby={`help-${t.key}`}
                  onChange={(e) => void set(t.key, e.currentTarget.checked)}
                  className="mt-1 h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] transition-colors before:ml-[3px] before:block before:h-4 before:w-4 before:translate-y-[3px] before:rounded-full before:bg-[var(--color-text-muted)] before:transition-transform checked:border-[var(--color-brand-cyan-bright)] checked:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_28%,transparent)] checked:before:translate-x-5 checked:before:bg-[var(--color-brand-cyan-bright)] disabled:opacity-50"
                />
              </div>
            </li>
          );
        })}
      </ul>

      <p aria-live="polite" className="sr-only">
        {busy === null ? 'Settings saved.' : 'Saving.'}
      </p>
    </div>
  );
}
