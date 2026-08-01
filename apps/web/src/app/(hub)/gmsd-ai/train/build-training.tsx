'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, apiDelete } from '../../../../lib/api-client';
import type { ShipBuildView, BuildRoleProgressView } from '../../../../lib/api';

/**
 * Ship build training.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "users should be able to submit links to existing coriolis and other elite dangerous ship builds
 * and it should take that link and learn everything about that ship and build" — and, clarified:
 * "the training import are for builds they find in the wild".
 *
 * That is what this tab is for. A member pastes a link to something they FOUND — off a forum, a
 * video, a friend — and we decode the whole loadout from it. Their own ships arrive separately and
 * automatically from their journals, which is a different claim and is shown as one.
 *
 * ★ NOTHING IS FETCHED FROM THOSE SITES ★
 *
 * Coriolis and EDSY both encode the entire build in the link, and we hold the module tables. So an
 * import makes no request to anybody: it cannot be rate limited, cannot break when a site is
 * redesigned, and works with that site down.
 */

const CONTROL =
  'w-full rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] ' +
  'focus:border-[var(--color-border-focus)] focus:outline-none';

/** Where a build came from, and how much it should be trusted. */
const SOURCE_LABEL: Record<string, string> = {
  coriolis: 'Coriolis',
  edsy: 'EDSY',
  journal: 'From the game',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
        {label}
      </div>
      <div className="font-mono text-xs text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

export function BuildTraining({
  builds,
  progress,
  canSubmit,
  canModerate,
  currentUserId,
}: {
  builds: ShipBuildView[];
  progress: BuildRoleProgressView[];
  canSubmit: boolean;
  canModerate: boolean;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (term === '') return builds;
    return builds.filter((b) =>
      [b.shipName, b.buildName, b.submittedBy].filter((v): v is string => v !== null).join(' ').toLowerCase().includes(term),
    );
  }, [builds, filter]);

  async function submit() {
    const link = url.trim();
    if (link === '') {
      setProblem('Paste a build link first.');
      return;
    }

    setBusy(true);
    setProblem(null);
    setDone(null);

    try {
      const r = await apiPost<{ shipName: string; buildName: string | null; fitted: number; slots: number; warnings: string[] }>(
        '/v1/ai/builds',
        { url: link },
      );

      setDone(
        `Read ${r.shipName}${r.buildName === null ? '' : ` — ${r.buildName}`}: ${r.fitted} of ${r.slots} slots fitted.` +
          (r.warnings.length > 0 ? ` ${r.warnings.join(' ')}` : ''),
      );
      setUrl('');
      // The list is server-rendered, so a refresh is what makes the new build appear.
      router.refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That link could not be read.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(build: ShipBuildView) {
    if (!window.confirm(`Remove ${build.shipName}${build.buildName === null ? '' : ` — ${build.buildName}`}?`)) {
      return;
    }
    try {
      await apiDelete(`/v1/ai/builds/${build.id}`);
      router.refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That could not be removed.');
    }
  }

  return (
    <>
      {/*
        ★ WHAT THE POOL STILL NEEDS — SQUADRON OWNER, 2026-08-01 ★

        "add a status bar like we have on the image training page so we know how many ship builds we
        need for reliable training ... over do it on the requirements so we have a solid base".

        Counted PER ROLE, because a single total would fill up while whole questions stayed
        unanswerable — forty exploration builds teach the assistant nothing about mining. The role is
        read off the modules at import rather than asked for: somebody pasting a link they found has
        no idea how we categorise it, and a dropdown they guess at is worse data than a rule.

        Above the form, for the same reason the image page puts its bars first: the page has to
        answer "is this worth my time" before it asks for anything.
      */}
      <div className="mb-6 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0 text-sm text-[var(--color-text-primary)]">What the pool still needs</h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
            {progress.filter((p) => p.ready).length} of {progress.length} roles ready
          </span>
        </div>

        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {progress.map((p) => {
            const pct = Math.min(100, Math.round((p.have / Math.max(1, p.need)) * 100));
            return (
              <li key={p.role}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-[var(--color-text-primary)]">{p.label}</span>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-secondary)]">
                    {p.have} / {p.need}
                    {p.ready && <span className="ml-1.5 text-[var(--color-semantic-success)]">ready</span>}
                  </span>
                </div>
                {/*
                  A real progressbar with the numbers on it. A bare coloured div is invisible to a
                  screen reader, and this is the element carrying the whole message of the section.
                */}
                <div
                  role="progressbar"
                  aria-valuenow={p.have}
                  aria-valuemin={0}
                  aria-valuemax={p.need}
                  aria-label={`${p.label} builds collected`}
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-void)]"
                >
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      p.ready ? 'bg-[var(--color-semantic-success)]' : 'bg-[var(--color-brand-cyan)]'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          These targets are deliberately high. The assistant can already compute a correct build from
          the module tables — what it cannot do without these is tell somebody what people{' '}
          <em>actually fly</em>, which is the more useful answer and needs enough examples that one
          unusual build cannot skew it. Combat needs the most: the same hull is fitted completely
          differently for AX, bounty hunting and PvP.
        </p>
      </div>

      {canSubmit ? (
        <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-5">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
              Build link
            </span>
            <div className="flex flex-wrap gap-2">
              <input
                type="url"
                className={`${CONTROL} min-w-[280px] flex-1`}
                placeholder="https://coriolis.io/outfit/… or https://edsy.org/#/L=…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="rounded-md border border-[var(--color-brand-cyan)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan)_16%,transparent)] disabled:opacity-50"
              >
                {busy ? 'Reading…' : 'Read the build'}
              </button>
            </div>
          </label>

          <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            Coriolis, orbis.zone and EDSY. The whole loadout is inside the link, so nothing is
            fetched from those sites — every module, its class and rating, and what it weighs comes
            from data we already hold.{' '}
            <span className="text-[var(--color-text-dim)]">
              Short links (sh.orbis.zone, edsy.org/s/…) carry no build — open them and copy the long
              address instead.
            </span>
          </p>

          {problem !== null && (
            <p className="mt-3 rounded-md border border-[var(--color-semantic-hostile)] bg-[color-mix(in_srgb,var(--color-semantic-hostile)_10%,transparent)] p-3 text-xs text-[var(--color-semantic-hostile-bright)]">
              {problem}
            </p>
          )}
          {done !== null && (
            <p className="mt-3 text-xs text-[var(--color-semantic-success)]">{done}</p>
          )}
        </div>
      ) : (
        /*
          Said plainly rather than showing a form that will refuse. An interface that offers things
          it will not do teaches people to distrust all of it.
        */
        <p className="rounded-lg border border-[var(--color-border-hairline)] p-4 text-sm text-[var(--color-text-secondary)]">
          Your rank does not include submitting training material yet. You can still read every
          build the squadron holds.
        </p>
      )}

      <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          className={`${CONTROL} max-w-xs`}
          placeholder="Filter by ship, build or member…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          {shown.length === builds.length
            ? `${builds.length} builds`
            : `${shown.length} of ${builds.length}`}
        </span>
      </div>

      {builds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border-hairline)] p-6 text-sm text-[var(--color-text-secondary)]">
          Nothing yet. Paste a build you have found and it will be read here — ship, every module,
          and what it actually does.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
          {shown.map((b) => (
            <li
              key={b.id}
              className={`rounded-lg border p-4 ${
                b.isBaseline
                  ? 'border-[var(--color-brand-orange-dim)] bg-[color-mix(in_srgb,var(--color-brand-orange)_6%,transparent)]'
                  : 'border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[var(--color-text-primary)]">
                  {b.shipName}
                  {b.buildName !== null && (
                    <span className="ml-2 text-sm text-[var(--color-text-secondary)]">
                      {b.buildName}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
                  {/*
                    A baseline is the squadron's reference; a member's is what somebody flies. The
                    assistant weights them differently, so the page says which is which.
                  */}
                  {b.isBaseline && (
                    <span className="rounded border border-[var(--color-brand-orange)] px-1.5 py-px text-[var(--color-brand-orange)]">
                      Baseline
                    </span>
                  )}
                  {b.fromJournal && (
                    <span className="rounded border border-[var(--color-semantic-success)] px-1.5 py-px text-[var(--color-semantic-success)]">
                      Their ship
                    </span>
                  )}
                  <span className="text-[var(--color-text-dim)]">
                    {SOURCE_LABEL[b.source] ?? b.source}
                  </span>
                </span>
              </div>

              {b.stats !== null && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Stat
                    label="Jump"
                    value={b.stats.jumpRange == null ? '—' : `${b.stats.jumpRange} ly`}
                  />
                  <Stat label="Mass" value={b.stats.unladenMass == null ? '—' : `${b.stats.unladenMass} t`} />
                  <Stat label="Cargo" value={b.stats.cargoCapacity == null ? '—' : `${b.stats.cargoCapacity} t`} />
                  <Stat
                    label="Power"
                    value={
                      b.stats.powerDrawn == null || b.stats.powerGenerated == null
                        ? '—'
                        : `${b.stats.powerDrawn}/${b.stats.powerGenerated}`
                    }
                  />
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-hairline)] pt-2.5 font-mono text-[10px] text-[var(--color-text-dim)]">
                <span>
                  {b.fitted}/{b.slots} slots
                  {b.submittedBy !== null && ` · ${b.submittedBy}`}
                </span>
                <span className="flex items-center gap-2">
                  <a
                    href={b.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="uppercase tracking-[0.12em] text-[var(--color-brand-cyan-bright)] hover:underline"
                  >
                    Open
                  </a>
                  {/*
                    Removal is offered for your own always, and for anybody's with AI_REVIEW. The
                    server checks both again — a hidden button is not a boundary.
                  */}
                  {(canModerate || (currentUserId !== null && b.submittedById === currentUserId)) && (
                    <button
                      type="button"
                      onClick={() => void remove(b)}
                      className="uppercase tracking-[0.12em] text-[var(--color-semantic-hostile-bright)] hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
