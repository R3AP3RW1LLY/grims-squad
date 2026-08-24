'use client';

import { useState } from 'react';
import { apiPost } from '../../../../../lib/api-client';

/**
 * Importing a Raven Colonial export into this plan.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "in raven colonial, we can export a json file with a users build plan, can we take this file ...
 * and generate a new colonization plan" — and on the one real conflict, "Import wins, and say so."
 *
 * ★ WHAT THE FILE GIVES US THAT NOTHING ELSE CAN ★
 *
 * The orbital and surface slot counts. An earlier session checked 101 journals and confirmed Elite
 * emits none of them, so the only way in was a member reading the in-game architect view and typing
 * what they saw. That measurably does not scale: of thirteen planned systems, three had any slot
 * data at all. Members did three and stopped.
 *
 * ★ TWO STEPS, ALWAYS ★
 *
 * Nothing is written until the member has seen what would change. The worst outcome available here
 * is silently replacing a plan somebody spent an evening on, and every failure mode is quiet — the
 * wrong file, an old export of a system since rebuilt — so the plan would just become something
 * else with nothing saying which parts were theirs.
 */

interface SlotChange {
  bodyName: string;
  from: { orbital: number | null; surface: number | null };
  to: { orbital: number | null; surface: number | null };
  overwritesTyped: boolean;
}

interface Preview {
  systemName: string;
  unknownBodies: string[];
  slotsAdded: SlotChange[];
  slotsChanged: SlotChange[];
  sitesAdded: number;
  siteConflicts: string[];
  identical: boolean;
  problems: string[];
}

const count = (n: number | null): string => (n === null ? '—' : String(n));
const pair = (v: { orbital: number | null; surface: number | null }): string =>
  `${count(v.orbital)} orbital, ${count(v.surface)} surface`;

export function RavenImport({ planId, canEdit }: { planId: string; canEdit: boolean }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const send = async (path: string, file: unknown): Promise<unknown> =>
    apiPost(`/v1/logistics/colony/plans/${encodeURIComponent(planId)}/${path}`, { file });

  const onFile = async (text: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      /*
       * The text goes up as-is rather than being parsed here. The hub reads it with the same
       * `readRavenExport` the companion's route uses, so a file cannot be understood one way on the
       * website and another way in the app.
       */
      const out = (await send('import/preview', text)) as { preview: Preview };
      setPreview(out.preview);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const out = (await send('import', raw)) as { slotsWritten: number };
      setDone(
        out.slotsWritten === 0
          ? 'Nothing needed changing.'
          : `${out.slotsWritten} slot count${out.slotsWritten === 1 ? '' : 's'} written.`,
      );
      setPreview(null);
      // A hard reload rather than a router refresh: the slot counts feed the system tree, the
      // summary and the plan checker, and half-refreshed numbers are worse than a moment's wait.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That import could not be applied.');
    } finally {
      setBusy(false);
    }
  };

  const [raw, setRaw] = useState<string>('');

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-4 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)]">
          {busy ? 'Reading…' : 'Choose a Raven export'}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen === undefined) return;
              void chosen.text().then((text) => {
                setRaw(text);
                return onFile(text);
              });
            }}
          />
        </label>
        <span className="text-xs text-[var(--color-text-dim)]">
          Nothing changes until you have seen what it would do.
        </span>
      </div>

      {error !== null && (
        <p className="m-0 text-sm text-[var(--color-semantic-hostile)]" role="alert">
          {error}
        </p>
      )}

      {done !== null && (
        <p className="m-0 text-sm text-[var(--color-semantic-success)]">{done}</p>
      )}

      {preview !== null && (
        <div className="rounded border border-[var(--color-border-active)] bg-[var(--color-surface-panel)] px-4 py-3">
          <p className="m-0 text-sm text-[var(--color-text-primary)]">
            {preview.systemName}
          </p>

          {preview.identical ? (
            <p className="m-0 mt-2 text-sm text-[var(--color-text-secondary)]">
              This file matches the plan already — nothing would change.
            </p>
          ) : (
            <>
              {/*
                ★ LOSSES FIRST ★

                The same ordering the survey warnings and the plan checker use. A summary that leads
                with what is gained and buries "two counts you typed will be replaced" is one
                designed to be agreed with rather than read.
              */}
              {preview.unknownBodies.length > 0 && (
                <p className="m-0 mt-2 text-sm text-[var(--color-semantic-warning)]">
                  {preview.unknownBodies.length} slot record
                  {preview.unknownBodies.length === 1 ? '' : 's'} name a body this system does not
                  have — check this is the right file.
                </p>
              )}

              {preview.slotsChanged.filter((c) => c.overwritesTyped).length > 0 && (
                <div className="mt-2 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)] px-3 py-2">
                  <p className="m-0 text-sm font-medium text-[var(--color-semantic-warning)]">
                    These were entered by hand and will be replaced.
                  </p>
                  <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--color-text-secondary)]">
                    {preview.slotsChanged
                      .filter((c) => c.overwritesTyped)
                      .map((c) => (
                        <li key={c.bodyName}>
                          <span className="text-[var(--color-text-primary)]">{c.bodyName}</span>:{' '}
                          {pair(c.from)} → {pair(c.to)}
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {preview.siteConflicts.map((clash) => (
                <p key={clash} className="m-0 mt-2 text-sm text-[var(--color-semantic-warning)]">
                  {clash}
                </p>
              ))}

              <ul className="m-0 mt-2 list-disc space-y-0.5 pl-5 text-sm text-[var(--color-text-secondary)]">
                {preview.slotsAdded.length > 0 && (
                  <li>
                    {preview.slotsAdded.length} bod
                    {preview.slotsAdded.length === 1 ? 'y' : 'ies'} will get slot counts for the
                    first time.
                  </li>
                )}
                {preview.slotsChanged.filter((c) => !c.overwritesTyped).length > 0 && (
                  <li>
                    {preview.slotsChanged.filter((c) => !c.overwritesTyped).length} previously
                    imported count
                    {preview.slotsChanged.filter((c) => !c.overwritesTyped).length === 1
                      ? ''
                      : 's'}{' '}
                    will be updated.
                  </li>
                )}
                {preview.sitesAdded > 0 && (
                  /*
                   * REPORTED, NOT APPLIED. The plan has its own ordering, its own primary and rows
                   * that have become real projects; writing somebody else's export over that is the
                   * silent replacement this whole flow avoids. A member can add them deliberately.
                   */
                  <li>
                    The file also lists {preview.sitesAdded} structure
                    {preview.sitesAdded === 1 ? '' : 's'} this plan does not have. Those are not
                    imported — add the ones you want yourself.
                  </li>
                )}
              </ul>

              {preview.problems.map((problem) => (
                <p key={problem} className="m-0 mt-1 text-xs text-[var(--color-text-dim)]">
                  {problem}
                </p>
              ))}
            </>
          )}

          {!preview.identical && canEdit && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={busy}
                className="rounded-md border border-[var(--color-border-active)] bg-[var(--color-surface-panel)] px-4 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)] disabled:opacity-50"
              >
                Import the slot counts
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                className="rounded-md border border-[var(--color-border-subtle)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}

          {!preview.identical && !canEdit && (
            // Said plainly rather than showing a button that would be refused by the hub anyway.
            <p className="m-0 mt-3 text-xs text-[var(--color-text-dim)]">
              This is not your plan to edit, so the import cannot be applied from here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
