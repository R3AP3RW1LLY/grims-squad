'use client';

import { useState } from 'react';
import { apiCall } from '../lib/api-client';

/**
 * Choosing your own Discord nickname.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "if they are an officer their names should match the same convention please, but add a step to
 * onboarding that allows them to overide their discord server nickname ... if an officer overrides
 * their name, then this is the name that stays as their discord nickname it should not change from
 * that unless they change it."
 *
 * ★ ONE COMPONENT, TWO PLACES ★
 *
 * The onboarding step and the settings control do the same job, so they are the same component.
 * `onDone` is the only difference: onboarding continues to the site afterwards, settings stays put.
 * Two copies would drift, and the drift would be an officer told one thing on the way in and
 * another when they came back to change it.
 */

export interface NicknameState {
  nickname: string | null;
  convention: string | null;
  override: string | null;
  source: string | null;
  mayOverride: boolean;
  unverified: boolean;
}

export function NicknameChooser({
  initial,
  onDone,
}: {
  readonly initial: NicknameState;
  /** Where to go once they have decided. Only onboarding sets it. */
  readonly onDone?: string;
}) {
  const [state, setState] = useState(initial);
  const [value, setValue] = useState(initial.override ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = async (nickname: string | null): Promise<void> => {
    setBusy(true);
    setError(null);
    setNote(null);

    try {
      const next = await apiCall<NicknameState & { pushed: boolean; pushedReason: string | null }>(
        'POST',
        '/v1/me/nickname',
        { body: { nickname } },
      );

      setState(next);
      setValue(next.override ?? '');
      /*
       * The guild write is reported rather than assumed. The bot cannot rename the server owner,
       * and Discord rate limits — telling somebody their name is set when the member list still
       * shows the old one is the kind of small lie that costs trust in everything else the page
       * says.
       */
      setNote(
        next.pushed
          ? 'Saved, and your Discord nickname has been updated.'
          : `Saved. Discord was not updated${next.pushedReason === null ? '' : ` — ${next.pushedReason}`}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be saved just now.');
    } finally {
      setBusy(false);
    }
  };

  if (!state.mayOverride) {
    /*
     * Shown rather than hidden. Somebody who has heard that officers can choose should be told why
     * they cannot, not left to conclude the page is broken.
     */
    return (
      <div>
        <p className="m-0 text-[var(--color-text-primary)]">
          Your Discord nickname is{' '}
          <strong className="text-[var(--color-brand-cyan-bright)]">
            {state.convention ?? 'not set yet'}
          </strong>
          , taken from your verified Inara commander name.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Everyone in the squadron wears their commander name so the member list reads the same way
          in Discord as it does in game. Officers can set something different, and can grant that to
          anybody who needs it — ask one if your name cannot be written the usual way.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="m-0 text-[var(--color-text-primary)]">
        You are wearing{' '}
        <strong className="text-[var(--color-brand-cyan-bright)]">
          {state.nickname ?? 'no nickname yet'}
        </strong>
        {state.override === null ? ', taken from your Inara commander name.' : ', which you chose.'}
      </p>

      {state.unverified && (
        /*
          The owner's answer for members with no Inara link was "nudge them, then leave it". This is
          the nudge — nothing is renamed, and an officer with no verified name can still choose one.
        */
        <p className="mt-3 rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_8%,transparent)] px-4 py-3 text-sm text-[var(--color-brand-orange)]">
          You have not linked a verified Inara commander yet, so there is no name to fall back on. If
          you clear this, your nickname will simply be left as it is.
        </p>
      )}

      <label className="mt-5 block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
          Your nickname
        </span>
        <input
          value={value}
          maxLength={32}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          placeholder={state.convention ?? 'Commander name'}
          className="w-full max-w-md rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
        />
      </label>

      <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {/*
          Said plainly, because it surprises people: an override changes WHICH name you wear, not
          the house style. Somebody typing lower case and getting capitals back would otherwise
          think the box was broken.
        */}
        The squadron style still applies — each word is capitalised, and anything in &ldquo;quotes&rdquo;
        becomes a callsign in capitals. Leave it empty to go back to your Inara name.
      </p>

      {error !== null && (
        <p
          role="alert"
          className="mt-4 rounded border border-[var(--color-semantic-hostile)] px-4 py-3 text-sm text-[var(--color-semantic-hostile-bright)]"
        >
          {error}
        </p>
      )}

      {note !== null && (
        <p className="mt-4 rounded border border-[var(--color-brand-cyan)] px-4 py-3 text-sm text-[var(--color-brand-cyan-bright)]">
          {note}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(value.trim() === '' ? null : value)}
          className="rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)] px-4 py-2 text-sm text-[var(--color-brand-orange-bright)] disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>

        {state.override !== null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="rounded border border-[var(--color-border-hairline)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
          >
            Use my Inara name
          </button>
        )}

        {onDone !== undefined && (
          <a
            href={onDone}
            className="rounded border border-[var(--color-border-subtle)] px-4 py-2 text-sm text-[var(--color-text-secondary)] no-underline hover:text-[var(--color-text-primary)]"
          >
            {/*
              "Continue", not "Skip". Keeping the convention is a real answer and the commonest one,
              and calling it skipping frames the default as something you failed to do.
            */}
            {state.override === null ? 'Keep my Inara name and continue' : 'Continue'}
          </a>
        )}
      </div>
    </div>
  );
}
