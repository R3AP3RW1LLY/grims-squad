'use client';

import { useState } from 'react';
import type { ColonyBuildType } from '../../../../lib/api';

/**
 * The catalogue as a filterable table.
 *
 * ★ FIFTY-FIVE ROWS IS TOO MANY TO SCAN AND TOO FEW TO PAGINATE ★
 *
 * So it filters rather than pages: a text box, and the three facets somebody actually decides by —
 * tier, where it goes, and what pad it leaves you with. Filtering happens in the browser because
 * the whole catalogue is a few kilobytes and a round trip per keystroke would be slower than the
 * typing.
 *
 * ★ SORTED BY WHAT IT COSTS TO HAUL ★
 *
 * Not alphabetically. The question is "what can we afford to build", and tonnage is the answer —
 * two hundred thousand tonnes is a different conversation from three thousand, whatever it is
 * called.
 */

const TH =
  'py-2.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] ' +
  'text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] ' +
  'px-3 py-1.5 text-sm text-[var(--color-text-primary)]';

/**
 * Tonnage, banded by what it means for an evening.
 *
 * A number alone does not say whether a build is one member's night or the squadron's fortnight.
 * The colour does, at a glance, which is the whole reason somebody scans this table.
 */
function haulTone(tonnes: number): string {
  if (tonnes < 4_000) return 'text-[var(--color-semantic-success)]';
  if (tonnes < 20_000) return 'text-[var(--color-brand-cyan-bright)]';
  if (tonnes < 60_000) return 'text-[var(--color-semantic-warning)]';
  return 'text-[var(--color-semantic-hostile-bright)]';
}

export function BuildTypeTable({ types }: { types: readonly ColonyBuildType[] }) {
  const [text, setText] = useState('');
  const [tier, setTier] = useState('all');
  const [where, setWhere] = useState('all');
  const [pad, setPad] = useState('all');

  const needle = text.trim().toLowerCase();
  const shown = types.filter(
    (t) =>
      (needle === '' ||
        t.displayName.toLowerCase().includes(needle) ||
        t.category.toLowerCase().includes(needle)) &&
      (tier === 'all' || String(t.tier) === tier) &&
      (where === 'all' || t.location === where) &&
      (pad === 'all' || t.padSize === pad),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Find
          </span>
          <input
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            placeholder="coriolis, settlement…"
            className={`${FIELD} w-[200px]`}
          />
        </label>

        {[
          { label: 'Tier', value: tier, set: setTier, options: ['1', '2', '3'] },
          { label: 'Where', value: where, set: setWhere, options: ['orbital', 'surface'] },
          { label: 'Pad', value: pad, set: setPad, options: ['none', 'small', 'medium', 'large'] },
        ].map((f) => (
          <label key={f.label} className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
              {f.label}
            </span>
            <select
              value={f.value}
              onChange={(e) => f.set((e.target as HTMLSelectElement).value)}
              className={FIELD}
            >
              <option value="all">any</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          Nothing matches those filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <th className={TH}>Build</th>
                <th className={TH}>Tier</th>
                <th className={TH}>Where</th>
                <th className={TH}>Pad</th>
                <th className={`${TH} text-right`}>To haul</th>
                <th className={`${TH} text-right`}>Commodities</th>
                <th className={TH}>Figures</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id}>
                  <td className={TD}>
                    <a
                      href={`/colonisation/build-types/${encodeURIComponent(t.id)}`}
                      className="text-[var(--color-text-primary)] no-underline hover:underline"
                    >
                      {t.displayName}
                    </a>
                    <span className="ml-2 text-[11px] text-[var(--color-text-dim)]">
                      {t.category}
                    </span>
                  </td>
                  <td className={`${TD} font-mono text-[var(--color-text-secondary)]`}>T{t.tier}</td>
                  <td className={`${TD} text-[var(--color-text-secondary)]`}>{t.location}</td>
                  <td className={`${TD} text-[var(--color-text-secondary)]`}>
                    {/* "none" said as a dash: a settlement with no pad is not a missing value. */}
                    {t.padSize === 'none' ? '—' : t.padSize}
                  </td>
                  <td className={`${TD} text-right font-mono tabular-nums ${haulTone(t.totalTonnes)}`}>
                    {t.totalTonnes.toLocaleString()} t
                  </td>
                  <td className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}>
                    {t.commodities}
                  </td>
                  <td className={TD}>
                    {t.source === 'observed' ? (
                      <span
                        className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-semantic-success)]"
                        title={`Matched exactly by ${t.confirmations} of our own construction sites`}
                      >
                        measured
                        {t.confirmations > 1 ? ` ×${t.confirmations}` : ''}
                      </span>
                    ) : (
                      <span
                        className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]"
                        title="A community figure. Nobody has checked it against one of our own builds yet."
                      >
                        unchecked
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="m-0 mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
        {shown.length === types.length
          ? `${types.length} build types`
          : `${shown.length} of ${types.length} build types`}
      </p>
    </div>
  );
}
