'use client';

import { useState } from 'react';
import { apiCall } from '../../../lib/api-client';
import {
  BUILD_VISIBILITIES,
  BUILD_VISIBILITY_LABELS,
  BUILD_VISIBILITY_NOTES,
  type BuildVisibility,
} from '@grims/shared/ship-build';
import type { ShipBuild } from '@grims/shared/ship-build';

/**
 * Save this build, and choose who may see it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "also include shareable links, and the ability for our users to share their builds and make them
 * visible to the squadron and public if they choose to."
 *
 * ★ THE CHOICE IS MADE BEFORE SAVING, NOT AFTER ★
 *
 * The obvious design is Save, then a Share button on the result. That makes "private" the thing
 * that happens by default and sharing a second, deliberate act — which sounds safe and produces a
 * board nobody ever posts to, because the moment of wanting to show somebody is the moment of
 * finishing the build.
 *
 * So the visibility is part of saving, and it is spelled out rather than defaulted quietly: three
 * radio buttons, each with the sentence that says what it actually means. `private` is
 * pre-selected, so a member who does not read them still ends up with the quiet option.
 */

const ORIGIN_NOTE = 'Anyone with this link can open the build.';

export function SaveBuild({
  build,
  shipName,
  signedIn,
}: {
  readonly build: ShipBuild;
  readonly shipName: string;
  /** A visitor may plan a ship but has nowhere to save it to. */
  readonly signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<BuildVisibility>('private');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ token: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!signedIn) {
    return (
      <p className="m-0 text-[11px] text-[var(--color-text-dim)]">
        {/*
          Stated plainly rather than hiding the control. Somebody who has spent ten minutes fitting
          a ship should be told why there is no save button, not left looking for one.
        */}
        Sign in with Discord to save this build and share it with the squadron.
      </p>
    );
  }

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);

    try {
      /*
       * ★ apiCall, NOT fetch — AND A TEST INSISTS ON IT ★
       *
       * A hand-rolled fetch here would have skipped three things the wrapper does: the CSRF header
       * on a mutating call, the one-shot refresh-and-retry when the session has expired mid-page
       * (an outfitter is a screen somebody sits on for ten minutes), and the extraction of the
       * server's own error message.
       *
       * That last one matters most here: the API knows WHICH permission was missing. "You cannot
       * publish builds outside the squadron" is a useful sentence; "Something went wrong" sends
       * somebody to an officer with nothing to say.
       */
      const result = await apiCall<{ shareToken: string | null }>(
        'POST',
        '/v1/ai/shipyard/builds',
        { body: { build, buildName: name.trim() === '' ? null : name.trim(), visibility } },
      );

      setSaved({ token: result.shareToken });
    } catch (err) {
      setError(
        err instanceof Error && err.message !== ''
          ? err.message
          : 'The build could not be saved. Try again in a moment.',
      );
    } finally {
      setSaving(false);
    }
  };

  const shareUrl =
    saved?.token == null ? null : `${window.location.origin}/shipyard/build/${saved.token}`;

  if (saved !== null) {
    return (
      <div className="rounded-lg border border-[var(--color-brand-cyan)] bg-[color-mix(in_srgb,var(--color-brand-cyan)_8%,transparent)] p-4">
        <p className="m-0 text-sm text-[var(--color-text-primary)]">
          Saved{name.trim() === '' ? '' : ` as “${name.trim()}”`}.
        </p>

        {shareUrl === null ? (
          <p className="m-0 mt-1 text-[11px] text-[var(--color-text-secondary)]">
            Only you can see it. You can share it later from your saved builds.
          </p>
        ) : (
          <>
            <p className="m-0 mt-1 text-[11px] text-[var(--color-text-secondary)]">{ORIGIN_NOTE}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-primary)]"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl).then(() => setCopied(true));
                }}
                className="rounded border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)] px-3 py-1.5 text-[12px] text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_22%,transparent)]"
      >
        Save this build
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel-sunken)] p-4">
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
          Call it something
        </span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${shipName} — my build`}
          className="mt-1 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
        />
      </label>

      <fieldset className="mt-4 border-0 p-0">
        <legend className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
          Who can see it
        </legend>
        <div className="space-y-1.5">
          {BUILD_VISIBILITIES.map((option) => (
            <label key={option} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="visibility"
                value={option}
                checked={visibility === option}
                onChange={() => setVisibility(option)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[12px] text-[var(--color-text-primary)]">
                  {BUILD_VISIBILITY_LABELS[option]}
                </span>
                <span className="block text-[11px] text-[var(--color-text-secondary)]">
                  {BUILD_VISIBILITY_NOTES[option]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error !== null && (
        <p className="mt-3 rounded border border-[var(--color-semantic-hostile)] bg-[color-mix(in_srgb,var(--color-semantic-hostile)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--color-semantic-hostile-bright)]">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)] px-3 py-1.5 text-[12px] text-[var(--color-brand-orange-bright)] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setOpen(false)}
          className="rounded border border-[var(--color-border-hairline)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
