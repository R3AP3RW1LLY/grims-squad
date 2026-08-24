import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  diffSnapshot,
  signedChange,
  snapshotAge,
  takeSnapshot,
  type Snapshot,
} from '@grims/shared/colony-snapshot';
import { EFFECT_LABELS, type SystemSummary } from '@grims/shared/colony-system-summary';
import { Button, C } from './ui.js';

/**
 * Freeze the system, change it, see what that did — the app's half of the pair.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Use the camera to snapshot panels" — and "we need all of this in full parity on the website and
 * the companion app".
 *
 * Every rule and every word comes from @grims/shared, so the two surfaces cannot disagree about what
 * changed or how it is phrased. Only the chrome differs.
 *
 * Not persisted, deliberately: a snapshot is scaffolding for one editing session, and storing it
 * would make it a thing to manage.
 */

const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' } as const;

const signedTonnes = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-GB')} t`;

export function SnapshotCompare({ summary }: { summary: SystemSummary }): JSX.Element {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  if (snap === null) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
        <Button onClick={() => setSnap(takeSnapshot(summary, Date.now()))}>Snapshot this system</Button>
        <span style={{ fontSize: '11px', color: C.faint }}>
          Freeze these figures, then change the plan and see exactly what moved.
        </span>
      </div>
    );
  }

  const diff = diffSnapshot(snap, summary);
  const age = snapshotAge(snap.takenAt, Date.now());

  const row = (
    label: string,
    before: string,
    now: string,
    change: string,
    good: boolean | null,
  ): JSX.Element => (
    <div
      key={label}
      style={{ ...MONO, display: 'grid', gridTemplateColumns: '116px 62px 62px 62px', gap: '6px', fontSize: '11px' }}
    >
      <span style={{ color: C.faint }}>{label}</span>
      <span style={{ textAlign: 'right', color: C.faint }}>{before}</span>
      <span style={{ textAlign: 'right', color: C.text }}>{now}</span>
      <span style={{ textAlign: 'right', color: good === null ? C.dim : good ? C.good : C.warn }}>
        {change}
      </span>
    </div>
  );

  return (
    <div style={{ marginTop: '8px', border: `1px solid ${C.hairline}`, borderRadius: '4px', padding: '7px 9px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ ...MONO, fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.faint }}>
          Against the snapshot · {age}
        </span>
        <span style={{ display: 'flex', gap: '6px' }}>
          <Button onClick={() => setSnap(takeSnapshot(summary, Date.now()))}>Re-take</Button>
          <Button onClick={() => setSnap(null)}>Discard</Button>
        </span>
      </div>

      {/* Said in words: an empty diff table and one nobody generated look the same on screen. */}
      {diff.identical ? (
        <p style={{ margin: '5px 0 0', fontSize: '12px', color: C.dim }}>
          Nothing has changed since the snapshot.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '5px' }}>
          {diff.score.change === 0
            ? null
            : row('Score', String(diff.score.before), String(diff.score.now), signedChange(diff.score.change), diff.score.change > 0)}
          {diff.counted.change === 0
            ? null
            : row('Builds', String(diff.counted.before), String(diff.counted.now), signedChange(diff.counted.change), null)}
          {diff.outstandingTonnes.change === 0
            ? null
            : /*
               * MORE tonnage is not "bad" — it is usually a bigger system on purpose. Left
               * uncoloured rather than red: colouring it would editorialise about a decision the
               * member has just made deliberately.
               */
              row(
                'To haul',
                `${diff.outstandingTonnes.before.toLocaleString('en-GB')} t`,
                `${diff.outstandingTonnes.now.toLocaleString('en-GB')} t`,
                signedTonnes(diff.outstandingTonnes.change),
                null,
              )}
          {diff.moved.map((m) =>
            row(EFFECT_LABELS[m.key], String(m.before), String(m.now), signedChange(m.change), m.change > 0),
          )}
        </div>
      )}
    </div>
  );
}
