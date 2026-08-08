import { SystemPicker } from '../../../../components/system-picker';

/**
 * Where to search from, and whose space to extend.
 *
 * ★ A GET FORM, LIKE THE FREIGHT OFFICE ★
 *
 * Every field goes into the query string, so a search is a URL somebody can paste. It also means no
 * state, no fetch and no spinner — the server has the answer rendered by the time the page arrives.
 */

const FIELD =
  'rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';

export function ScoutForm({ query }: { query: { anchor: string; range: string; prefer: string } }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="flex flex-1 flex-col gap-1">
        <span className={LABEL}>Search around</span>
        <SystemPicker
          name="anchor"
          defaultValue={query.anchor}
          placeholder="the station you buy claims from, or a colony you hold"
          className={`${FIELD} w-full min-w-[16rem]`}
        />
      </label>

      <label className="flex flex-col gap-1">
        {/*
          A claim reaches 15 ly from the station selling it. Wider is offered because our own
          measurement of that range could be off, and a member should be able to look further
          rather than trust us about where the edge is.
        */}
        <span className={LABEL}>Claim range</span>
        <select name="range" defaultValue={query.range === '' ? '15' : query.range} className={FIELD}>
          {['10', '15', '20', '30', '40'].map((ly) => (
            <option key={ly} value={ly}>
              {ly} ly{ly === '15' ? ' (the game’s)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        {/*
          ★ THE FIELD THAT DECIDES SOMETHING PERMANENT ★

          The claim extends the power that sells it. Preferring one makes a matching station win
          even when a closer one exists, because the errand is once and the allegiance is for ever.
        */}
        <span className={LABEL}>Extend</span>
        <select name="prefer" defaultValue={query.prefer} className={FIELD}>
          <option value="">any power</option>
          <option value="Federation">Federation</option>
          <option value="Empire">Empire</option>
          <option value="Alliance">Alliance</option>
        </select>
      </label>

      <button
        type="submit"
        className="rounded-md border border-[var(--color-brand-orange)] px-4 py-2 text-sm text-[var(--color-brand-orange-bright)] hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)]"
      >
        Scout
      </button>
    </form>
  );
}
