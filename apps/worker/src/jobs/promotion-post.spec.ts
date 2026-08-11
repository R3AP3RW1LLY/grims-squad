import { describe, expect, it } from 'vitest';
import { worthPosting } from './promotion-post.js';

/**
 * Whether an unattended promotion run should say anything to the admin channel.
 *
 * ★ WHY THIS APPEARED THE DAY THE CADENCE CHANGED — 2026-08-11 ★
 *
 * `--post` used to be unconditional, and that was right when the run was monthly: twelve messages
 * a year, each one worth reading.
 *
 * The squadron owner moved it to daily — "promotes based on length of time and promotion
 * requirements ... instead of running this on the first of the month" — and the same unconditional
 * post becomes 365 messages a year, of which the overwhelming majority say "Nobody is eligible this
 * run (18 considered)" followed by eighteen lines of "0 of 1 qualifying months at Cadet".
 *
 * On the night this shipped, the next member does not come eligible for eighteen days. That is
 * eighteen consecutive nightly reports saying nothing, into the channel where the ACTUAL promotion
 * announcement is going to appear on the nineteenth.
 *
 * The failure mode is not noise. It is a muted channel — the same reasoning probe-run.sh already
 * carries about alerting — and a muted channel misses the message this whole feature exists to
 * deliver.
 */

describe('an unattended nightly run', () => {
  it('★ MANDATORY: stays silent when nobody was promoted and nothing failed ★', () => {
    /*
     * The eighteen-nights-of-nothing case. The run still logs to /var/log/grims-promote.log and
     * still exits zero, so "did it run" remains answerable — it simply does not interrupt anybody
     * to say so.
     */
    const out = worthPosting({ live: true, promoted: 0, failed: 0 });
    expect(out.post).toBe(false);
    expect(out.why).toMatch(/nothing/i);
  });

  it('★ MANDATORY: speaks the moment somebody is actually promoted ★', () => {
    expect(worthPosting({ live: true, promoted: 1, failed: 0 }).post).toBe(true);
  });

  it('★ MANDATORY: speaks when a promotion FAILED, which is the case an officer must act on ★', () => {
    /*
     * Discord refusing a role grant, or a member with no join date on record — the tenure check
     * says in as many words that "an officer can refresh the roster to fix this". Swallowing that
     * would leave somebody stuck at a rank indefinitely with nobody told.
     */
    const out = worthPosting({ live: true, promoted: 0, failed: 1 });
    expect(out.post).toBe(true);
    expect(out.why).toMatch(/fail/i);
  });

  it('MANDATORY: a promotion AND a failure in one run still speaks', () => {
    expect(worthPosting({ live: true, promoted: 2, failed: 1 }).post).toBe(true);
  });
});

describe('a run somebody asked for by hand', () => {
  it('★ MANDATORY: a dry run with --post ALWAYS posts, even with no news ★', () => {
    /*
     * The distinction that makes this safe to change. Nobody passes --post to a rehearsal by
     * accident: it is a person asking to see the report in Discord, and answering them with silence
     * would look exactly like the job being broken.
     *
     * Only the unattended path — live, on a schedule, with nothing to say — goes quiet.
     */
    const out = worthPosting({ live: false, promoted: 0, failed: 0 });
    expect(out.post).toBe(true);
    expect(out.why).toMatch(/asked|rehearsal|dry/i);
  });

  it('MANDATORY: a dry run that would promote somebody posts too', () => {
    expect(worthPosting({ live: false, promoted: 3, failed: 0 }).post).toBe(true);
  });
});
