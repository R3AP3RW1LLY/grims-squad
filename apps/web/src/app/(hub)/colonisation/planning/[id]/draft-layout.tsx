'use client';

import { useState } from 'react';
import { apiPost } from '../../../../../lib/api-client';

/**
 * "Draft me a starting layout."
 *
 * ★ SQUADRON OWNER, 2026-08-18 ★
 *
 * Asked whether this should advise on a plan or draft one, the answer was both — with drafting
 * opt-in. This is the opt-in: nothing is generated until somebody presses it, and nothing it
 * produces touches the plan.
 *
 * ★ WHAT IT SHOWS, AND WHY THE ERRORS ARE NOT HIDDEN ★
 *
 * A drafted layout is dangerous precisely because it looks authoritative: an ordered list of real
 * structures on real bodies reads as a plan whether or not it obeys the tier economy.
 *
 * So the plan checker's verdict is rendered with it, errors first and in the warning colour, and a
 * failing draft is still shown. A member who can see "step 4 spends a tier-2 point that has not
 * been banked" learns something about the draft AND about the game; a member handed a silently
 * repaired list learns nothing and trusts the next one more than it has earned.
 */

interface DraftStep {
  typeId: string;
  bodyId: number;
  bodyName: string;
  why: string;
}

interface DraftIssue {
  code: string;
  step: number;
  message: string;
}

interface DraftResult {
  steps: DraftStep[];
  report: {
    ok: boolean;
    errors: DraftIssue[];
    warnings: DraftIssue[];
    totalTonnes: number;
  } | null;
  unavailable: string | null;
  /**
   * The question to answer before anything is drafted.
   *
   * ★ SQUADRON OWNER, 2026-08-22 ★
   *
   * "if a system already has a partial build ask the user if they want to override it, or if they
   * want to keep it and we work around it etc."
   *
   * Arrives WITH no steps: the drafter has not run. Asking afterwards would spend a model call, and
   * half a minute of somebody's evening, on a layout they may be about to reject wholesale.
   */
  ask: {
    question: string;
    fixedNote: string | null;
    fixedCount: number;
    intendedCount: number;
  } | null;
  /** What the draft was told it could not move. Null when nothing in the plan is built yet. */
  keptNote: string | null;
}

type Mode = 'keep' | 'override';

const CARD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3';

export function DraftLayout({ systemName, planId }: { systemName: string; planId: string }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * `planId` travels on every call so the drafter knows what it is working around. Without it this
   * drafts the system as though it were empty — which is what it used to do, and which on a plan
   * somebody has already started building produces a layout the game will refuse.
   */
  const draft = async (mode?: Mode): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setOut(
        await apiPost<DraftResult>(
          `/v1/logistics/colony/systems/${encodeURIComponent(systemName)}/draft`,
          { planId, ...(mode === undefined ? {} : { mode }) },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That draft could not be produced.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void draft()}
          disabled={busy}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-4 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)] disabled:opacity-50"
        >
          {busy ? 'Laying one out…' : 'Draft me a starting layout'}
        </button>
        <span className="text-xs text-[var(--color-text-dim)]">
          A suggestion, checked against the tier rules. It changes nothing until you build it.
        </span>
      </div>

      {error !== null && (
        <p className="m-0 mt-2 text-sm text-[var(--color-semantic-hostile)]" role="alert">
          {error}
        </p>
      )}

      {/*
        ★ THE QUESTION, BEFORE ANYTHING IS DRAFTED — SQUADRON OWNER, 2026-08-22 ★

        "if a system already has a partial build ask the user if they want to override it, or if
        they want to keep it and we work around it etc."

        Rendered INSTEAD of a result, because there is no result yet — the server returns the
        question with no steps rather than drafting first and asking afterwards.
      */}
      {out?.ask != null && (
        <div className="mt-3 rounded border border-[var(--color-border-active)] bg-[var(--color-surface-panel)] px-4 py-3">
          <p className="m-0 text-sm text-[var(--color-text-primary)]">{out.ask.question}</p>

          {/*
            What happens either way, said before the buttons rather than after the click. "Override"
            cannot move a station that is standing, and a member who is not told that would read
            their existing builds reappearing as the drafter ignoring them.
          */}
          {out.ask.fixedNote !== null && (
            <p className="m-0 mt-2 text-xs text-[var(--color-text-secondary)]">
              {out.ask.fixedNote}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void draft('keep')}
              disabled={busy}
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-4 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)] disabled:opacity-50"
            >
              Keep them and design around them
            </button>
            <button
              type="button"
              onClick={() => void draft('override')}
              disabled={busy}
              className="rounded-md border border-[var(--color-semantic-warning)] px-4 py-2 text-sm text-[var(--color-semantic-warning)] hover:bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)] disabled:opacity-50"
            >
              Replace the {out.ask.intendedCount} planned{' '}
              {out.ask.intendedCount === 1 ? 'structure' : 'structures'}
            </button>
          </div>
        </div>
      )}

      {out !== null && out.ask === null && (
        <div className="mt-3 flex flex-col gap-3">
          {/*
            What the draft could not move, on the result as well as in the question. A member who
            gets their existing stations back needs to know that was the platform being honest about
            what the game allows, not the drafter having ignored them.
          */}
          {out.keptNote !== null && (
            <p className="m-0 text-xs text-[var(--color-text-secondary)]">{out.keptNote}</p>
          )}
          {/*
            ★ THE VERDICT BEFORE THE LIST ★

            A member who reads eight plausible steps and only then discovers the plan does not work
            has already started deciding. The checker's answer comes first for the same reason the
            survey warnings come before the strengths.
          */}
          {out.report !== null && !out.report.ok && (
            <div className="rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)] px-4 py-3">
              <p className="m-0 mb-1 text-sm font-medium text-[var(--color-semantic-warning)]">
                This draft does not pass the plan checker.
              </p>
              <ul className="m-0 list-disc space-y-1 pl-5 text-xs text-[var(--color-semantic-warning)]">
                {out.report.errors.map((issue) => (
                  <li key={`${issue.code}-${issue.step}`}>{issue.message}</li>
                ))}
              </ul>
              <p className="m-0 mt-2 text-xs text-[var(--color-text-secondary)]">
                It is shown anyway — a draft you can see the faults in is worth more than one that
                was quietly tidied up.
              </p>
            </div>
          )}

          {out.report !== null && out.report.ok && (
            <p className="m-0 text-sm text-[var(--color-semantic-success)]">
              This draft passes the plan checker — {out.report.totalTonnes.toLocaleString()} t in
              total.
            </p>
          )}

          {out.steps.length > 0 && (
            <div className={CARD}>
              <ol className="m-0 list-decimal space-y-2 pl-5">
                {out.steps.map((step, i) => (
                  <li key={`${step.typeId}-${step.bodyId}-${i}`} className="text-sm">
                    <span className="font-medium text-[var(--color-text-primary)]">{step.typeId}</span>
                    <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{step.bodyName}</span>
                    {step.why !== '' && (
                      <div className="text-xs text-[var(--color-text-dim)]">{step.why}</div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {out.report !== null && out.report.warnings.length > 0 && (
            <ul className="m-0 list-disc space-y-1 pl-5 text-xs text-[var(--color-text-secondary)]">
              {out.report.warnings.map((issue) => (
                <li key={`${issue.code}-${issue.step}`}>{issue.message}</li>
              ))}
            </ul>
          )}

          {out.unavailable !== null && (
            <p className="m-0 text-xs text-[var(--color-text-secondary)]">{out.unavailable}</p>
          )}
        </div>
      )}
    </div>
  );
}
