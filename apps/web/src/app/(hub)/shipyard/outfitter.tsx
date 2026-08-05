'use client';

import { useMemo, useState } from 'react';
import { computeStats, fitShip, type CatalogueModule, type FitRole } from '@grims/ed-clients/builds';
import type { ShipBuild, FittedModule } from '@grims/shared/ship-build';
import {
  catalogueFrom,
  optionsFor,
  slotCategory,
  moduleFacts,
  moduleDescription,
  moduleSummary,
  type OutfitPayload,
} from '@grims/ed-clients/builds';
import { SaveBuild } from './save-build';

/**
 * Build my own — the outfitting screen.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "make our layout for the outfitter page match close to how coriolis looks please, make sure were
 * including all the same data please! just make our look way better!"
 *
 * ★ WHAT WAS TAKEN FROM CORIOLIS ★
 *
 * The SHAPE. Coriolis is a summary bar you watch, over slot tables you edit — and the tables are
 * tables, with a column per figure, so twelve hardpoints can be compared down a column instead of
 * read one at a time. That is the part that makes it usable on an Anaconda, and it is what a row of
 * bare dropdowns was getting wrong.
 *
 * Its data too: speed, boost, jump, range, mass, armour, shields, cargo, fuel, DPS and the power
 * budget, plus mass/power/cost per fitted module. `speed` and `boost` did not exist in `BuildStats`
 * before this screen asked for them.
 *
 * ★ AND WHAT WAS NOT ★
 *
 * Coriolis is dense to the point of hostility on a first visit — every figure at full volume, no
 * hierarchy. Here the summary leads with the four figures that decide a ship and demotes the rest;
 * the tables carry their own totals so a section can be judged without adding it up; and each
 * module's full statistics are one click away rather than permanently on screen.
 *
 * The arithmetic is the server's own `computeStats`, over a catalogue built from the payload. A
 * second implementation here would drift from the one that stores builds, quietly.
 */

const SLOT_GROUPS: readonly string[] = [
  'cr', 'sg', 'bsg', 'psg', 'hr', 'mrp', 'scb', 'fs', 'am', 'rf', 'cc', 'pc', 'dtl', 'fx',
  'rpl', 'rsl', 'mlc', 'hb', 'pce', 'pci', 'pcm', 'pcq', 'fh', 'pas', 'gsc', 'sua', 'dc', 'sc',
  'mc', 'pl', 'bl', 'c', 'rg', 'pa', 'ml', 'abl', 'sdm', 'mr', 'tp', 'nl', 'axmc', 'rfl',
  'sb', 'ch', 'hs', 'ecm', 'pwa', 'xs', 'kw', 'ws', 'sfn',
];

const SELECT =
  'w-full min-w-0 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-2 py-1 text-[11px] text-[var(--color-text-primary)] ' +
  'focus:border-[var(--color-border-focus)] focus:outline-none';

/**
 * Credits in full, grouped.
 *
 * ★ NOT ABBREVIATED ★
 *
 * This used to read "412.7 M". Outfitting is a saving target — the difference between 412.7 M and
 * 412,748,190 is nine million credits, which is a week of someone's flying, and rounding it away
 * makes the one number the whole screen exists to produce the least precise thing on it.
 *
 * Per-module costs inside `<option>` labels stay abbreviated: there is no room, and there the figure
 * is for comparing rather than for saving towards.
 */
const credits = (n: number): string => n.toLocaleString('en-GB');

const short = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);

const num = (n: number | null | undefined, dp = 0): string =>
  n === null || n === undefined ? '—' : n.toFixed(dp);

/** The presets. Factory stock first, because it is the ship as Frontier sells it. */
const PRESETS: ReadonlyArray<{ key: 'stock' | FitRole; label: string; hint: string }> = [
  { key: 'stock', label: 'Factory stock', hint: 'The loadout the ship is sold with.' },
  { key: 'combat', label: 'Combat', hint: 'Weapons, shields and hull, fitted for a fight.' },
  { key: 'mining', label: 'Mining', hint: 'Lasers, limpets and somewhere to put the ore.' },
  { key: 'explorer', label: 'Explorer', hint: 'Light, long-ranged, and able to repair itself.' },
  { key: 'trader', label: 'Trader', hint: 'As much cargo as the hull and the shields allow.' },
];

