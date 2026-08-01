'use client';

import { useState } from 'react';
import { apiPost } from '../../../lib/api-client';

/**
 * AI assisted — a few questions, then a real build.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "the AI assisted, should again be a stepper that asks questions and answers to gather the
 * information it needs to make a reliable build based on the users input and responses."
 *
 * ★ THE ANSWER IS COMPUTED, NOT WRITTEN ★
 *
 * The stepper collects a role and a budget and hands them to the fitting engine, which searches
 * every hull and every module Frontier ships. The result is a real loadout with real numbers.
 *
 * Nothing here asks a language model what to fit. A model asked for a loadout produces modules that
 * do not exist and jump ranges it invented, confidently, in the same prose as a correct answer —
 * and somebody would go and spend two hundred million credits on it.
 */

type Step = 'role' | 'budget' | 'result';

interface Fit {
  build: { shipId: string; shipName: string; buildName: string | null; modules: Array<{ moduleId: string | null }> };
  stats: {
    unladenMass: number;
    jumpRange: number | null;
    ladenJumpRange: number | null;
    cargoCapacity: number;
    fuelCapacity: number;
    shields: number | null;
    armour: number;
    dps: number | null;
    powerDrawn: number;
    powerGenerated: number;
    powerDeficit: boolean;
  } | null;
  totalCost: number;
  whyThisShip: string;
  compromises: string[];
}

/**
 * The jobs somebody actually asks for.
 *
 * Written as the question a member would ask rather than as a category, because "combat" is a label
 * and "I want to fight things" is what somebody means. The description says what the fitter will
 * optimise for, so the choice is informed rather than a guess at our vocabulary.
 */
const ROLES: ReadonlyArray<{ key: string; label: string; blurb: string }> = [
  {
    key: 'mining',
    label: 'Mining',
    blurb: 'Lasers, a refinery, limpets and as much hold as fits around them.',
  },
  {
    key: 'combat',
    label: 'Combat',
    blurb: 'Damage and the ability to survive delivering it — A-rated throughout.',
  },
  {
    key: 'explorer',
    label: 'Exploration',
    blurb: 'The longest jump the hull can carry. Light everywhere except the drive.',
  },
  {
    key: 'trader',
    label: 'Trading',
    blurb: 'Every tonne of module is a tonne of cargo not carried.',
  },
];

/**
 * Budgets offered as bands rather than a free number.
 *
 * A slider invites precision nobody has — "about fifty million" is how people think about this, and
 * an exact figure would imply the fitter spends to the last credit. Somebody who wants an exact
 * number can still type one.
 */
const BUDGETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '10 million', value: 10_000_000 },
  { label: '50 million', value: 50_000_000 },
  { label: '150 million', value: 150_000_000 },
  { label: '400 million', value: 400_000_000 },
  { label: '1 billion', value: 1_000_000_000 },
];

const credits = (n: number): string =>
  n >= 1_000_000_000
    ? `${(n / 1_000_000_000).toFixed(2)} billion`
    : `${(n / 1_000_000).toFixed(1)} million`;

