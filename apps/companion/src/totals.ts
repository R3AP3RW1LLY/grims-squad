import type { CompanionTotals } from './config.js';
import type { WatchOutcome } from './watcher.js';

/**
 * The running tally of what this machine has contributed.
 *
 * ★ WHY THE APP SHOWED THREE ZEROES ★
 *
 * The panel reported the LAST PASS. The app polls every twenty seconds and the
 * game writes nothing during most of them, so the honest answer to "what did
 * that pass do" is almost always nothing — and a member glancing at
 * `0 / 0 / 0` concluded, entirely reasonably, that it was broken.
 *
 * These are cumulative and survive restarts, so they answer the question
 * somebody actually has: has this thing ever done anything for me.
 *
 * ★ SEPARATE FROM THE FILE IT IS STORED IN ★
 *
 * No Electron and no filesystem here, so the arithmetic can be tested with
 * plain objects — which matters more than it sounds, because a counter that
 * silently stops incrementing looks exactly like an app that has stopped
 * working.
 */
export function accumulate(
  totals: CompanionTotals,
  outcome: WatchOutcome,
  now: Date = new Date(),
): CompanionTotals {
  /*
   * ★ NOTHING HAPPENED IS NOT AN EVENT ★
   *
   * Returned unchanged when the pass did nothing, and the SAME OBJECT rather
   * than a copy. The caller saves the config only when it has changed — by
   * deep comparison — so returning a fresh equal object would still compare
   * equal, but returning one that differs by a stamped timestamp would rewrite
   * the config file every twenty seconds for the life of the process.
   */
  if (
    outcome.sent === 0 &&
    outcome.duplicates === 0 &&
    outcome.newFilesRead === 0 &&
    outcome.txBytes === 0 &&
    outcome.rxBytes === 0
  ) {
    return totals;
  }

  return {
    sent: totals.sent + outcome.sent,
    duplicates: totals.duplicates + outcome.duplicates,
    journalsRead: totals.journalsRead + outcome.newFilesRead,
    txBytes: totals.txBytes + outcome.txBytes,
    rxBytes: totals.rxBytes + outcome.rxBytes,
    /*
     * Stamped ONCE, on the first pass that did something.
     *
     * "Since" is the start of the record, so overwriting it every pass would
     * turn "sending since March" into "sending since a moment ago" — which is
     * the opposite of what a lifetime total is for.
     */
    since: totals.since ?? now.toISOString(),
  };
}
