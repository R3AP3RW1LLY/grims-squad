'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, apiDelete } from '../../../../lib/api-client';
import type { ShipBuildView } from '../../../../lib/api';

/**
 * The squadron's reference builds.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "in the admin /app/training i want to add a section where the webmaster can import via link in
 * the same way all the default ship builds please this will be the base level, we also need to
 * learn all the various stats about all the items and components, ships etc"
 *
 * ★ WHY A BASELINE IS NOT JUST ANOTHER BUILD ★
 *
 * A member's contribution says "somebody flies this". A baseline says "this is how the squadron
 * does it". The assistant weights and cites them differently, and collapsing the two would let one
 * person's experiment answer as doctrine — so they are imported here, by an officer, and stored
 * against the squadron rather than against whoever pasted them.
 *
 * ★ A BARE OUTFIT LINK IS THE STOCK SHIP ★
 *
 * `coriolis.io/outfit/panthermkii` with no build code is how Coriolis addresses a ship with its
 * factory loadout. That is exactly what "all the default ship builds" means, and it needs no code
 * to parse — the stock fit is already in the data the Coriolis ingest lands.
 */

const CONTROL =
  'w-full rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] ' +
  'focus:border-[var(--color-border-focus)] focus:outline-none';

export function BaselineBuilds({ builds }: { builds: ShipBuildView[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [report, setReport] = useState<string[]>([]);

  /**
   * Imports every link in the box, one at a time.
   *
   * ★ ONE FAILURE MUST NOT LOSE THE REST ★
   *
   * Pasting forty stock-ship links is the obvious way to seed a baseline, and one of them being a
   * hull we do not hold yet should cost that line and nothing else. Each result is reported by
   * name, so a partial run is legible rather than a count that does not add up.
   */
  async function importAll() {
    const links = text
      .split(/\s+/)
      .map((l) => l.trim())
      .filter((l) => l !== '');

    if (links.length === 0) {
      setProblem('Paste one or more build links.');
      return;
    }

    setBusy(true);
    setProblem(null);
    setReport([]);

    const lines: string[] = [];
    for (const link of links) {
      try {
        const r = await apiPost<{ shipName: string; buildName: string | null; fitted: number; slots: number }>(
          '/v1/ai/builds/baseline',
          { url: link },
        );
        lines.push(`✓ ${r.shipName}${r.buildName === null ? '' : ` — ${r.buildName}`} · ${r.fitted}/${r.slots} slots`);
      } catch (e) {
        lines.push(`✗ ${link.slice(0, 48)}… — ${e instanceof Error ? e.message : 'could not be read'}`);
      }
      setReport([...lines]);
    }

    setBusy(false);
    setText('');
    router.refresh();
  }

  async function remove(build: ShipBuildView) {
    if (!window.confirm(`Remove the baseline ${build.shipName}?`)) return;
    try {
      await apiDelete(`/v1/ai/builds/${build.id}`);
      router.refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That could not be removed.');
    }
  }

  return (
    <>
      <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-5">
        <label className="block">
          <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
            Build links — one per line
          </span>
          <textarea
            rows={4}
            className={CONTROL}
            placeholder={'https://coriolis.io/outfit/panthermkii\nhttps://coriolis.io/outfit/python_nx\nhttps://coriolis.io/outfit/imperial_clipper'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--color-text-secondary)]">
            A Coriolis link with no build code is that ship&rsquo;s <strong>factory loadout</strong>,
            which is what a baseline usually wants. Coriolis, orbis.zone and EDSY links all work, and
            nothing is fetched from those sites — the build is inside the link.
          </p>
          <button
            type="button"
            onClick={() => void importAll()}
            disabled={busy}
            className="shrink-0 rounded-md border border-[var(--color-brand-orange)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_16%,transparent)] disabled:opacity-50"
          >
            {busy ? 'Reading…' : 'Import as baseline'}
          </button>
        </div>

        {problem !== null && (
          <p className="mt-3 text-xs text-[var(--color-semantic-hostile-bright)]">{problem}</p>
        )}

        {report.length > 0 && (
          /*
            Every line reported, successes and failures together. A summary count would hide which
            of forty links failed, which is the only thing somebody needs to know afterwards.
          */
          <ul className="mt-3 m-0 list-none space-y-1 p-0 font-mono text-[11px]">
            {report.map((line) => (
              <li
                key={line}
                className={
                  line.startsWith('✓')
                    ? 'text-[var(--color-semantic-success)]'
                    : 'text-[var(--color-semantic-hostile-bright)]'
                }
              >
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      {builds.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-[var(--color-border-hairline)] p-6 text-sm text-[var(--color-text-secondary)]">
          No baseline yet. Without one the assistant answers only from what members have submitted,
          which is a thinner and less consistent foundation than the squadron&rsquo;s own reference
          builds.
        </p>
      ) : (
        <ul className="mt-5 m-0 grid list-none gap-2 p-0 lg:grid-cols-2">
          {builds.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-[var(--color-text-primary)]">
                  {b.shipName}
                  {b.buildName !== null && (
                    <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                      {b.buildName}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                  {b.fitted}/{b.slots} slots
                  {b.stats?.jumpRange != null && ` · ${b.stats.jumpRange} ly`}
                  {b.stats?.cargoCapacity != null && b.stats.cargoCapacity > 0 && ` · ${b.stats.cargoCapacity} t cargo`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void remove(b)}
                className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-semantic-hostile-bright)] hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
