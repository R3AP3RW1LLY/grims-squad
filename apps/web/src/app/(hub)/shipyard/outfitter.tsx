'use client';

import { useMemo, useState } from 'react';
import { computeStats } from '@grims/ed-clients/builds';
import type { ShipBuild, FittedModule } from '@grims/shared/ship-build';
import { catalogueFrom, optionsFor, type OutfitPayload } from './outfitter-catalogue';

/**
 * Build my own — the outfitting screen.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "build my own should give a builder that looks and feels like coriolis, works the same way etc but
 * styled to match our theme, brand and style etc! clean workflow professional looks!"
 *
 * ★ WHAT MAKES CORIOLIS FEEL LIKE CORIOLIS ★
 *
 * Not the layout — the IMMEDIACY. Every change recomputes mass, jump range and the power budget in
 * the same frame, so outfitting is a conversation with the numbers rather than a form you submit.
 * That is why the whole module list ships with the page and the arithmetic runs in the browser.
 *
 * The maths is the server's own `computeStats`, reached through a catalogue built from the payload.
 * A second implementation here would drift from the one that stores builds, quietly, and the page
 * would start disagreeing with the record of the same ship.
 */

const SLOT_GROUPS: readonly string[] = [
  'cr', 'sg', 'bsg', 'psg', 'hr', 'mrp', 'scb', 'fs', 'am', 'rf', 'cc', 'pc', 'dtl', 'fx',
  'rpl', 'rsl', 'mlc', 'hb', 'pce', 'pci', 'pcm', 'pcq', 'fh', 'pas', 'gsc', 'sua', 'dc', 'sc',
  'mc', 'pl', 'bl', 'c', 'rg', 'pa', 'ml', 'abl', 'sdm', 'mr', 'tp', 'nl', 'axmc', 'rfl',
  'sb', 'ch', 'hs', 'ecm', 'pwa', 'xs', 'kw', 'ws', 'sfn',
];

const SELECT =
  'w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-2 py-1.5 font-mono text-[11px] text-[var(--color-text-primary)] ' +
  'focus:border-[var(--color-border-focus)] focus:outline-none';

const credits = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : `${Math.round(n / 1000)} K`;

/** One number in the readout strip. */
function Figure({
  label,
  value,
  unit,
  tone = 'normal',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'normal' | 'good' | 'bad';
}) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
        {label}
      </div>
      <div
        className={`font-mono text-sm tabular-nums ${
          tone === 'bad'
            ? 'text-[var(--color-semantic-hostile-bright)]'
            : tone === 'good'
              ? 'text-[var(--color-brand-cyan-bright)]'
              : 'text-[var(--color-text-primary)]'
        }`}
      >
        {value}
        {unit !== undefined && (
          <span className="ml-1 text-[10px] text-[var(--color-text-dim)]">{unit}</span>
        )}
      </div>
    </div>
  );
}

