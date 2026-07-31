'use client';

import { useEffect, useState } from 'react';
import { etaSeconds, ingestFraction } from '@grims/shared/ai-knowledge';

/**
 * A live bar and countdown for an ingest that is running right now.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "anything that is showing in progress can we show a real time progress bar with a countdown timer
 * so we know how long it will run for? at least an estimate that adjusts as it goes so its always
 * showing an accurate time."
 *
 * ★ TWO CLOCKS, AND ONLY ONE OF THEM TALKS TO THE SERVER ★
 *
 * The page refreshes every thirty seconds, which is often enough for the ROW COUNT — it moves in
 * hundred-thousand steps anyway. It is nowhere near often enough for a countdown: a timer that sits
 * still for thirty seconds and then jumps looks broken, and a countdown is the one thing on a page
 * a person watches continuously.
 *
 * So the row count comes from the server and the elapsed time is counted HERE, once a second,
 * against the start timestamp the server sent. Between refreshes the estimate keeps improving on
 * its own, because elapsed keeps growing while rows do not — which makes a stalling import visibly
 * slow down rather than silently promise the same four minutes for ever.
 */

export function IngestProgress({
  startedAt,
  rowsSoFar,
  expectedRows,
}: {
  readonly startedAt: string | null;
  readonly rowsSoFar: number | null;
  readonly expectedRows: number | null;
}) {
  /*
   * `now` is state rather than a plain Date so the component re-renders each second. Started as
   * null and set in the effect: rendering `new Date()` during the server pass and again on the
   * client produces two different values and a hydration mismatch.
   */
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (startedAt === null) return null;

  const started = new Date(startedAt);
  const fraction = ingestFraction(rowsSoFar, expectedRows);
  const eta =
    now === null ? null : etaSeconds({ startedAt: started, rowsSoFar, expectedRows, now });
  const elapsed = now === null ? 0 : Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));

  return (
    <div className="mt-2">
      <div
        role="progressbar"
        aria-valuenow={rowsSoFar ?? 0}
        aria-valuemin={0}
        aria-valuemax={expectedRows ?? 0}
        aria-label="Ingest progress"
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-panel-sunken)]"
      >
        <div
          className={`h-full rounded-full bg-[var(--color-brand-cyan-bright)] ${
            /*
             * Indeterminate when there is no previous total to measure against — a first run, or a
             * source that has never completed. A bar pinned at zero would read as "stuck"; a
             * pulsing full-width one reads as "working, length unknown", which is the truth.
             */
            fraction === null ? 'animate-pulse' : 'transition-[width] duration-1000'
          }`}
          style={{ width: fraction === null ? '100%' : `${Math.round(fraction * 100)}%` }}
        />
      </div>

      <p className="mt-1 font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
        {rowsSoFar !== null && expectedRows !== null
          ? `${rowsSoFar.toLocaleString()} of ~${expectedRows.toLocaleString()} · `
          : rowsSoFar !== null
            ? `${rowsSoFar.toLocaleString()} rows · `
            : ''}
        {formatDuration(elapsed)} elapsed
        {/*
          The estimate, when there is one. "Estimating" rather than a placeholder number: the first
          few seconds of a run genuinely cannot produce a rate, and a made-up figure gets believed.
        */}
        {eta === null ? ' · estimating…' : ` · about ${formatDuration(eta)} left`}
      </p>
    </div>
  );
}

/** `3725` -> `1h 2m`. Seconds are dropped past a minute: nobody counts them down from an hour. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
