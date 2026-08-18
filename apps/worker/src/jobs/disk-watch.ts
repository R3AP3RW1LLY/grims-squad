/**
 * Telling somebody the disk is running out, before a deploy finds out for them.
 *
 * ★ SQUADRON OWNER, 2026-08-18 ★
 *
 * "can we add this to our AI pipeline so it prunes daily or when the alarm goes off or when storage
 * is limited and a clean up is required?"
 *
 * ★ THE FAILURE THIS EXISTS FOR ★
 *
 * The ingestion box reached ZERO BYTES free. The nightly janitor had run, had cleaned everything
 * its windows allowed, had noticed it was still tight, and had printed:
 *
 *   ✖ Only 8G free after cleanup — something else is growing.
 *
 * Into a log file. On a box with no operator. So the first anybody knew was a deploy dying on "no
 * space left on device" and rolling itself back.
 *
 * The janitor now escalates and clears the space itself, which handles the ordinary case. This
 * handles the case where it CANNOT — where escalation threw away every image it was allowed to and
 * the disk is still full, meaning nothing Docker owns is the cause and a person is genuinely needed.
 *
 * ★ WHY THE INTERESTING PART IS NOT ANNOUNCING ★
 *
 * It is announcing ONCE. A job that posts "the disk is low" every six hours for a week trains
 * everybody to scroll past it, and the notice that matters arrives in a stream of identical ones
 * nobody reads — which is the same failure as the log file, wearing a different hat.
 *
 * So the decision below is a state machine over one stored fact, and every rule in it is about
 * saying less.
 */

/** What the watcher knows when it decides. */
export interface DiskReading {
  readonly freeGb: number;
  /** Below this, somebody should know. Above it, the box is fine. */
  readonly comfortableGb: number;
  /** Where this reading came from, for the message. */
  readonly host: string;
}

/** What it said last time, so it can avoid saying it again. */
export interface DiskMemory {
  /** True while an unresolved alarm is outstanding. */
  readonly alarming: boolean;
  /** When the last message about this host went out. */
  readonly announcedAt: string | null;
}

export const NO_MEMORY: DiskMemory = { alarming: false, announcedAt: null };

/**
 * How long before an unresolved alarm is repeated.
 *
 * A day. Long enough that a problem somebody is already working on does not shout at them hourly;
 * short enough that one forgotten over a weekend gets raised again on the Monday.
 */
export const REPEAT_AFTER_HOURS = 24;

export type DiskAction =
  /** Say nothing. The overwhelmingly common outcome, and the point of the whole file. */
  | { readonly kind: 'quiet'; readonly memory: DiskMemory }
  /** First time below the line, or a day since the last unheeded one. */
  | { readonly kind: 'alarm'; readonly memory: DiskMemory; readonly message: string }
  /** It came back. Said once, because "never mind" is worth exactly one message. */
  | { readonly kind: 'recovered'; readonly memory: DiskMemory; readonly message: string };

/**
 * Whether to say anything, and what.
 *
 * Pure: `now` is a parameter, so every branch is reachable from a test — including the two that
 * decide to stay silent, which are the ones worth being sure about.
 */
export function judgeDisk(reading: DiskReading, memory: DiskMemory, now: Date): DiskAction {
  const low = reading.freeGb < reading.comfortableGb;

  if (!low) {
    /*
     * Healthy. If an alarm was outstanding, say so once and clear it — a squadron that was told the
     * disk was full deserves to be told it is not, and without that the next alarm reads as the
     * same unresolved one still going.
     */
    if (!memory.alarming) return { kind: 'quiet', memory: NO_MEMORY };

    return {
      kind: 'recovered',
      memory: NO_MEMORY,
      message:
        `**Disk recovered on ${reading.host}** — ${reading.freeGb}G free, back above the ` +
        `${reading.comfortableGb}G mark. No action needed.`,
    };
  }

  /*
   * Low, and we have already said so. Silence until the repeat window, because the useful message
   * was the first one and every copy after it makes the first easier to ignore.
   */
  if (memory.alarming && memory.announcedAt !== null) {
    const since = now.getTime() - new Date(memory.announcedAt).getTime();
    if (since < REPEAT_AFTER_HOURS * 3_600_000) return { kind: 'quiet', memory };
  }

  return {
    kind: 'alarm',
    memory: { alarming: true, announcedAt: now.toISOString() },
    message:
      `**Disk is low on ${reading.host}** — ${reading.freeGb}G free, below the ` +
      `${reading.comfortableGb}G mark.\n\n` +
      'The nightly janitor has already cleared every image and build layer it is allowed to, so ' +
      'this is not old Docker images — something else is growing. Deploys will start failing on ' +
      '"no space left on device" before long.\n\n' +
      'Check: `docker system df`, `du -sh /var/lib/docker/*`, and the database size.',
  };
}
