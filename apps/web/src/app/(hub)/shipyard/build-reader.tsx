import { Section } from '../../../components/hub-page';
import { catalogueFrom, slotCategory, type OutfitPayload } from '@grims/ed-clients/builds';
import type { CatalogueModule } from '@grims/ed-clients/builds';
import { moduleFacts } from '@grims/ed-clients/builds';
import type { SharedBuild } from '../../../lib/api';

/**
 * A shared build, read-only.
 *
 * ★ A SERVER COMPONENT, DELIBERATELY ★
 *
 * The outfitter is interactive and ships the whole module catalogue to the browser to stay
 * immediate. This page changes nothing, so none of that is needed: the slots are resolved on the
 * server and what arrives is HTML. A visitor following a link from Discord gets a page rather than
 * a few hundred kilobytes of module tables they will never edit.
 */

const credits = (n: number): string => n.toLocaleString('en-GB');

const stat = (stats: Record<string, unknown> | null, key: string): number | null => {
  const v = stats?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const show = (n: number | null, dp = 0): string => (n === null ? '—' : n.toFixed(dp));

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
        {label}
      </div>
      <div className="font-mono text-[13px] tabular-nums text-[var(--color-text-primary)]">
        {value}
        {unit !== undefined && <span className="ml-0.5 text-[10px] text-[var(--color-text-dim)]">{unit}</span>}
      </div>
    </div>
  );
}

export function BuildReader({
  build,
  payload,
}: {
  readonly build: SharedBuild;
  readonly payload: OutfitPayload;
}) {
  const catalogue = catalogueFrom(payload);
  const stats = build.stats;

  const fitted = new Map<string, string | null>();
  for (const module of build.build.modules) {
    fitted.set(`${module.group}:${module.index}`, module.moduleId);
  }

  const bulkhead = payload.ship.bulkheads.find((b) => b.id === build.build.bulkheadId) ?? null;

  /*
   * The price is recomputed from the modules rather than stored, because it is the one figure a
   * reader will act on — they are deciding what to save for — and module prices are the part of
   * the catalogue that genuinely changes. A stale price is worse than a stale jump range.
   */
  let totalCost = payload.ship.hullCost + (bulkhead?.cost ?? 0);
  for (const slot of payload.ship.slots) {
    const id = fitted.get(`${slot.group}:${slot.index}`) ?? null;
    if (id === null) continue;
    totalCost += catalogue.module(slotCategory(slot), id)?.cost ?? 0;
  }

  const groups: Array<{ title: string; slots: typeof payload.ship.slots }> = [
    { title: 'Core internals', slots: payload.ship.slots.filter((s) => s.group === 'standard') },
    { title: 'Hardpoints', slots: payload.ship.slots.filter((s) => s.group === 'hardpoint' && s.size > 0) },
    { title: 'Utility mounts', slots: payload.ship.slots.filter((s) => s.group === 'hardpoint' && s.size === 0) },
    { title: 'Optional internals', slots: payload.ship.slots.filter((s) => s.group === 'internal') },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel-sunken)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="m-0 text-lg text-[var(--color-text-primary)]">{payload.ship.name}</h2>
          <span className="font-mono text-base tabular-nums text-[var(--color-brand-cyan-bright)]">
            {credits(totalCost)} cr
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--color-border-hairline)] pt-3 sm:grid-cols-4 lg:grid-cols-7">
          <Figure label="Speed" value={show(stat(stats, 'speed'))} unit="m/s" />
          <Figure label="Boost" value={show(stat(stats, 'boostSpeed'))} unit="m/s" />
          <Figure label="Jump" value={show(stat(stats, 'jumpRange'), 2)} unit="ly" />
          <Figure label="Laden jump" value={show(stat(stats, 'ladenJumpRange'), 2)} unit="ly" />
          <Figure label="Shields" value={show(stat(stats, 'shields'))} unit="MJ" />
          <Figure label="Armour" value={show(stat(stats, 'armour'))} />
          <Figure label="DPS" value={show(stat(stats, 'dps'), 1)} />
          <Figure label="Cargo" value={show(stat(stats, 'cargoCapacity'))} unit="t" />
          <Figure label="Fuel" value={show(stat(stats, 'fuelCapacity'))} unit="t" />
          <Figure label="Unladen" value={show(stat(stats, 'unladenMass'), 1)} unit="t" />
          <Figure label="Laden" value={show(stat(stats, 'ladenMass'), 1)} unit="t" />
          <Figure
            label="Power"
            value={
              stat(stats, 'powerDrawn') === null
                ? '—'
                : `${show(stat(stats, 'powerDrawn'), 2)}/${show(stat(stats, 'powerGenerated'), 2)}`
            }
            unit="MW"
          />
        </div>

        <p className="m-0 mt-3 border-t border-[var(--color-border-hairline)] pt-2 text-[10px] text-[var(--color-text-dim)]">
          {/*
            Said out loud, because a reader comparing this against their own outfitter deserves to
            know why two numbers might differ by a decimal.
          */}
          Figures are the ones recorded when this build was shared. The price is current.
        </p>
      </div>

      {bulkhead !== null && (
        <Section title="Bulkheads">
          <p className="m-0 font-mono text-[11px] text-[var(--color-text-primary)]">
            {bulkhead.name}
            {bulkhead.cost !== null && bulkhead.cost > 0 ? (
              <span className="text-[var(--color-text-dim)]"> · {credits(bulkhead.cost)} cr</span>
            ) : null}
          </p>
        </Section>
      )}

      {groups.map((group) => {
        const rows = group.slots
          .map((slot) => {
            const id = fitted.get(`${slot.group}:${slot.index}`) ?? null;
            return { slot, module: id === null ? null : catalogue.module(slotCategory(slot), id) };
          })
          /*
           * Empty slots are dropped from a READ-ONLY view. In the outfitter an empty slot is
           * something you act on; here it is a row of dashes, and on a large hull there can be
           * fifteen of them between the reader and what they came to see.
           */
          /*
           * A type PREDICATE, not a plain `!== null` filter. TypeScript cannot narrow an array
           * through `filter` without one, and the alternative is a `module!` on every use below —
           * which lint forbids, correctly: a non-null assertion is a claim the compiler cannot
           * check, and this one is only true because of a line thirty characters earlier.
           */
          .filter((r): r is { slot: (typeof group.slots)[number]; module: CatalogueModule } =>
            r.module !== null,
          );

        if (rows.length === 0) return null;

        return (
          <Section key={group.title} title={group.title}>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {rows.map(({ slot, module }) => (
                <li
                  key={`${slot.group}:${slot.index}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--color-border-hairline)] pb-1.5 last:border-b-0"
                >
                  <span className="w-6 shrink-0 rounded border border-[var(--color-border-hairline)] text-center font-mono text-[10px] leading-5 text-[var(--color-text-secondary)]">
                    {slot.size}
                  </span>
                  <span className="font-mono text-[12px] text-[var(--color-text-primary)]">
                    {module.class}
                    {module.rating ?? ''} {module.name}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                    {moduleFacts(module)
                      .slice(0, 4)
                      .map((f) => `${f.label} ${f.value}`)
                      .join(' · ')}
                  </span>
                  {module.cost !== null && module.cost > 0 && (
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                      {credits(module.cost)} cr
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}
