'use client';

import { useState } from 'react';
import { SystemPicker } from '../../../../../components/system-picker';

/**
 * Where distances are measured from, and the filters that go with it.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "the best places to buy both in general and based on the players current location and station
 * they are at" — and, asked how we should know where somebody is: "Both: journal if paired, typed
 * system otherwise."
 *
 * ★ IT SAYS WHERE THE NUMBER CAME FROM ★
 *
 * "50 ly from Deciat, which you typed" and "50 ly from Deciat, where your ship is" are different
 * claims. A member who never told us their position needs to see that their journal did — both
 * because it is their data and because a stale journal is the one way this can be confidently
 * wrong.
 *
 * Everything is a GET form, so the result stays a shareable URL rather than component state.
 */
export function OriginBox({
  commodity,
  origin,
  unknownSystem,
  query,
}: {
  commodity: string;
  origin: { system: string; station: string | null; from: 'typed' | 'journal' } | null;
  unknownSystem: string | null;
  query: Record<string, string>;
}) {
  const [system, setSystem] = useState(query['near'] ?? '');

  const action = `/logistics/commodities/${encodeURIComponent(commodity)}`;
  const checked = (key: string): boolean => query[key] === '1';

  return (
    <div>
      {origin === null ? (
        <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
          {unknownSystem === null
            ? 'Showing the whole bubble. Name a system to see what is close to you.'
            : null}
        </p>
      ) : (
        <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
          Measuring from <strong className="text-[var(--color-text-primary)]">{origin.system}</strong>
          {origin.station === null ? null : <> ({origin.station})</>} —{' '}
          {origin.from === 'journal'
            ? 'where your ship last was, from your journal.'
            : 'the system you named.'}
        </p>
      )}

      {/*
        ★ THE FAILURE THAT USED TO BE SILENT ★

        A system we cannot place means no radius was applied and these results are galaxy-wide.
        That looks exactly like a correct answer and will send somebody thousands of light years.
        Said plainly, in the warning colour, above the results it describes.
      */}
      {unknownSystem === null ? null : (
        <p className="m-0 mb-3 rounded-md border border-[var(--color-semantic-warning)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          We hold no system called “{unknownSystem}”, so the distance limit was not applied — these
          results cover the whole bubble. Check the spelling, or clear the box.
        </p>
      )}

      <form method="get" action={action} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Near system
          </span>
          {/*
            Controlled, unlike the GET-form pickers elsewhere: this box drives a live re-fetch from
            React state rather than a page navigation, so it owns its value and the picker reports
            changes back rather than keeping its own.
          */}
          <SystemPicker
            name="near"
            value={system}
            onValueChange={setSystem}
            placeholder="Deciat"
            className="w-[200px] rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Within
          </span>
          <select
            name="withinLy"
            defaultValue={query['withinLy'] ?? '50'}
            className="rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]"
          >
            {['20', '50', '100', '250', '500'].map((ly) => (
              <option key={ly} value={ly}>
                {ly} ly
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Seen within
          </span>
          <select
            name="freshDays"
            defaultValue={query['freshDays'] ?? '0'}
            className="rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]"
          >
            <option value="0">Any age</option>
            <option value="1">A day</option>
            <option value="7">A week</option>
            <option value="30">A month</option>
          </select>
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--color-text-secondary)]">
          <input type="checkbox" name="largePad" value="1" defaultChecked={checked('largePad')} />
          Large pad only
        </label>

        {/*
          Off by default and deliberately labelled with the reason. Carriers hold both the cheapest
          and the dearest prices in the galaxy, all set by hand, and can be somewhere else tomorrow.
        */}
        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--color-text-secondary)]">
          <input type="checkbox" name="carriers" value="1" defaultChecked={checked('carriers')} />
          Include fleet carriers
        </label>

        <button
          type="submit"
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-4 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)]"
        >
          Update
        </button>
      </form>
    </div>
  );
}
