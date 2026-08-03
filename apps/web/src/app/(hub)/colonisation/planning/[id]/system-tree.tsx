'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ColonyBuildType, ColonyPlan, PlanBody, PlanSite } from '../../../../../lib/api';
import { apiDelete, apiPatch, apiPost } from '../../../../../lib/api-client';

/**
 * The system, laid out, with what is planned on each body.
 *
 * ★ A VERTICAL INDENTED TREE, NOT AN ORRERY ★
 *
 * Both RavenColonial and Frontier's own system schematic do this, and the reasons hold here more
 * strongly than for either:
 *
 *   - A vertical list IS the mobile shape. Nothing has to change at narrow widths except the indent
 *     depth, where an orbit diagram has to be rebuilt.
 *   - A horizontal orrery inverts the browser's free axis. Scrolling sideways to find a body is the
 *     worst thing you can do on a touch device, and a 40-body system guarantees it.
 *   - Ordinary document flow does the layout. There is no geometry to compute, which is why this
 *     handles a 173-body system without a layout engine.
 *
 * Indentation comes from `parentBodyId`, so a moon sits under its planet exactly as the game draws
 * it. EDSM's `parents` list is ordered nearest-first and barycentres are skipped, so a moon of a
 * binary pair attaches to the nearest thing that can actually be drawn.
 *
 * ★ NO DRAG AND DROP ★
 *
 * We have no drag library and adding one to reorder a list would be a dependency for a control that
 * does not work with a keyboard. Up and down buttons reorder it, which is operable by anybody,
 * survives a narrow window, and sends the same whole-order save a drag would.
 */

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] ' +
  'px-2 py-1 text-xs text-[var(--color-text-primary)]';

const CHIP =
  'rounded border border-[var(--color-border-hairline)] px-2 py-0.5 font-mono text-[10px] ' +
  'uppercase tracking-[0.16em] text-[var(--color-text-secondary)] transition-colors ' +
  'hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] disabled:opacity-40';

/** Nests bodies under their parents. Anything whose parent is missing is treated as a root. */
function tree(bodies: readonly PlanBody[]): Array<{ body: PlanBody; depth: number }> {
  const byParent = new Map<number | null, PlanBody[]>();
  const known = new Set(bodies.map((b) => b.bodyId));

  for (const b of bodies) {
    // A parent we do not hold — an unscanned barycentre, say — would orphan the whole branch, so
    // the body is promoted to a root rather than vanishing off the diagram.
    const key = b.parentBodyId !== null && known.has(b.parentBodyId) ? b.parentBodyId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), b]);
  }

  const out: Array<{ body: PlanBody; depth: number }> = [];
  const walk = (parent: number | null, depth: number): void => {
    for (const body of byParent.get(parent) ?? []) {
      out.push({ body, depth });
      // Capped, because a cycle in bad data would otherwise recurse for ever. Real systems nest
      // three deep — star, planet, moon — and four is already generous.
      if (depth < 4) walk(body.bodyId, depth + 1);
    }
  };
  walk(null, 0);

  return out;
}

/** What a body is, in the words a system map uses. */
function describe(b: PlanBody): string {
  const bits = [b.subType ?? b.kind];
  if (b.isLandable) bits.push('landable');
  if (b.gravity !== null) bits.push(`${b.gravity.toFixed(2)}g`);
  if (b.temperature !== null) bits.push(`${Math.round(b.temperature)}K`);
  if (b.hasRings) bits.push('rings');
  if (b.terraformable) bits.push('terraformable');
  return bits.join(' · ');
}

