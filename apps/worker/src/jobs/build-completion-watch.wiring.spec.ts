import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The twenty-minute safeguard's plumbing.
 *
 * The DECISION is `completedBuilds` in @grims/shared, with eleven tests and no database. What is
 * left here is SQL, and what goes wrong in SQL is a query that runs perfectly and answers the wrong
 * question. Each assertion below names one of those, and every one would close a live build.
 */

const SRC = readFileSync(join(process.cwd(), 'src/jobs/build-completion-watch.wiring.ts'), 'utf8');
const DAEMON = readFileSync(join(process.cwd(), 'src/daemon.ts'), 'utf8');

describe('what the sweep looks at', () => {
  it('★ MANDATORY: an unread depot does NOT look satisfied ★', () => {
    /*
     * A project whose needs have never been read sums to NULL. Coalescing that to zero would make
     * every project nobody has docked at look finished, and the first sweep would close the lot.
     * The default is deliberately 1 — positive, so it fails the "wants nothing" test.
     */
    expect(SRC).toContain('COALESCE((SELECT SUM(n.remaining)');
    expect(SRC).toMatch(/COALESCE\(\(SELECT SUM\(n\.remaining\)[^)]*\)[^,]*,\s*1\)/s);
  });

  it('★ MANDATORY: abandoned builds are left alone ★', () => {
    // An officer gave up on it. Auto-closing it as COMPLETE would overwrite that judgement with the
    // opposite one, and re-announce it to the squadron as finished.
    expect(SRC).toContain('p.abandoned_at IS NULL');
  });

  it('★ MANDATORY: only the NEWEST sighting per market is used ★', () => {
    // A site docked at fifty times must not hand fifty rows to a decision that needs the latest one
    // — and an old depot sighting must not outvote today's starport.
    expect(SRC).toContain('DISTINCT ON');
    expect(SRC).toMatch(/ORDER BY t\.payload->>'MarketID', t\.occurred_at DESC/);
  });
});

describe('closing', () => {
  it('★ MANDATORY: the close is conditional, so only one caller announces it ★', () => {
    /*
     * The manual close route, the depot sync and this sweep can all reach the same project. Without
     * `AND completed_at IS NULL` two of them would each believe they closed it, and the squadron
     * would read the completion twice.
     */
    expect(SRC).toContain('WHERE id = $1::uuid AND completed_at IS NULL');
  });

  it('★ MANDATORY: it records WHY, so an officer can check it', () => {
    // "Closed because a Coriolis Starport was seen at this market id" is auditable. "The job decided"
    // is not, and this closes builds nobody asked it to.
    expect(SRC).toContain('colony.project.auto-close');
    expect(SRC).toContain('capi-journal');
  });
});

describe('the cadence', () => {
  it('★ MANDATORY: it AUTO-SCALES, and is not a fixed interval ★', () => {
    /*
     * ★ SQUADRON OWNER, 2026-08-16 ★
     *
     * "we didnt want a 20 minute cadence for capi we wanted auto scaling fast if active slow if now!"
     *
     * A fixed interval is wrong in both directions at once: too slow while members are hauling to a
     * site, and a pointless query for ever while nothing is happening. It uses the same `nextPoll`
     * the journal poller does, so there is ONE idea of "how active is this" in the codebase.
     */
    expect(DAEMON).toContain('nextPoll(poll,');
    expect(DAEMON, 'a fixed interval would be exactly what was rejected').not.toContain(
      'BUILD_WATCH_MS',
    );
  });

  it('★ MANDATORY: re-armed with setTimeout, or the interval cannot change ★', () => {
    // `setInterval` fixes the delay at the value it was created with, so an adaptive number would be
    // computed every pass and ignored every pass — decorative rather than adaptive.
    const fn = DAEMON.slice(DAEMON.indexOf('function startBuildCompletionWatch'));
    const body = fn.slice(0, fn.indexOf('function startStationResolver'));

    expect(body).toContain('setTimeout(() => void run(), poll.intervalMs)');
    expect(body).not.toContain('setInterval');
  });

  it('★ MANDATORY: re-reading the SAME old sighting does not count as activity ★', () => {
    // Otherwise a site that was docked at once last week would hold the watch at the fast cadence
    // for ever, which is the "slow if not" half of the instruction failing silently.
    expect(DAEMON).toContain('lastSighting === null || report.newestSightingAt > lastSighting');
  });

  it('★ MANDATORY: it is actually started ★', () => {
    // A job defined and never called is the exact shape of the poller that shipped inert.
    expect(DAEMON).toContain('startBuildCompletionWatch(db);');
  });
});