export function Outfitter({ payload }: { payload: OutfitPayload }) {
  const catalogue = useMemo(() => catalogueFrom(payload), [payload]);

  /*
   * Starts at the factory loadout, not empty.
   *
   * An empty hull has no power plant, so every figure reads as a broken ship and the first thing
   * anybody would do is fit the stock modules back. Starting where the ship starts means the
   * numbers mean something from the first frame.
   */
  const [fitted, setFitted] = useState<Record<string, string | null>>(() => {
    const start: Record<string, string | null> = {};
    for (const slot of payload.ship.slots) {
      const entry = payload.ship.defaults[slot.group]?.[slot.index] ?? null;
      if (entry === null) {
        start[`${slot.group}:${slot.index}`] = null;
        continue;
      }

      // Standard defaults are class+rating; everything else is an id. Both dialects, one array.
      const category = slot.group === 'standard' ? 'standard' : slot.group === 'internal' ? 'internal' : slot.size === 0 ? 'utility' : 'hardpoint';
      const byId = catalogue.module(category, entry);

      if (byId !== null) {
        start[`${slot.group}:${slot.index}`] = byId.id;
      } else if (slot.fixedGroup !== null) {
        const cls = Number.parseInt(entry.slice(0, -1), 10);
        const rating = entry.slice(-1);
        start[`${slot.group}:${slot.index}`] = Number.isNaN(cls)
          ? null
          : (catalogue.standardByRating(slot.fixedGroup, cls, rating)?.id ?? null);
      } else {
        start[`${slot.group}:${slot.index}`] = null;
      }
    }
    return start;
  });

  const [bulkheadId, setBulkheadId] = useState(payload.ship.bulkheads[0]?.id ?? 'Bs');

  const build: ShipBuild = useMemo(() => {
    const modules: FittedModule[] = payload.ship.slots.map((slot) => ({
      group: slot.group as FittedModule['group'],
      index: slot.index,
      moduleId: fitted[`${slot.group}:${slot.index}`] ?? null,
      slotSize: slot.size,
      enabled: true,
      priority: 1,
      engineering: null,
    }));

    return {
      shipId: payload.ship.id,
      shipName: payload.ship.name,
      buildName: null,
      source: 'coriolis',
      sourceUrl: `https://coriolis.io/outfit/${payload.ship.id}`,
      bulkheadId,
      modules,
    };
  }, [payload, fitted, bulkheadId]);

  const stats = useMemo(() => computeStats(build, catalogue), [build, catalogue]);

  const totalCost = useMemo(() => {
    let sum = payload.ship.hullCost;
    for (const slot of payload.ship.slots) {
      const id = fitted[`${slot.group}:${slot.index}`];
      if (id === null || id === undefined) continue;
      const category = slot.group === 'standard' ? 'standard' : slot.group === 'internal' ? 'internal' : slot.size === 0 ? 'utility' : 'hardpoint';
      sum += catalogue.module(category, id)?.cost ?? 0;
    }
    return sum;
  }, [payload, fitted, catalogue]);

  const setSlot = (key: string, id: string | null) =>
    setFitted((current) => ({ ...current, [key]: id }));

  const groups: Array<{ title: string; slots: typeof payload.ship.slots }> = [
    { title: 'Core internals', slots: payload.ship.slots.filter((s) => s.group === 'standard') },
    {
      title: 'Hardpoints',
      slots: payload.ship.slots.filter((s) => s.group === 'hardpoint' && s.size > 0),
    },
    {
      title: 'Utility mounts',
      slots: payload.ship.slots.filter((s) => s.group === 'hardpoint' && s.size === 0),
    },
    { title: 'Optional internals', slots: payload.ship.slots.filter((s) => s.group === 'internal') },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        {/*
          ★ THE BULKHEAD IS A SLOT, EVEN THOUGH THE GAME HIDES IT ★

          Armour is bought like a module and changes mass and hull integrity more than most modules
          do. Leaving it out would make the armour figure look fixed and unexplainable.
        */}
        <section className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4">
          <h3 className="m-0 mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
            Bulkheads
          </h3>
          <select className={SELECT} value={bulkheadId} onChange={(e) => setBulkheadId(e.target.value)}>
            {payload.ship.bulkheads.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.cost !== null && b.cost > 0 ? ` — ${credits(b.cost)}` : ''}
              </option>
            ))}
          </select>
        </section>

        {groups.map(
          (group) =>
            group.slots.length > 0 && (
              <section
                key={group.title}
                className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4"
              >
                <h3 className="m-0 mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
                  {group.title}
                </h3>

                <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
                  {group.slots.map((slot) => {
                    const key = `${slot.group}:${slot.index}`;
                    const options = optionsFor(catalogue, slot, SLOT_GROUPS);
                    const current = fitted[key] ?? '';

                    return (
                      <li key={key} className="flex items-center gap-2">
                        {/*
                          The slot SIZE is shown beside every dropdown. It is the constraint that
                          decides everything else, and an outfitter that hides it makes people guess
                          why a module is missing from a list.
                        */}
                        <span className="w-7 shrink-0 rounded border border-[var(--color-border-hairline)] text-center font-mono text-[10px] leading-6 text-[var(--color-text-secondary)]">
                          {slot.size}
                        </span>
                        <select
                          className={SELECT}
                          value={current}
                          aria-label={`${group.title} slot ${slot.index + 1}, size ${slot.size}`}
                          onChange={(e) => setSlot(key, e.target.value === '' ? null : e.target.value)}
                        >
                          <option value="">— empty —</option>
                          {options.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.class}
                              {m.rating ?? ''} {m.name}
                              {m.cost !== null && m.cost > 0 ? ` · ${credits(m.cost)}` : ''}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
        )}
      </div>

      {/*
        ★ THE READOUT STICKS ★

        Outfitting a large hull is a long scroll, and the whole point is watching these change as
        modules go in. A panel that scrolled away would turn every choice into a scroll up and back.
      */}
      <aside className="h-fit xl:sticky xl:top-24">
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel-sunken)] p-5">
          <h2 className="m-0 text-lg text-[var(--color-text-primary)]">{payload.ship.name}</h2>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-brand-cyan-bright)]">
            {credits(totalCost)} credits
          </p>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--color-border-hairline)] pt-4">
            <Figure label="Jump" value={stats?.jumpRange == null ? '—' : String(stats.jumpRange)} unit="ly" />
            <Figure
              label="Laden jump"
              value={stats?.ladenJumpRange == null ? '—' : String(stats.ladenJumpRange)}
              unit="ly"
            />
            <Figure label="Unladen" value={stats === null ? '—' : String(stats.unladenMass)} unit="t" />
            <Figure label="Laden" value={stats === null ? '—' : String(stats.ladenMass)} unit="t" />
            <Figure label="Cargo" value={stats === null ? '—' : String(stats.cargoCapacity)} unit="t" />
            <Figure label="Fuel" value={stats === null ? '—' : String(stats.fuelCapacity)} unit="t" />
            <Figure label="Shields" value={stats?.shields == null ? '—' : String(stats.shields)} unit="MJ" />
            <Figure label="Armour" value={stats === null ? '—' : String(stats.armour)} />
            <Figure label="DPS" value={stats?.dps == null ? '—' : String(stats.dps)} />
            {/*
              Power is the one figure that can be WRONG rather than just low, so it is the one that
              changes colour. A ship drawing more than it makes will not fly as fitted, and that has
              to be visible without reading the number.
            */}
            <Figure
              label="Power"
              value={stats === null ? '—' : `${stats.powerDrawn}/${stats.powerGenerated}`}
              unit="MW"
              tone={stats?.powerDeficit === true ? 'bad' : 'good'}
            />
          </div>

          {stats?.powerDeficit === true && (
            <p className="mt-4 rounded-md border border-[var(--color-semantic-hostile)] bg-[color-mix(in_srgb,var(--color-semantic-hostile)_10%,transparent)] p-3 text-xs text-[var(--color-semantic-hostile-bright)]">
              This draws more power than the plant makes. Fit a larger plant, or power something
              down.
            </p>
          )}

          {stats !== null && stats.damageByType !== null && (
            <div className="mt-4 border-t border-[var(--color-border-hairline)] pt-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
                Damage by type
              </div>
              <div className="mt-1 font-mono text-[11px] text-[var(--color-text-secondary)]">
                {Object.entries(stats.damageByType)
                  .map(([type, value]) => `${type} ${value}`)
                  .join(' · ')}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
