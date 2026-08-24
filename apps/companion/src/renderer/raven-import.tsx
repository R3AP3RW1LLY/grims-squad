import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RavenPreview } from '@grims/shared/raven-preview';
import { Button, C, Card, Problem } from './ui.js';

/**
 * Importing a Raven Colonial export into a plan — the app's half of the pair.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "can we take this file ... and generate a new colonization plan", with the ruling on conflicts
 * being "Import wins, and say so" — and the standing rule that everything is in full parity on the
 * website and the companion app.
 *
 * ★ NOTHING IS DECIDED HERE ★
 *
 * The file goes up as text; the hub reads it and works out the difference with the same shared code
 * the website's route uses. This screen holds no rules about what an import means, which is what
 * stops the two surfaces telling a member two different things about one file.
 *
 * ★ AND NOTHING IS WRITTEN UNTIL THEY HAVE SEEN IT ★
 *
 * The worst outcome available here is silently replacing a plan somebody spent an evening on, and
 * every failure mode is quiet — the wrong file, an old export of a system since rebuilt. So the
 * preview comes first, losses first within it, and the apply is a separate press.
 */

const MONO = { fontFamily: 'var(--font-mono)' } as const;

const count = (n: number | null): string => (n === null ? '—' : String(n));
const pair = (v: { orbital: number | null; surface: number | null }): string =>
  `${count(v.orbital)} orbital, ${count(v.surface)} surface`;

export function RavenImport({
  planId,
  canEdit,
  onApplied,
}: {
  planId: string;
  canEdit: boolean;
  /** Re-read the plan: slot counts feed the tree, the summary and the checker. */
  onApplied: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState<RavenPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = (text: string): void => {
    setBusy(true);
    setError(null);
    setRaw(text);
    void window.colony.planImportPreview(planId, text).then((a) => {
      setBusy(false);
      if (a.ok) {
        setPreview(a.data.preview);
      } else {
        setPreview(null);
        setError(a.error);
      }
    });
  };

  const apply = (): void => {
    setBusy(true);
    setError(null);
    void window.colony.planImportApply(planId, raw).then((a) => {
      setBusy(false);
      if (a.ok) {
        setPreview(null);
        onApplied();
      } else {
        setError(a.error);
      }
    });
  };

  const typed = (preview?.slotsChanged ?? []).filter((c) => c.overwritesTyped);
  const reimported = (preview?.slotsChanged ?? []).filter((c) => !c.overwritesTyped);

  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
        <label
          style={{
            cursor: busy ? 'default' : 'pointer',
            border: `1px solid ${C.hairline}`,
            borderRadius: '4px',
            padding: '5px 10px',
            fontSize: '12px',
            color: C.text,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? 'Reading…' : 'Choose a Raven export'}
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={(e) => {
              const chosen = (e.currentTarget as HTMLInputElement).files?.[0];
              if (chosen === undefined) return;
              void chosen.text().then(read);
            }}
          />
        </label>
        <span style={{ fontSize: '11px', color: C.faint }}>
          Nothing changes until you have seen what it would do.
        </span>
      </div>

      {error === null ? null : (
        <div style={{ marginTop: '6px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      {preview === null ? null : (
        <Card>
          {preview.identical ? (
            <p style={{ margin: 0, fontSize: '12px', color: C.dim }}>
              This file matches the plan already — nothing would change.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {/*
                ★ LOSSES FIRST ★

                The same ordering the survey warnings and the plan checker use. A summary that leads
                with what is gained and buries "these you typed will be replaced" is one designed to
                be agreed with rather than read.
              */}
              {preview.unknownBodies.length === 0 ? null : (
                <p style={{ margin: 0, fontSize: '12px', color: C.warn }}>
                  {preview.unknownBodies.length} slot record
                  {preview.unknownBodies.length === 1 ? '' : 's'} name a body this system does not
                  have — check this is the right file.
                </p>
              )}

              {typed.length === 0 ? null : (
                <div>
                  <p style={{ margin: '0 0 3px', fontSize: '12px', color: C.warn }}>
                    These were entered by hand and will be replaced.
                  </p>
                  {typed.map((c) => (
                    <p
                      key={c.bodyName}
                      style={{ ...MONO, margin: 0, fontSize: '11px', color: C.dim }}
                    >
                      {c.bodyName}: {pair(c.from)} → {pair(c.to)}
                    </p>
                  ))}
                </div>
              )}

              {preview.siteConflicts.map((clash) => (
                <p key={clash} style={{ margin: 0, fontSize: '12px', color: C.warn }}>
                  {clash}
                </p>
              ))}

              {preview.slotsAdded.length === 0 ? null : (
                <p style={{ margin: 0, fontSize: '12px', color: C.dim }}>
                  {preview.slotsAdded.length} bod{preview.slotsAdded.length === 1 ? 'y' : 'ies'}{' '}
                  will get slot counts for the first time.
                </p>
              )}

              {reimported.length === 0 ? null : (
                <p style={{ margin: 0, fontSize: '12px', color: C.dim }}>
                  {reimported.length} previously imported count
                  {reimported.length === 1 ? '' : 's'} will be updated.
                </p>
              )}

              {preview.sitesAdded === 0 ? null : (
                /*
                 * Reported, not applied. The plan has its own ordering, its own primary and rows
                 * that have become real projects; writing somebody else's export over that is the
                 * silent replacement this flow exists to avoid.
                 */
                <p style={{ margin: 0, fontSize: '12px', color: C.dim }}>
                  The file also lists {preview.sitesAdded} structure
                  {preview.sitesAdded === 1 ? '' : 's'} this plan does not have. Those are not
                  imported — add the ones you want yourself.
                </p>
              )}

              {preview.problems.map((problem) => (
                <p key={problem} style={{ margin: 0, fontSize: '11px', color: C.faint }}>
                  {problem}
                </p>
              ))}
            </div>
          )}

          {preview.identical ? null : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              {canEdit ? (
                <>
                  <Button disabled={busy} onClick={apply}>
                    Import the slot counts
                  </Button>
                  <Button disabled={busy} onClick={() => setPreview(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                // Said plainly rather than offering a button the hub would refuse anyway.
                <p style={{ margin: 0, fontSize: '11px', color: C.faint }}>
                  This is not your plan to edit, so the import cannot be applied from here.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
