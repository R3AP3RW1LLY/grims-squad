/**
 * Whether a promotion run should say anything to the admin channel.
 *
 * ★ WHY THIS IS A DECISION AND NOT JUST `if (post)` — 2026-08-11 ★
 *
 * It was `if (post)`, and that was correct while the run was monthly: twelve messages a year, each
 * one worth reading.
 *
 * The squadron owner moved it to daily — "promotes based on length of time and promotion
 * requirements ... instead of running this on the first of the month" — and the identical line
 * becomes 365 posts a year, nearly all of them "Nobody is eligible this run (18 considered)"
 * followed by eighteen lines of "0 of 1 qualifying months at Cadet". On the night the daily cron
 * was installed the next member was eighteen days away.
 *
 * The cost is not noise, it is a MUTED CHANNEL — and the message that gets missed is the promotion
 * announcement this feature exists to deliver.
 *
 * ★ THE SPLIT IS UNATTENDED vs ASKED-FOR, NOT LIVE vs DRY ★
 *
 * Silence is only safe where somebody is not waiting on an answer. Nobody passes `--post` to a
 * rehearsal by accident — that is a person asking to see the report, and answering them with
 * nothing is indistinguishable from the job being broken. So a dry run always posts, and only the
 * scheduled live run with genuinely nothing to report goes quiet.
 *
 * A failure always speaks. Discord refusing a role grant, or the tenure check finding no join date
 * on record — which says in as many words that "an officer can refresh the roster to fix this" —
 * is precisely the case where silence leaves somebody stuck at a rank with nobody told.
 */

export interface PostDecision {
  readonly post: boolean;
  /** Why, in a few words, for the console line that follows the decision. */
  readonly why: string;
}

export function worthPosting(run: {
  readonly live: boolean;
  readonly promoted: number;
  readonly failed: number;
}): PostDecision {
  if (!run.live) {
    return { post: true, why: 'a dry run posts because somebody asked for it' };
  }

  if (run.promoted > 0 && run.failed > 0) {
    return { post: true, why: `${run.promoted} promoted, ${run.failed} failed` };
  }
  if (run.promoted > 0) {
    return { post: true, why: `${run.promoted} promoted` };
  }
  if (run.failed > 0) {
    return { post: true, why: `${run.failed} failed — an officer needs to see this` };
  }

  return { post: false, why: 'nothing to report — nobody promoted, nothing failed' };
}
