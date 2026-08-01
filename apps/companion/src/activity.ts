import type { WatchOutcome } from './watcher.js';

/**
 * A live record of what this app is actually doing.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "it should ... show the information we used to display that shows the bandwidth journal entries
 * sent what is being sent, like a real time log of activity etc thats being streamed"
 *
 * ★ WHY THE APP NEEDED THIS AT ALL ★
 *
 * It reported four lifetime totals and two live rates, and every one of them was a NUMBER. A member
 * watching "Events sent: 4,182" tick to 4,190 learns that something happened and nothing about
 * what. The single most common question about a background agent is "is this thing working right
 * now", and a counter answers it only if you were already watching.
 *
 * A log answers it at a glance, and it answers the second question too — what did it just send —
 * which no total ever can.
 *
 * ★ WHAT IS DELIBERATELY NOT LOGGED ★
 *
 * The watcher runs every twenty seconds and Elite writes nothing during most of them. A line per
 * pass would be three an hour that matter and a hundred and seventy that say "nothing new" — and
 * the useful ones would scroll away inside a minute.
 *
 * So a quiet pass produces NOTHING. The log only ever contains things that happened, which is what
 * makes a glance at it meaningful rather than a wall to be read.
 */

export type ActivityLevel = 'info' | 'warn' | 'error';

export interface ActivityLine {
  /** Epoch millis, stamped when the line was made. Rendered in the member's own locale. */
  readonly at: number;
  readonly level: ActivityLevel;
  readonly text: string;
}

/**
 * How many lines to keep.
 *
 * Enough to cover an evening's play, small enough that the buffer is never a memory question in a
 * process that runs for weeks. Oldest are dropped first.
 */
export const ACTIVITY_MAX = 200;

/** `1234` -> `1,234`. Raw digits in a log line are harder to read than they look. */
function num(n: number): string {
  return n.toLocaleString();
}

/** Bytes as people say them: binary divisor, one decimal below ten units. */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/**
 * Turns one pass into the lines worth showing. Empty for a pass that did nothing.
 *
 * Pure, so the "what is worth saying" rule can be tested without a journal, a clock or a window —
 * and that rule is the entire feature. A version of this that logged every pass would still look
 * correct in a screenshot and be useless in practice.
 */
export function linesFor(outcome: WatchOutcome, at: number): ActivityLine[] {
  const lines: ActivityLine[] = [];
  const add = (level: ActivityLevel, text: string): void => {
    lines.push({ at, level, text });
  };

  /*
   * Failures first, because they are the reason somebody opened this panel. A pass can both send
   * and fail — a partial upload — and burying the error under the success would be the wrong way
   * round.
   */
  if (outcome.unauthorised) {
    add('error', 'This device is no longer connected. Sign in again to reconnect it.');
  } else if (outcome.error !== null) {
    add('error', `Could not reach the squadron: ${outcome.error}`);
  }

  if (outcome.sent > 0) {
    const from =
      outcome.filesRead > 1 ? ` from ${num(outcome.filesRead)} journals` : ' from your journal';
    // The transfer size rides on the same line rather than its own: it is a property of the
    // send, and a separate "moved 4.2 KB" line beneath it would double the log for no new fact.
    const moved = outcome.txBytes > 0 ? ` · ${bytes(outcome.txBytes)} sent` : '';
    add('info', `${num(outcome.sent)} events${from}${moved}`);
  }

  /*
   * Duplicates are reported only when nothing new went with them.
   *
   * Alongside a real send they are noise — the app re-reads the tail of a growing file every pass,
   * so a handful of already-seen events is the normal, healthy case. On their own they answer the
   * question "why is the counter not moving", which is worth a line.
   */
  if (outcome.duplicates > 0 && outcome.sent === 0) {
    add('info', `${num(outcome.duplicates)} events the squadron already had`);
  }

  const refused = Object.entries(outcome.refused);
  if (refused.length > 0) {
    add(
      'warn',
      `Discarded, because you switched these off: ${refused
        .map(([category, n]) => `${category} (${num(n)})`)
        .join(', ')}`,
    );
  }

  /*
   * A journal seen for the first time. Only NEW ones: the current file is read on every pass as
   * the game appends to it, and reporting that each time would say "journal read" every twenty
   * seconds for a whole session.
   */
  if (outcome.newFilesRead > 0 && outcome.sent === 0) {
    add('info', `${num(outcome.newFilesRead)} new journal${outcome.newFilesRead === 1 ? '' : 's'} picked up`);
  }

  return lines;
}

/**
 * Whether a game-state change is worth a line.
 *
 * Reported on the TRANSITION only. `gameRunning` is a boolean on every pass, so logging its value
 * would produce three lines a minute for the whole time somebody is playing.
 */
export function gameLine(was: boolean, now: boolean, at: number): ActivityLine | null {
  if (was === now) return null;
  return {
    at,
    level: 'info',
    text: now ? 'Elite Dangerous is running — watching for new entries' : 'Elite Dangerous closed',
  };
}

/** Appends and trims. Oldest out first. */
export function append(
  log: readonly ActivityLine[],
  incoming: readonly ActivityLine[],
): ActivityLine[] {
  if (incoming.length === 0) return log as ActivityLine[];
  return [...log, ...incoming].slice(-ACTIVITY_MAX);
}