export function AiBuilder() {
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);

  async function build(chosenBudget: number | undefined) {
    if (role === null) return;

    setBusy(true);
    setProblem(null);

    try {
      const result = await apiPost<Fit>('/v1/ai/shipyard/fit', {
        role,
        ...(chosenBudget === undefined ? {} : { budget: chosenBudget }),
      });
      setFit(result);
      setStep('result');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Nothing could be fitted for that.');
    } finally {
      setBusy(false);
    }
  }

  const restart = () => {
    setStep('role');
    setRole(null);
    setBudget(null);
    setCustom('');
    setFit(null);
    setProblem(null);
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* Where you are, and how far there is to go. Three steps is short enough to show all of them. */}
      <ol className="m-0 mb-6 flex list-none gap-2 p-0">
        {(['role', 'budget', 'result'] as const).map((s, i) => (
          <li key={s} className="flex-1">
            <div
              className={`h-1 rounded-full ${
                (['role', 'budget', 'result'] as const).indexOf(step) >= i
                  ? 'bg-[var(--color-brand-cyan)]'
                  : 'bg-[var(--color-surface-panel)]'
              }`}
            />
            <span className="mt-1.5 block font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
              {s === 'role' ? 'What for' : s === 'budget' ? 'Budget' : 'Your ship'}
            </span>
          </li>
        ))}
      </ol>

      {step === 'role' && (
        <>
          <h2 className="m-0 text-lg text-[var(--color-text-primary)]">What is the ship for?</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            This decides what gets fitted and what gets sacrificed for it.
          </p>

          <ul className="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2">
            {ROLES.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => {
                    setRole(r.key);
                    setStep('budget');
                  }}
                  className="w-full rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4 text-left transition-colors hover:border-[var(--color-brand-cyan)] hover:bg-[var(--color-surface-panel-hover)]"
                >
                  <span className="block text-[var(--color-text-primary)]">{r.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-[var(--color-text-secondary)]">
                    {r.blurb}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {step === 'budget' && (
        <>
          <h2 className="m-0 text-lg text-[var(--color-text-primary)]">How much can you spend?</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Hull and modules together. Nothing over this will be suggested — a recommendation you
            cannot afford is worse than none, because you find out at the shipyard.
          </p>

          <ul className="m-0 mt-4 grid list-none gap-2 p-0 sm:grid-cols-3">
            {BUDGETS.map((b) => (
              <li key={b.value}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBudget(b.value);
                    void build(b.value);
                  }}
                  className="w-full rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3 font-mono text-xs text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-brand-cyan)] disabled:opacity-50"
                >
                  {b.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="block flex-1">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
                Or an exact figure, in credits
              </span>
              <input
                type="number"
                min={0}
                className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
                placeholder="e.g. 85000000"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || custom.trim() === ''}
              onClick={() => {
                const n = Number(custom);
                if (Number.isFinite(n) && n > 0) {
                  setBudget(n);
                  void build(n);
                }
              }}
              className="rounded-md border border-[var(--color-brand-cyan)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-brand-cyan-bright)] disabled:opacity-40"
            >
              {busy ? 'Fitting…' : 'Build it'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setStep('role')}
            className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            ← Back
          </button>

          {problem !== null && (
            <p className="mt-4 rounded-md border border-[var(--color-semantic-hostile)] bg-[color-mix(in_srgb,var(--color-semantic-hostile)_10%,transparent)] p-3 text-xs text-[var(--color-semantic-hostile-bright)]">
              {problem}
            </p>
          )}
        </>
      )}

      {step === 'result' && fit !== null && (
        <>
          <h2 className="m-0 text-lg text-[var(--color-text-primary)]">{fit.build.shipName}</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-brand-cyan-bright)]">
            {credits(fit.totalCost)} credits
            {budget !== null && (
              <span className="ml-2 text-[var(--color-text-dim)]">
                of {credits(budget)} budgeted
              </span>
            )}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4 sm:grid-cols-4">
            {[
              ['Jump', fit.stats?.jumpRange == null ? '—' : `${fit.stats.jumpRange} ly`],
              ['Laden jump', fit.stats?.ladenJumpRange == null ? '—' : `${fit.stats.ladenJumpRange} ly`],
              ['Cargo', fit.stats === null ? '—' : `${fit.stats.cargoCapacity} t`],
              ['Mass', fit.stats === null ? '—' : `${fit.stats.unladenMass} t`],
              ['Shields', fit.stats?.shields == null ? '—' : `${fit.stats.shields} MJ`],
              ['Armour', fit.stats === null ? '—' : String(fit.stats.armour)],
              ['DPS', fit.stats?.dps == null ? '—' : String(fit.stats.dps)],
              [
                'Power',
                fit.stats === null ? '—' : `${fit.stats.powerDrawn}/${fit.stats.powerGenerated}`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
                  {label}
                </div>
                <div className="font-mono text-sm tabular-nums text-[var(--color-text-primary)]">
                  {value}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {fit.whyThisShip}
          </p>

          {fit.compromises.length > 0 && (
            /*
              Said plainly. A fit that could not afford something, or that draws more power than it
              makes, is still the best answer available — but presenting it without saying so would
              be presenting a compromise as a recommendation.
            */
            <ul className="m-0 mt-3 list-none space-y-1 p-0">
              {fit.compromises.map((c) => (
                <li key={c} className="text-xs text-[var(--color-semantic-warning)]">
                  {c}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <a
              href={`/shipyard?ship=${fit.build.shipId}`}
              className="rounded-md border border-[var(--color-brand-cyan)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan)_16%,transparent)]"
            >
              Open in the builder
            </a>
            <button
              type="button"
              onClick={restart}
              className="rounded-md border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
            >
              Start again
            </button>
          </div>

          <p className="mt-5 text-xs leading-relaxed text-[var(--color-text-dim)]">
            Every module here comes from the game&rsquo;s own data and every figure is computed from
            what is fitted. Nothing was guessed at.
          </p>
        </>
      )}
    </div>
  );
}
