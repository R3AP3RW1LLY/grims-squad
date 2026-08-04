'use client';

import type { RoutePlan } from '../../../../lib/api';

/**
 * What the member flies, how far, and with how much.
 *
 * ★ A GET FORM, DELIBERATELY ★
 *
 * Every field goes into the query string, so a plan is a URL somebody can paste into Discord. It
 * also means this needs no state, no fetch and no loading spinner — the server has already rendered
 * the answer by the time the page arrives.
 *
 * ★ THE HULLS ARE A SHORTCUT, NOT A LIMIT ★
 *
 * The presets set the cargo box; the box itself stays editable. A member who has stripped a Python
 * for cargo knows their real number better than any preset, and a planner that argued with them
 * would be wrong more often than they are.
 */

const FIELD =
  'rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]';

const LABEL =
  'font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';

/** Common holds, roughly as flown. Approximate on purpose — see the note above. */
const HULLS: ReadonlyArray<[string, number]> = [
  ['Cobra Mk III', 44],
  ['Asp Explorer', 96],
  ['Python', 284],
  ['Type-7', 304],
  ['Anaconda', 400],
  ['Type-9', 700],
  ['Type-10', 720],
];

export function RunForm({
  query,
  plan,
}: {
  query: Record<string, string>;
  plan: RoutePlan | null;
}) {
  const val = (k: string, fallback = ''): string => query[k] ?? fallback;

  return (
    <div>
      {/*
        ★ THE FEED'S OWN PULSE ★

        Every price here comes from a collector that can stop, and when it does every row ages
        together — so nothing looks unusual and the whole list is quietly wrong. A per-row age
        cannot catch that; only the pulse can. Silent while it is healthy.
      */}
      {plan?.feed?.stale === true ? (
        <p className="m-0 mb-3 rounded-md border border-[var(--color-semantic-warning)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {plan.feed.text} Everything below is what was true then, not what is true now.
        </p>
      ) : null}

      {/*
        Where the plan is measured from, and how we knew. A member with a paired device never typed
        anything, and needs to see that their journal supplied it.
      */}
      {plan?.origin != null ? (
        <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
          Planning from{' '}
          <strong className="text-[var(--color-text-primary)]">{plan.origin.system}</strong>
          {plan.origin.station === null ? null : <> ({plan.origin.station})</>} —{' '}
          {plan.origin.from === 'journal'
            ? `where your ship last was${plan.origin.age === undefined ? '' : `, ${plan.origin.age}`}.`
            : 'the system you named.'}
          {/*
            ★ A STALE POSITION IS WORSE THAN NO POSITION ★

            It looks exactly as authoritative and quietly plans the whole run around somewhere the
            member has left — every distance measured from the wrong place, with nothing on screen
            saying why. Named rather than hidden, and the box above is already there to correct it.
          */}
          {plan.origin.stale === true ? (
            <span className="ml-1 text-[var(--color-semantic-warning)]">
              That is a while ago — if you have moved, name your system above.
            </span>
          ) : null}
        </p>
      ) : null}

      {plan !== null && plan.origin === null ? (
        <p className="m-0 mb-3 rounded-md border border-[var(--color-semantic-warning)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {plan.unknownSystem === null
            ? 'A run needs a starting point. Name the system you are in and we will plan from there.'
            : `We hold no system called “${plan.unknownSystem}”. Check the spelling and try again.`}
        </p>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Starting system</span>
          <input name="near" defaultValue={val('near')} placeholder="Deciat" className={`${FIELD} w-[190px]`} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Cargo (t)</span>
          <input
            name="cargo"
            type="number"
            min={1}
            max={794}
            defaultValue={val('cargo', '64')}
            className={`${FIELD} w-[110px]`}
            list="hull-holds"
          />
          <datalist id="hull-holds">
            {HULLS.map(([name, t]) => (
              <option key={name} value={t} label={name} />
            ))}
          </datalist>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Go to load</span>
          <select name="buyWithinLy" defaultValue={val('buyWithinLy', '50')} className={FIELD}>
            {['20', '50', '100', '200'].map((ly) => (
              <option key={ly} value={ly}>
                {ly} ly
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Carry up to</span>
          <select name="sellWithinLy" defaultValue={val('sellWithinLy', '100')} className={FIELD}>
            {['20', '50', '100', '200', '500'].map((ly) => (
              <option key={ly} value={ly}>
                {ly} ly
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Credits</span>
          <input
            name="budget"
            type="number"
            min={0}
            placeholder="any"
            defaultValue={val('budget')}
            className={`${FIELD} w-[130px]`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Commodity</span>
          <input
            name="commodity"
            defaultValue={val('commodity')}
            placeholder="best available"
            className={`${FIELD} w-[170px]`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Prices seen</span>
          {/* Default seven days, matching the API. A control whose default disagrees with the
              server's is a control that lies about what produced the answer on screen. */}
          <select name="freshDays" defaultValue={val('freshDays', '7')} className={FIELD}>
            <option value="0">Any age</option>
            <option value="1">Within a day</option>
            <option value="7">Within a week</option>
            <option value="30">Within a month</option>
          </select>
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            name="largePad"
            value="1"
            defaultChecked={query['largePad'] === '1'}
          />
          Large pad only
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            name="carriers"
            value="1"
            defaultChecked={query['carriers'] === '1'}
          />
          Include fleet carriers
        </label>

        <button
          type="submit"
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-5 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)]"
        >
          Plan the run
        </button>
      </form>
    </div>
  );
}
