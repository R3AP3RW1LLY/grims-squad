'use client';

import { useState } from 'react';
import {
  diffSnapshot,
  signedChange,
  snapshotAge,
  takeSnapshot,
  type Snapshot,
} from '@grims/shared/colony-snapshot';
import { EFFECT_LABELS, type SystemSummary } from '@grims/shared/colony-system-summary';

/**
 * Freeze the system, change it, see what that did.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Use the camera to snapshot panels. This allows for easily comparing differences whilst making
 * changes to your system."
 *
 * The summary above answers "what is this system". It cannot answer "was that an improvement",
 * because by the time the new number is on screen the old one is gone — a member swapping a refinery
 * for a starport has to write the seven figures on paper first.
 *
 * ★ NOT PERSISTED, DELIBERATELY ★
 *
 * A snapshot is scaffolding for one editing session: "before I started fiddling". Storing it would
 * make it a thing to manage — stale snapshots, whose snapshot, which one is current. It lives for as
 * long as the page does, and taking another replaces it.
 */

const signedTonnes = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-GB')} t`;

export function SnapshotCompare({ summary }: { summary: SystemSummary }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  if (snap === null) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setSnap(takeSnapshot(summary, Date.now()))}
          className="rounded border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]"
        >
          Snapshot this system
        </button>
        <span className="text-[11px] text-[var(--color-text-dim)]">
          Freeze these figures, then change the plan and see exactly what moved.
        </span>
      </div>
    );
  }

  const diff = diffSnapshot(snap, summary);
  const age = snapshotAge(snap.takenAt, Date.now());

  return (
    <div className="mt-2 rounded border border-[var(--color-border-subtle)] px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
          Against the snapshot · {age}
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={() => setSnap(takeSnapshot(summary, Date.now()))}
            className="rounded border border-[var(--color-border-subtle)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]"
          >
            Re-take
          </button>
          <button
            type="button"
            onClick={() => setSnap(null)}
            className="rounded border border-[var(--color-border-subtle)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]"
          >
            Discard
          </button>
        </span>
      </div>

      {/*
        ★ SAID IN WORDS, NOT AS AN EMPTY TABLE ★

        A diff table with no rows and a diff table nobody generated look identical on screen, and
        only one of them means anything.
      */}
      {diff.identical ? (
        <p className="m-0 mt-1 text-xs text-[var(--color-text-secondary)]">
          Nothing has changed since the snapshot.
        </p>
      ) : (
        <div className="mt-1 flex flex-col gap-0.5">
          {diff.score.change === 0 ? null : (
            <Row label="Score" before={String(diff.score.before)} now={String(diff.score.now)} change={signedChange(diff.score.change)} good={diff.score.change > 0} />
          )}
          {diff.counted.change === 0 ? null : (
            <Row label="Builds" before={String(diff.counted.before)} now={String(diff.counted.now)} change={signedChange(diff.counted.change)} good={null} />
          )}
          {diff.outstandingTonnes.change === 0 ? null : (
            /*
             * MORE tonnage is not "bad" — it is usually a bigger system on purpose. Left uncoloured
             * rather than red, because colouring it would editorialise about a decision the member
             * has just made deliberately.
             */
            <Row
              label="To haul"
              before={`${diff.outstandingTonnes.before.toLocaleString('en-GB')} t`}
              now={`${diff.outstandingTonnes.now.toLocaleString('en-GB')} t`}
              change={signedTonnes(diff.outstandingTonnes.change)}
              good={null}
            />
          )}
          {diff.moved.map((m) => (
            <Row
              key={m.key}
              label={EFFECT_LABELS[m.key]}
              before={String(m.before)}
              now={String(m.now)}
              change={signedChange(m.change)}
              good={m.change > 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  before,
  now,
  change,
  good,
}: {
  label: string;
  before: string;
  now: string;
  change: string;
  /** Null when up is not better — tonnage is more work, not a worse system. */
  good: boolean | null;
}) {
  return (
    <div className="grid grid-cols-[9rem_4.5rem_4.5rem_4.5rem] items-baseline gap-2 font-mono text-[11px]">
      <span className="text-[var(--color-text-dim)]">{label}</span>
      <span className="text-right tabular-nums text-[var(--color-text-dim)]">{before}</span>
      <span className="text-right tabular-nums text-[var(--color-text-primary)]">{now}</span>
      <span
        className={`text-right tabular-nums ${
          good === null
            ? 'text-[var(--color-text-secondary)]'
            : good
              ? 'text-[var(--color-semantic-success)]'
              : 'text-[var(--color-semantic-warning)]'
        }`}
      >
        {change}
      </span>
    </div>
  );
}
