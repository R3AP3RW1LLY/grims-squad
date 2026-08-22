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
}

const CARD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3';

export function DraftLayout({ systemName }: { systemName: string }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setOut(
        await apiPost<DraftResult>(
          `/v1/logistics/colony/systems/${encodeURIComponent(systemName)}/draft`,
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

      {out !== null && (
        <div className="mt-3 flex flex-col gap-3">
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
