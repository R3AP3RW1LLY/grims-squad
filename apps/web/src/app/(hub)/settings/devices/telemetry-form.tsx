'use client';

import { useState } from 'react';
import { apiCall } from '../../../../lib/api-client';
import type { TelemetryConsent } from '../../../../lib/api';

/**
 * What the companion app sends, and switching any of it off.
 *
 * ★ OPT-OUT MEANS DISCLOSURE COMES FIRST ★
 *
 * The app no longer filters — it sends what it reads, and this page is where a
 * member decides what is kept (INV-013, amended 2026-07-29). Somebody can only
 * decide about things they can SEE, so every category and every individual
 * event is listed with a sentence saying what it actually reveals.
 *
 * The catalogue comes from the SERVER rather than being restated here. A page
 * offering a switch the server would reject, or hiding one it honours, is worse
 * than no page at all.
 *
 * ★ EVERYTHING IS ON UNTIL SWITCHED OFF ★
 *
 * A checked box means "we keep this", which is the default. That reads the
 * right way round for the member — the question is "what do you want us to
 * have", not "what have you permitted".
 */

/** One toggle. Disabled when the category cannot be declined. */
function Toggle({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 ${disabled === true ? 'cursor-not-allowed opacity-70' : ''}`}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={disabled === true}
        onChange={onChange}
        aria-label={label}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-cyan-bright)]"
      />
    </label>
  );
}

export function TelemetryForm({ initial }: { initial: TelemetryConsent }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const offCategories = new Set(state.optOutCategories);
  const offEvents = new Set(state.optOutEvents);

  async function save(categories: string[], events: string[]): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      /*
       * The WHOLE set every time, never one flag. Two toggles in flight and the
       * second would overwrite the first with a stale view of the rest.
       */
      const next = await apiCall<TelemetryConsent & { purged: number }>(
        'PUT',
        '/v1/me/telemetry-consent',
        { body: { optOutCategories: categories, optOutEvents: events } },
      );

      setState({ ...state, optOutCategories: next.optOutCategories, optOutEvents: next.optOutEvents });

      if (next.purged > 0) {
        // Said out loud. Switching something off DELETES what was already
        // stored, and a member who is not told that has been given a switch
        // rather than a choice.
        setNotice(
          `Saved. ${next.purged.toLocaleString('en-GB')} stored ${next.purged === 1 ? 'event was' : 'events were'} deleted.`,
        );
      } else {
        setNotice('Saved.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  function toggleCategory(category: string, entries: readonly { event: string }[]): void {
    const next = new Set(offCategories);
    if (next.has(category)) next.delete(category);
    else next.add(category);

    /*
     * Switching a whole category back ON clears its individual opt-outs too.
     * Otherwise a member turns the category on, sees it still not collecting,
     * and has no way to discover that a per-event switch underneath is
     * overriding the one they just moved.
     */
    const events = next.has(category)
      ? [...offEvents]
      : [...offEvents].filter((e) => !entries.some((x) => x.event === e));

    void save([...next], events);
  }

  function toggleEvent(event: string): void {
    const next = new Set(offEvents);
    if (next.has(event)) next.delete(event);
    else next.add(event);
    void save([...offCategories], [...next]);
  }

  return (
    <div>
      {notice !== null && (
        <p className="mb-5 rounded border border-[var(--color-brand-cyan-bright)] px-4 py-3 text-sm text-[var(--color-brand-cyan-bright)]">
          {notice}
        </p>
      )}
      {error !== null && (
        <p className="mb-5 rounded border border-[var(--color-semantic-warning)] px-4 py-3 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}

      <div className="space-y-6">
        {state.catalogue.map((group) => {
          const categoryOff = offCategories.has(group.category);

          return (
            <section
              key={group.category}
              className={`rounded border p-5 ${
                categoryOff
                  ? 'border-[var(--color-border-hairline)] opacity-60'
                  : 'border-[var(--color-border-hairline)]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3
                    className="text-lg text-[var(--color-brand-orange)]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {group.label.toUpperCase()}
                  </h3>
                  <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
                    {group.purpose}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {group.required ? (
                    /*
                      ★ A REASON, NOT A GREYED-OUT BOX ★

                      A control that does nothing and says nothing reads as a
                      bug. This one says why it cannot move, in the same place
                      somebody would have clicked.
                    */
                    <span className="rounded border border-[var(--color-semantic-success)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-semantic-success)]">
                      Always on
                    </span>
                  ) : (
                    <>
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
                        {categoryOff ? 'Off' : 'On'}
                      </span>
                      <Toggle
                        on={!categoryOff}
                        disabled={busy}
                        onChange={() => toggleCategory(group.category, group.entries)}
                        label={`Collect ${group.label}`}
                      />
                    </>
                  )}
                </div>
              </div>

              {/* -------------------------------------------- the events */}
              <ul className="m-0 mt-4 list-none space-y-2 border-t border-[var(--color-border-hairline)] p-0 pt-4">
                {group.entries.map((entry) => {
                  // A declined category switches everything under it off, and
                  // the rows show that rather than contradicting the header.
                  const eventOff = categoryOff || offEvents.has(entry.event);

                  return (
                    <li key={entry.event} className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p
                          className={`text-sm ${eventOff ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text-primary)]'}`}
                        >
                          {entry.label}{' '}
                          <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                            {entry.event}
                          </span>
                        </p>
                        <p className="mt-0.5 max-w-[68ch] text-xs leading-relaxed text-[var(--color-text-secondary)]">
                          {entry.reveals}
                        </p>
                      </div>

                      {group.required ? (
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-semantic-success)]">
                          Required
                        </span>
                      ) : (
                        <Toggle
                          on={!eventOff}
                          disabled={busy || categoryOff}
                          onChange={() => toggleEvent(entry.event)}
                          label={`Collect ${entry.label}`}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {/*
        ★ THE HONEST FOOTNOTE ★

        Under opt-out the app sends first and the server discards. A member
        reading this page could reasonably assume a switched-off item never
        leaves their machine, and it does. Saying so is the difference between a
        privacy control and the appearance of one.
      */}
      <p className="mt-8 max-w-[68ch] border-t border-[var(--color-border-hairline)] pt-5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        The app sends what it reads and these settings are applied here, on the server — so
        something switched off does travel from your machine before it is discarded and deleted.
        The exception is private chat, your friends list and the contents of messages: those are
        never transmitted at all, because they contain other people&rsquo;s words and nobody can
        consent to that on their behalf.
      </p>
    </div>
  );
}