/**
 * One figure in the summary bar.
 *
 * `emphasis` is what Coriolis does not have: speed, jump, shields and power decide whether a ship
 * suits a job, and the other nine are how you tune it once it does. Giving all thirteen the same
 * weight is why Coriolis's readout takes a moment to parse every time.
 */
function Stat({
  label,
  value,
  unit,
  tone = 'normal',
  emphasis = false,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'normal' | 'good' | 'bad';
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
        {label}
      </div>
      <div
        className={`font-mono tabular-nums ${emphasis ? 'text-base' : 'text-[13px]'} ${
          tone === 'bad'
            ? 'text-[var(--color-semantic-hostile-bright)]'
            : tone === 'good'
              ? 'text-[var(--color-brand-cyan-bright)]'
              : 'text-[var(--color-text-primary)]'
        }`}
      >
        {value}
        {unit !== undefined && (
          <span className="ml-0.5 text-[10px] text-[var(--color-text-dim)]">{unit}</span>
        )}
      </div>
    </div>
  );
}

/** Everything the fitted module does, opened under its row. */
function ModuleDetail({ module }: { module: CatalogueModule }) {
  const facts = moduleFacts(module);
  const description = moduleDescription(module);

  return (
    <div className="border-t border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2.5">
      {description !== null && (
        <p className="m-0 mb-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
          {description}
        </p>
      )}
      {facts.length === 0 ? (
        <p className="m-0 text-[11px] text-[var(--color-text-dim)]">
          Coriolis records no figures for this module beyond its size and rating.
        </p>
      ) : (
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4 lg:grid-cols-5">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-dim)]">
                {fact.label}
              </dt>
              <dd className="m-0 font-mono text-[11px] tabular-nums text-[var(--color-text-primary)]">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function Outfitter({
  payload,
  signedIn,
}: {
  payload: OutfitPayload;
  /** A visitor may plan a ship; saving one needs an account. */
  signedIn: boolean;
}) {
  const catalogue = useMemo(() => catalogueFrom(payload), [payload]);

  /**
   * The factory loadout, resolved to module ids.
   *
   * Standard defaults are written as class+rating (`"6E"`), everything else as an id (`"4j"`). Both
   * dialects live in the same array, so both are tried.
   */
  const stock = useMemo<Record<string, string | null>>(() => {
    const start: Record<string, string | null> = {};
    for (const slot of payload.ship.slots) {
      const key = `${slot.group}:${slot.index}`;
      const entry = payload.ship.defaults[slot.group]?.[slot.index] ?? null;
      if (entry === null) {
        start[key] = null;
        continue;
      }

      const byId = catalogue.module(slotCategory(slot), entry);
      if (byId !== null) {
        start[key] = byId.id;
        continue;
      }

      if (slot.fixedGroup !== null) {
        const cls = Number.parseInt(entry.slice(0, -1), 10);
        start[key] = Number.isNaN(cls)
          ? null
          : (catalogue.standardByRating(slot.fixedGroup, cls, entry.slice(-1))?.id ?? null);
        continue;
      }

      start[key] = null;
    }
    return start;
  }, [payload, catalogue]);

  /**
   * A complete loadout for a role, from the same fitting engine the assisted builder uses.
   *
   * ★ WHY THE PRESETS ARE NOT HAND-WRITTEN LISTS ★
   *
   * Because a hand-written "combat loadout" is a guess that goes stale, and because the assisted
   * builder already has to answer this question properly — it respects the power budget, the slot
   * sizes and the hull's own strengths. Two answers to "what goes on this ship for fighting" would
   * be two answers, and the one on this page would be the worse of them.
   */
  const presetFor = useMemo(
    () =>
      (role: FitRole): Record<string, string | null> => {
        const ship = catalogue.ship(payload.ship.id);
        if (ship === null) return stock;

        const result = fitShip(ship, { role }, catalogue);
        const next: Record<string, string | null> = {};
        for (const slot of payload.ship.slots) next[`${slot.group}:${slot.index}`] = null;
        for (const module of result.build.modules) {
          next[`${module.group}:${module.index}`] = module.moduleId;
        }
        return next;
      },
    [catalogue, payload, stock],
  );

  /*
   * ★ OPENS FULLY OUTFITTED ★
   *
   * Squadron owner: "in the ship builder, it needs to actually fully outfit the ships".
   *
   * Coriolis's factory data genuinely leaves 46% of slots empty — most hulls ship with no utility
   * mounts and half their internals bare — so "factory stock" alone is not a ship anybody would fly,
   * and every figure reads as a ship that has not been finished.
   *
   * So the screen opens on a COMPLETE loadout and says which one it is. Factory stock is one click
   * away and clearly labelled, so nothing about the real ship is hidden — it is simply not the
   * useful starting point for somebody planning what to buy.
   */
  const [preset, setPreset] = useState<'stock' | FitRole | 'custom'>('trader');
  const [fitted, setFitted] = useState<Record<string, string | null>>(() => presetFor('trader'));
  const [bulkheadId, setBulkheadId] = useState(payload.ship.bulkheads[0]?.id ?? 'Bs');
  const [openSlot, setOpenSlot] = useState<string | null>(null);

  const applyPreset = (key: 'stock' | FitRole): void => {
    setPreset(key);
    setFitted(key === 'stock' ? stock : presetFor(key));
  };

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

  const bulkhead = payload.ship.bulkheads.find((b) => b.id === bulkheadId) ?? null;

  /*
   * Hull, armour and every fitted module. Recomputed with the build rather than tracked alongside
   * it, so it cannot fall out of step with what the slots actually hold.
   */
  const totalCost = useMemo(() => {
    let sum = payload.ship.hullCost + (bulkhead?.cost ?? 0);
    for (const slot of payload.ship.slots) {
      const id = fitted[`${slot.group}:${slot.index}`];
      if (id === null || id === undefined) continue;
      sum += catalogue.module(slotCategory(slot), id)?.cost ?? 0;
    }
    return sum;
  }, [payload, fitted, bulkhead, catalogue]);

  const setSlot = (key: string, id: string | null): void => {
    setFitted((current) => ({ ...current, [key]: id }));
    // Once a slot is changed by hand it is no longer the preset, and saying so avoids a highlighted
    // "Combat" button describing a build that has been edited away from it.
    setPreset('custom');
  };

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

  const emptySlots = payload.ship.slots.filter(
    (s) => (fitted[`${s.group}:${s.index}`] ?? null) === null,
  ).length;

  return (
    <div className="space-y-4">
      {/*
        ★ THE SUMMARY LEADS, AS IT DOES ON CORIOLIS ★

        Above the tables and sticky, because the whole activity is watching these change. On Coriolis
        it is a horizontal strip; keeping that means it never competes with the slot tables for
        width, which a sidebar does on every screen narrower than a desktop.
      */}
      <div className="sticky top-16 z-10 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel-sunken)]/95 p-4 backdrop-blur">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="m-0 text-lg text-[var(--color-text-primary)]">{payload.ship.name}</h2>
          <div className="text-right">
            <span className="font-mono text-base tabular-nums text-[var(--color-brand-cyan-bright)]">
              {credits(totalCost)} cr
            </span>
            <span className="ml-3 font-mono text-[10px] text-[var(--color-text-dim)]">
              hull {credits(payload.ship.hullCost)} · fitted{' '}
              {credits(Math.max(0, totalCost - payload.ship.hullCost))}
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--color-border-hairline)] pt-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Speed" value={num(stats?.speed)} unit="m/s" emphasis />
          <Stat label="Boost" value={num(stats?.boostSpeed)} unit="m/s" emphasis />
          <Stat label="Jump" value={num(stats?.jumpRange, 2)} unit="ly" emphasis />
          <Stat
            label="Power"
            value={stats === null ? '—' : `${stats.powerDrawn}/${stats.powerGenerated}`}
            unit="MW"
            tone={stats?.powerDeficit === true ? 'bad' : 'good'}
            emphasis
          />
          <Stat label="Shields" value={num(stats?.shields)} unit="MJ" />
          <Stat label="Armour" value={num(stats?.armour)} />
          <Stat label="DPS" value={num(stats?.dps, 1)} />
          <Stat label="Laden jump" value={num(stats?.ladenJumpRange, 2)} unit="ly" />
          <Stat label="Cargo" value={num(stats?.cargoCapacity)} unit="t" />
          <Stat label="Fuel" value={num(stats?.fuelCapacity)} unit="t" />
          <Stat label="Unladen" value={num(stats?.unladenMass, 1)} unit="t" />
          <Stat label="Laden" value={num(stats?.ladenMass, 1)} unit="t" />
          <Stat label="Hull mass" value={num(stats?.hullMass, 1)} unit="t" />
          <Stat label="Modules" value={num(stats?.moduleMass, 1)} unit="t" />
        </div>

        {stats?.powerDeficit === true && (
          <p className="mt-3 rounded-md border border-[var(--color-semantic-hostile)] bg-[color-mix(in_srgb,var(--color-semantic-hostile)_10%,transparent)] px-3 py-2 text-xs text-[var(--color-semantic-hostile-bright)]">
            This draws more power than the plant makes. Fit a larger plant, or power something down.
          </p>
        )}

        {stats !== null && stats.damageByType !== null && (
          <p className="m-0 mt-2 font-mono text-[10px] text-[var(--color-text-secondary)]">
            <span className="text-[var(--color-text-dim)]">damage · </span>
            {Object.entries(stats.damageByType)
              .map(([type, value]) => `${type} ${value}`)
              .join(' · ')}
          </p>
        )}
      </div>

      {/* ---- presets ------------------------------------------------------ */}
      <section className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
            Starting point
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((option) => (
              <button
                key={option.key}
                type="button"
                title={option.hint}
                onClick={() => applyPreset(option.key)}
                aria-pressed={preset === option.key}
                className={`rounded border px-2.5 py-1 text-[11px] transition-colors ${
                  preset === option.key
                    ? 'border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_16%,transparent)] text-[var(--color-brand-orange-bright)]'
                    : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {option.label}
              </button>
            ))}
            {preset === 'custom' && (
              <span className="rounded border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-text-dim)]">
                Edited
              </span>
            )}
          </div>
          <p className="m-0 text-[11px] text-[var(--color-text-secondary)]">
            Each fits the whole ship from the game&rsquo;s own module list.
          </p>
        </div>

        {/*
          ★ THE BULKHEAD IS A SLOT, EVEN THOUGH THE GAME HIDES IT ★

          Armour is bought like a module and changes mass and hull integrity more than most modules
          do. Leaving it out would make the armour figure look fixed and unexplainable.
        */}
        <div className="mt-3 flex items-center gap-3 border-t border-[var(--color-border-hairline)] pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
            Bulkheads
          </span>
          <select
            className={`${SELECT} max-w-xs`}
            value={bulkheadId}
            aria-label="Bulkheads"
            onChange={(e) => setBulkheadId(e.target.value)}
          >
            {payload.ship.bulkheads.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.cost !== null && b.cost > 0 ? ` — ${short(b.cost)} cr` : ''}
              </option>
            ))}
          </select>
          <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-dim)]">
            {bulkhead?.mass != null && bulkhead.mass > 0 ? `${bulkhead.mass} t` : ''}
          </span>
        </div>
      </section>

      {/* ---- slot tables --------------------------------------------------- */}
      {groups.map((group) => {
        if (group.slots.length === 0) return null;

        const rows = group.slots.map((slot) => {
          const key = `${slot.group}:${slot.index}`;
          const id = fitted[key] ?? null;
          return { slot, key, module: id === null ? null : catalogue.module(slotCategory(slot), id) };
        });

        const sectionMass = rows.reduce((sum, r) => sum + (r.module?.mass ?? 0), 0);
        const sectionPower = rows.reduce((sum, r) => sum + (r.module?.power ?? 0), 0);
        const sectionCost = rows.reduce((sum, r) => sum + (r.module?.cost ?? 0), 0);

        return (
          <section
            key={group.title}
            className="overflow-hidden rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]"
          >
            <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border-hairline)] px-4 py-2.5">
              <h3 className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
                {group.title}
              </h3>
              {/*
                Per-section totals. Coriolis makes you add a column up in your head to answer "what
                are my hardpoints costing me in mass" — which is the question that decides whether to
                downsize one.
              */}
              <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-dim)]">
                {sectionMass.toFixed(1)} t · {sectionPower.toFixed(2)} MW · {credits(sectionCost)} cr
              </span>
            </div>

            {/*
              Scrolls inside itself on a narrow screen rather than widening the page. A stat column
              that pushes the body sideways is worse than one you scroll to.
            */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[var(--color-border-hairline)]">
                    <th
                      scope="col"
                      className="w-10 px-3 py-1.5 text-center font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-[var(--color-text-dim)]"
                    >
                      Sz
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-1.5 font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-[var(--color-text-dim)]"
                    >
                      Module
                    </th>
                    <th
                      scope="col"
                      className="w-20 px-2 py-1.5 text-right font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-[var(--color-text-dim)]"
                    >
                      Mass
                    </th>
                    <th
                      scope="col"
                      className="w-20 px-2 py-1.5 text-right font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-[var(--color-text-dim)]"
                    >
                      Power
                    </th>
                    <th
                      scope="col"
                      className="w-28 px-2 py-1.5 text-right font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-[var(--color-text-dim)]"
                    >
                      Cost
                    </th>
                    <th scope="col" className="w-10 px-2 py-1.5">
                      <span className="sr-only">Statistics</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ slot, key, module }) => {
                    const options = optionsFor(catalogue, slot, SLOT_GROUPS);
                    const isOpen = openSlot === key;

                    return (
                      <tr
                        key={key}
                        className="border-b border-[var(--color-border-hairline)] last:border-b-0"
                      >
                        <td className="px-3 py-1.5 text-center align-top">
                          {/*
                            The slot SIZE is the constraint that decides everything else, and an
                            outfitter that hides it makes people guess why a module is missing from
                            a list.
                          */}
                          <span className="inline-block w-6 rounded border border-[var(--color-border-hairline)] text-center font-mono text-[10px] leading-5 text-[var(--color-text-secondary)]">
                            {slot.size}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          <select
                            className={SELECT}
                            value={module?.id ?? ''}
                            aria-label={`${group.title} slot ${slot.index + 1}, size ${slot.size}`}
                            onChange={(e) =>
                              setSlot(key, e.target.value === '' ? null : e.target.value)
                            }
                          >
                            <option value="">— empty —</option>
                            {options.map((m) => {
                              const summary = moduleSummary(m);
                              return (
                                <option key={m.id} value={m.id}>
                                  {m.class}
                                  {m.rating ?? ''} {m.name}
                                  {summary === '' ? '' : ` — ${summary}`}
                                </option>
                              );
                            })}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right align-middle font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                          {module?.mass == null ? '—' : `${module.mass} t`}
                        </td>
                        <td className="px-2 py-1.5 text-right align-middle font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                          {module?.power == null ? '—' : `${module.power.toFixed(2)}`}
                        </td>
                        <td className="px-2 py-1.5 text-right align-middle font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                          {module?.cost == null ? '—' : credits(module.cost)}
                        </td>
                        <td className="px-2 py-1.5 text-right align-middle">
                          <button
                            type="button"
                            disabled={module === null}
                            onClick={() => setOpenSlot(isOpen ? null : key)}
                            aria-expanded={isOpen}
                            aria-label={
                              module === null
                                ? 'No module fitted'
                                : `${isOpen ? 'Hide' : 'Show'} statistics for ${module.name}`
                            }
                            className="w-6 rounded border border-[var(--color-border-hairline)] text-center font-mono text-[11px] leading-5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-25"
                          >
                            {isOpen ? '−' : 'i'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/*
              The detail panel sits OUTSIDE the table rather than in a spanning row: a `<td colspan>`
              holding a grid fights the table's own column widths, and the panel is about one module
              rather than about the columns.
            */}
            {rows.map(({ key, module }) =>
              openSlot === key && module !== null ? (
                <ModuleDetail key={`${key}-detail`} module={module} />
              ) : null,
            )}
          </section>
        );
      })}

      {/*
        Saving sits at the BOTTOM, after the slots.

        It is the end of the activity, and putting it at the top would make the first thing on an
        outfitting screen a form about visibility — a decision nobody can make about a ship they
        have not fitted yet.
      */}
      <div className="pt-1">
        <SaveBuild build={build} shipName={payload.ship.name} signedIn={signedIn} />
      </div>

      {emptySlots > 0 && (
        <p className="m-0 text-[11px] text-[var(--color-text-dim)]">
          {emptySlots} {emptySlots === 1 ? 'slot is' : 'slots are'} empty. An empty slot costs nothing
          and weighs nothing, which is often the right answer on a long-range build.
        </p>
      )}
    </div>
  );
}
