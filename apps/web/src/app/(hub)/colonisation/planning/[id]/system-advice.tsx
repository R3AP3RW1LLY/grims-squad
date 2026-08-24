import type { SystemAdvice } from '../../../../../lib/api';
import { DraftLayout } from './draft-layout';

/**
 * What this system should be built as, and why.
 *
 * ★ SQUADRON OWNER, 2026-08-18 ★
 *
 * "add to the planning service in the companion app and website so we can do this exactly as you've
 * done ... this will help the squadron immensely!"
 *
 * ★ THE FACTS SIT BESIDE THE ADVICE, NOT BEHIND IT ★
 *
 * The counts, the distances and the role scores are computed from the survey; the paragraphs come
 * from the assistant. Both are shown, and the input is one click away, because a recommendation
 * that reads well and is wrong is worse than no recommendation at all — and the only way a member
 * can tell the difference is to see what it was told.
 *
 * That is the same rule the plan review follows on this page already.
 */

const CARD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3';

/** A count worth showing only when it is not zero — a row of zeroes is noise on a planning page. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
        {label}
      </div>
      <div className="font-mono tabular-nums text-sm text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

export function SystemAdvicePanel({
  advice,
  canDraft = false,
  planId,
}: {
  advice: SystemAdvice;
  /**
   * The plan being laid out, so the drafter knows what is already there.
   *
   * Squadron owner, 2026-08-22: a system with a partial build must be worked around rather than
   * drafted over. Optional because the scout page shows this same panel for a system nobody has
   * planned — and there `canDraft` is false anyway, so the button that needs it is not rendered.
   */
  planId?: string | undefined;
  /**
   * Whether to offer the drafting button.
   *
   * Off by default, and off on the scout page: drafting a layout for a system nobody has claimed is
   * an assistant call spent on a decision that has not been made. On the planning page, where
   * somebody is already laying the system out, it is exactly what they want.
   */
  canDraft?: boolean;
}) {
  const p = advice.profile;

  return (
    <section className="mt-6">
      <h2 className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
        What this system is for
      </h2>

      {p === null ? (
        <div className={CARD}>
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">
            {advice.unavailable ?? 'Nothing to advise on yet.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/*
            ★ THE WARNINGS COME FIRST, ABOVE EVERYTHING ★

            Both of these were found by hand while planning real systems, and both would otherwise be
            buried under a list of strengths that reads as encouragement. A system with four ringed
            gas giants 194,000 Ls out is a good mining system and a bad build, and the order these
            two facts are read in decides which one somebody acts on.
          */}
          {p.remote && (
            <div className="rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)] px-4 py-3">
              <p className="m-0 text-sm text-[var(--color-semantic-warning)]">
                <strong>Every body here is {Math.round((p.nearestLs ?? 0) / 1000).toLocaleString()},000 Ls out.</strong>{' '}
                The supercruise, not the resource, decides whether this system is worth building.
                Expect a fleet carrier to be part of any plan.
              </p>
            </div>
          )}
          {p.surfaceCapacity <= 1 && (
            <div className="rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)] px-4 py-3">
              <p className="m-0 text-sm text-[var(--color-semantic-warning)]">
                <strong>
                  Only {p.surfaceCapacity} landable {p.surfaceCapacity === 1 ? 'body' : 'bodies'}.
                </strong>{' '}
                Settlements are surface builds, so almost everything here has to be built in orbit.
              </p>
            </div>
          )}

          <div className={CARD}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <Stat label="Bodies" value={p.bodyCount} />
              <Stat label="Landable" value={p.landable} />
              <Stat label="Ringed" value={p.ringed} />
              {p.waterWorlds > 0 && <Stat label="Water worlds" value={p.waterWorlds} />}
              {p.terraformCandidates > 0 && <Stat label="Terraforming" value={p.terraformCandidates} />}
              <Stat
                label="Nearest"
                value={p.nearestLs === null ? '—' : `${Math.round(p.nearestLs).toLocaleString()} Ls`}
              />
            </div>
          </div>

          {/*
            The scores and their objections. Shown as facts because they are computed — a member can
            check "four ringed bodies" against the system map, which is the whole point of not
            letting the model produce them.
          */}
          <div className={CARD}>
            <p className="m-0 mb-2 text-xs text-[var(--color-text-secondary)]">
              What the survey supports, best first
              {advice.decidedRole !== null && (
                <> &middot; the squadron has already designated this system <strong>{advice.decidedRole}</strong></>
              )}
            </p>
            <ul className="m-0 list-none space-y-2 p-0">
              {advice.fits.slice(0, 4).map((fit) => (
                <li key={fit.role} className="text-sm">
                  <span className="font-medium text-[var(--color-text-primary)]">{fit.role}</span>
                  <span className="ml-2 font-mono text-[11px] text-[var(--color-text-dim)]">{fit.score}</span>
                  {fit.reasons.length > 0 && (
                    <div className="text-xs text-[var(--color-text-secondary)]">{fit.reasons.join(' · ')}</div>
                  )}
                  {fit.against.map((against) => (
                    <div key={against} className="text-xs text-[var(--color-semantic-warning)]">
                      {against}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </div>

          {/*
            ★ THE BLOC IS WHAT NO SINGLE SYSTEM CAN SEE ★

            That the squadron refines ore in one system and builds high tech in another and has
            nothing in between is a property of the SET. It is the finding that changed the Col 285
            plans, and it is invisible from any one system's page.
          */}
          {advice.bloc !== null && advice.bloc.gaps.length > 0 && (
            <div className={CARD}>
              <p className="m-0 mb-2 text-xs text-[var(--color-text-secondary)]">
                {advice.bloc.name} is missing
              </p>
              <ul className="m-0 list-none space-y-1 p-0">
                {advice.bloc.gaps.map((gap) => (
                  <li key={gap.role} className="text-sm text-[var(--color-text-primary)]">
                    <strong>{gap.role}</strong>{' '}
                    <span className="text-xs text-[var(--color-text-secondary)]">{gap.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {advice.advice !== '' && (
            <div className={CARD}>
              {advice.advice.split('\n').filter(Boolean).map((para) => (
                <p key={para.slice(0, 40)} className="m-0 mb-2 text-sm leading-relaxed text-[var(--color-text-primary)] last:mb-0">
                  {para}
                </p>
              ))}
            </div>
          )}

          {advice.unavailable !== null && (
            <p className="m-0 text-xs text-[var(--color-text-secondary)]">{advice.unavailable}</p>
          )}

          {/*
            What the assistant was told, verbatim.

            Collapsed rather than hidden: it is the difference between advice a member can check and
            advice they have to trust, and this platform has repeatedly found it should not have
            asked for trust.
          */}
          {canDraft && advice.profile !== null && planId !== undefined && (
            <DraftLayout systemName={advice.systemName} planId={planId} />
          )}

          {advice.facts !== '' && (
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--color-text-secondary)]">
                What this was worked out from
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-[var(--color-surface-void)] p-3 font-mono text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                {advice.facts}
              </pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
