'use client';

import { useState } from 'react';
import type { PrivacySettings } from '../../../../lib/api';
import { apiPatch } from '../../../../lib/api-client';

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
  /*
   * ★ THE ROSTER TOGGLE IS GONE, DELIBERATELY ★
   *
   * Appearing on the roster stopped being optional on 2026-07-28: it is the
   * squadron's own directory, behind the sign-in, and one that most of the team
   * is missing from does not answer the question it exists for.
   *
   * The switch is REMOVED rather than shown disabled. A control that cannot
   * change anything is a control that lies about what a member can decide, and
   * a greyed-out one invites them to keep trying.
   *
   * Every field BELOW is still opt-in and still defaults to off. Being listed
   * means a name and a rank; everything beyond that is theirs to give.
   */
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
  {
    /*
     * ★ NOT A PRIVACY TOGGLE, AND IT SAYS SO ★
     *
     * Every other switch here controls what OTHERS see of you. This one controls what YOU see of
     * them, and it is on this page because this is where a member's own switches live and it
     * arrives in the same request.
     *
     * The help text carries that distinction, because a reading setting filed among privacy
     * settings would otherwise read as "hide my fonts from other people".
     */
    key: 'plainFonts',
    label: 'Show all posts in the site font',
    help: 'For you only, everywhere on the site. Commanders can pick from thirty fonts for their posts and signatures; this ignores all of them and renders everything in the plain site face. It changes nothing about how your own posts look to anybody else.',
  },
];

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
      const saved = await apiPatch<PrivacySettings>('/v1/me/privacy', { [key]: value });
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
                    className="mt-1 max-w-[60ch] text-sm text-[var(--color-text-secondary)]"
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
                  className="mt-1 h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] transition-colors before:ml-[3px] before:block before:h-4 before:w-4 before:translate-y-[3px] before:rounded-full before:bg-[var(--color-text-secondary)] before:transition-transform checked:border-[var(--color-brand-cyan-bright)] checked:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_28%,transparent)] checked:before:translate-x-5 checked:before:bg-[var(--color-brand-cyan-bright)] disabled:opacity-50"
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