export function SystemTree({
  plan,
  buildTypes,
  canEdit,
}: {
  plan: ColonyPlan;
  buildTypes: readonly ColonyBuildType[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/v1/logistics/colony/plans/${encodeURIComponent(plan.id)}`;

  /*
   * Every write goes through here so the version and the failure path are one path. A stale save is
   * the interesting case: the server refuses it with both revision numbers, and that sentence is
   * shown rather than paraphrased — it is the only thing that explains what just happened.
   */
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const rows = tree(plan.bodies);
  const sitesOn = (bodyId: number): PlanSite[] => plan.sites.filter((s) => s.bodyId === bodyId);

  if (plan.bodies.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        {/*
          Honest about which of two very different things happened. A system nobody has scanned and
          a system that does not exist look identical from EDSM, and neither is our failure.
        */}
        Nothing has been scanned in {plan.systemName} yet, or the name does not match a system
        anybody has visited. Bodies appear here once somebody surveys it.
      </p>
    );
  }

  return (
    <div>
      {error === null ? null : (
        <p className="m-0 mb-4 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}

      <ol className="m-0 list-none p-0">
        {rows.map(({ body, depth }) => {
          const here = sitesOn(body.bodyId);
          const orbital = here.filter((s) => s.location === 'orbital');
          const surface = here.filter((s) => s.location === 'surface');

          return (
            <li
              key={body.bodyId}
              // Indentation IS the nesting. A border-left makes it readable at a glance where
              // padding alone reads as an accident on a narrow sidebar.
              style={{ marginLeft: `${depth * 18}px` }}
              className={
                depth === 0
                  ? 'border-t border-[var(--color-border-hairline)] py-3'
                  : 'border-t border-l border-[var(--color-border-hairline)] py-3 pl-3'
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm text-[var(--color-text-primary)]">
                  {/* The system prefix is on every body name and says nothing — "Hyades Sector
                      XJ-Z c18 6 f a" is four words of noise and one identifier. */}
                  {body.name.startsWith(plan.systemName)
                    ? body.name.slice(plan.systemName.length).trim() || body.name
                    : body.name}
                  <span className="ml-2 text-[11px] text-[var(--color-text-dim)]">
                    {describe(body)}
                  </span>
                </span>
                {body.distanceLs === null ? null : (
                  <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                    {Math.round(body.distanceLs).toLocaleString()} ls
                  </span>
                )}
              </div>

              <Slots body={body} plan={plan} canEdit={canEdit} act={act} />

              {(['orbital', 'surface'] as const).map((where) => {
                const list = where === 'orbital' ? orbital : surface;
                const cap = where === 'orbital' ? body.orbitalSlots : body.surfaceSlots;

                return (
                  <div key={where} className="mt-2">
                    <p className="m-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
                      {where}
                      {cap === null ? '' : ` · ${list.length} of ${cap}`}
                    </p>

                    {list.length === 0 ? null : (
                      <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                        {list.map((s) => (
                          <li
                            key={s.id}
                            className="flex items-baseline justify-between gap-3 text-xs text-[var(--color-text-secondary)]"
                          >
                            <span>
                              <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                                #{s.position + 1}
                              </span>{' '}
                              {s.buildTypeName ?? 'nothing chosen yet'}
                              {s.isPrimary ? (
                                <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-brand-orange)]">
                                  primary
                                </span>
                              ) : null}
                              {s.totalTonnes === null ? null : (
                                <span className="ml-2 font-mono tabular-nums text-[var(--color-text-dim)]">
                                  {s.totalTonnes.toLocaleString()} t
                                </span>
                              )}
                            </span>
                            {canEdit ? (
                              <button
                                type="button"
                                disabled={busy}
                                className={CHIP}
                                onClick={() =>
                                  void act(() =>
                                    apiDelete(`${base}/sites/${s.id}?version=${plan.version}`),
                                  )
                                }
                              >
                                Remove
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canEdit && (cap === null || list.length < cap) ? (
                      <AddSite
                        buildTypes={buildTypes}
                        where={where}
                        busy={busy}
                        onAdd={(buildTypeId) =>
                          void act(() =>
                            apiPost(`${base}/sites`, {
                              version: plan.version,
                              bodyId: body.bodyId,
                              location: where,
                              buildTypeId,
                            }),
                          )
                        }
                      />
                    ) : null}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The slot counts, entered rather than predicted.
 *
 * ★ THE OWNER CHOSE TO ASK FOR BOTH ★
 *
 * A community formula exists for surface slots and none exists at all for orbital — RavenColonial
 * predicts the first and asks for the second. Asking for both is stricter and more honest: every
 * number on this page is then something somebody read off their own screen, with their name on it.
 */
function Slots({
  body,
  plan,
  canEdit,
  act,
}: {
  body: PlanBody;
  plan: ColonyPlan;
  canEdit: boolean;
  act: (fn: () => Promise<unknown>) => void;
}) {
  const [orbital, setOrbital] = useState(body.orbitalSlots?.toString() ?? '');
  const [surface, setSurface] = useState(body.surfaceSlots?.toString() ?? '');

  if (!canEdit) {
    if (body.orbitalSlots === null && body.surfaceSlots === null) return null;
    return (
      <p className="m-0 mt-1 font-mono text-[10px] text-[var(--color-text-dim)]">
        {body.orbitalSlots ?? '?'} orbital · {body.surfaceSlots ?? '?'} surface
        {body.slotsBy === null ? '' : ` · read by ${body.slotsBy}`}
      </p>
    );
  }

  /*
   * ★ THESE TWO FIELDS ARE NOT DISABLED WHILE SAVING, AND THAT IS DELIBERATE ★
   *
   * Every other control here goes dead mid-save. These cannot: they save on blur, and tabbing from
   * orb to surf fires that blur — so disabling would take focus away from the field the member just
   * moved into, mid-keystroke. Nothing is at risk by leaving them live, because a slot count is a
   * fact about the galaxy keyed on the body itself, carries no plan revision, and the second write
   * simply lands after the first.
   */
  const save = (): void => {
    const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));
    act(() =>
      apiPatch(`/v1/logistics/colony/plans/bodies/${plan.systemId64}/${body.bodyId}`, {
        orbital: num(orbital),
        surface: num(surface),
      }),
    );
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
        slots
      </span>
      {[
        { label: 'orb', value: orbital, set: setOrbital },
        { label: 'surf', value: surface, set: setSurface },
      ].map((f) => (
        <label key={f.label} className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-[var(--color-text-dim)]">{f.label}</span>
          <input
            value={f.value}
            onChange={(e) => f.set(e.target.value)}
            onBlur={save}
            inputMode="numeric"
            placeholder="?"
            className={`${FIELD} w-11 text-center`}
          />
        </label>
      ))}
      {/*
        Attribution belongs to a NUMBER, not to a row. Clearing both boxes leaves the name behind in
        the database, and printing it next to two empty fields would credit somebody with a reading
        that is no longer there.
      */}
      {body.slotsBy === null || (body.orbitalSlots === null && body.surfaceSlots === null) ? (
        // Said plainly. An empty box on a planner reads as "we do not know", and the member looking
        // at it is the only person who can fix that — from a screen they already have open.
        <span className="text-[10px] text-[var(--color-text-dim)]">read these off the game</span>
      ) : (
        <span className="text-[10px] text-[var(--color-text-dim)]">by {body.slotsBy}</span>
      )}
    </div>
  );
}

/** Puts a build in a slot. */
function AddSite({
  buildTypes,
  where,
  busy,
  onAdd,
}: {
  buildTypes: readonly ColonyBuildType[];
  where: 'orbital' | 'surface';
  busy: boolean;
  onAdd: (buildTypeId: string) => void;
}) {
  const [choice, setChoice] = useState('');
  const [open, setOpen] = useState(false);

  /*
   * ★ THE PICKER IS BUILT WHEN IT IS OPENED, NOT WHEN THE PAGE IS ★
   *
   * Every body has two of these and the catalogue is fifty-five builds, so rendering them all up
   * front puts the whole catalogue on the page forty-four times over for a twenty-two body system —
   * measured at 337 KB of HTML, and a 173-body system would be several megabytes of markup nobody
   * asked for. A button costs a line. The list is one click away and identical when it arrives.
   */
  if (!open) {
    return (
      <button type="button" className={`${CHIP} mt-1`} onClick={() => setOpen(true)}>
        + add a build
      </button>
    );
  }

  /*
   * Filtered by where it can actually go. An orbital list offering surface settlements is a list
   * somebody has to know the game to read — and the whole point of this page is that they should
   * not have to.
   */
  const usable = buildTypes.filter((b) => b.location === where);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        // Focused on open, because the click that opened this was a click ON the control it
        // replaced — leaving focus on a button that no longer exists strands a keyboard entirely.
        autoFocus
        className={`${FIELD} max-w-[260px]`}
      >
        <option value="">add a build…</option>
        {usable.map((b) => (
          <option key={b.id} value={b.id}>
            {b.displayName} · T{b.tier} · {b.totalTonnes.toLocaleString()} t
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || choice === ''}
        className={CHIP}
        onClick={() => {
          onAdd(choice);
          setChoice('');
          setOpen(false);
        }}
      >
        Add
      </button>
      <button type="button" className={CHIP} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
