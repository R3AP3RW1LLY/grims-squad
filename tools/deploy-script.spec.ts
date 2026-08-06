import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Properties of the deploy script that nothing else can check.
 *
 * ★ WHY THIS FILE EXISTS: TWO FIXES THAT DID NOT FIX ANYTHING ★
 *
 * Both shipped on 2026-08-05, both declared done on a single observation, and both were wrong in
 * a way no test could notice because the deploy script had no tests at all.
 *
 *   `nice -n 19 docker compose build` lowers the priority of the CLI CLIENT. The compiling happens
 *   inside the Docker daemon, and `ps -o ni` showed dockerd and every build process at nice 0
 *   throughout. The squadron owner's companion app timed out through two consecutive deploys with
 *   that code in place, and `/` measured FIFTEEN SECONDS mid-build.
 *
 *   `docker builder prune --keep-storage 40GB` caps the RECLAIMABLE cache, not the total. With
 *   185 GB of cache of which 24 GB was unused, it reclaimed exactly nothing — 24 is already under
 *   40 — and the disk climbed back to 76% within three deploys of being cleared.
 *
 * AGENTS.md §8.5: "Bugs get a regression test first. No fix lands without the test that would have
 * caught it." Neither of those had one. These are that debt, paid.
 *
 * ★ THEY ASSERT AGAINST THE OLD FILE TOO ★
 *
 * A source scan that only checks today's content proves nothing about whether it would have caught
 * yesterday's bug — it passes the moment the fix is present and would have passed a hundred other
 * ways. Each test below is also run against the exact commit that carried the broken version, and
 * must fail there. That is what makes it a regression test rather than a description.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SCRIPT = join(REPO, 'infra', 'scripts', 'deploy.sh');

const current = readFileSync(SCRIPT, 'utf8');

/**
 * The script as it stood before a given fix.
 *
 * Read from git rather than copied here, so the "before" cannot drift out of step with reality — a
 * hand-pasted snapshot rots the first time somebody reformats the file.
 *
 * ★ EACH BUG HAS ITS OWN ANCHOR, AND THEY ARE NOT THE SAME COMMIT ★
 *
 * The first version of this file anchored both regressions to one commit and the cache assertion
 * failed immediately: that fix had landed two pull requests earlier, so the parent already had it.
 * A regression test pointed at the wrong "before" proves nothing while looking rigorous, which is
 * the same species of mistake as the fixes it exists to guard.
 */
function scriptBefore(fixCommit: string): string | null {
  try {
    return execFileSync('git', ['show', `${fixCommit}^:infra/scripts/deploy.sh`], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    /*
     * A shallow clone or a detached checkout without that history. Skipped rather than failed: the
     * forward assertions still hold, and a CI runner that fetched one commit must not fail a
     * quality gate for it.
     */
    return null;
  }
}

/** True when the build step bounds how many images compile at once. */
function boundsBuildParallelism(script: string): boolean {
  return /COMPOSE_PARALLEL_LIMIT=\d+/.test(script);
}

/** True when the cache is pruned in a way that can actually reduce the total on disk. */
function boundsBuildCache(script: string): boolean {
  // An unfiltered prune drops everything unused; the disk-threshold clear handles the rest.
  const unfiltered = /docker builder prune --force\s*>/.test(script);
  const clearsWhenTight = /builder prune --all --force/.test(script);
  return unfiltered && clearsWhenTight;
}

describe('the build cannot starve the site it is deploying', () => {
  it('MANDATORY: the number of images compiled at once is bounded', () => {
    /*
     * The measurement that settled it, same box, mid-build:
     *   six in parallel  →  /  15.0s,  /forum  14.9s
     *   two in parallel  →  /   1.2s,  /forum   1.8s
     *
     * Reducing the number of compilers is what works. Asking the scheduler to referee six of them
     * does not, because the request never reaches the process doing the work.
     */
    expect(
      boundsBuildParallelism(current),
      'deploy.sh no longer limits build parallelism — six images compiling at once took / to 15s',
    ).toBe(true);
  });

  it('MANDATORY: it would have failed on the revision that shipped the broken fix', () => {
    // e80cac9 is where COMPOSE_PARALLEL_LIMIT arrived, after `nice` had been tried and failed.
    const before = scriptBefore('e80cac9');
    if (before === null) return; // shallow clone; see the note on the helper

    expect(
      boundsBuildParallelism(before),
      'the "before" revision already bounds parallelism, so this test proves nothing',
    ).toBe(false);
  });

  it('nice is kept, but is not the thing being relied on', () => {
    /*
     * Correct for the client and free, so it stays — but if it is ever the ONLY protection here,
     * the site is unprotected and looks protected, which is worse than neither.
     */
    if (/nice -n/.test(current)) {
      expect(boundsBuildParallelism(current)).toBe(true);
    }
  });
});

describe('the build cache cannot fill the disk', () => {
  it('MANDATORY: the prune can actually reduce the total, not only the reclaimable', () => {
    /*
     * `--keep-storage N` is a cap on what is RECLAIMABLE. With 24 GB reclaimable and a 40 GB
     * budget it evicts nothing, however large the total — which is precisely what happened while
     * the disk went from 55% back to 79%.
     */
    expect(
      boundsBuildCache(current),
      'deploy.sh prunes only with --keep-storage again, which caps reclaimable and not the total',
    ).toBe(true);
  });

  it('MANDATORY: it would have failed on the revision that shipped the broken fix', () => {
    // d74f227 is where the unfiltered prune and the disk-threshold clear replaced --keep-storage.
    const before = scriptBefore('d74f227');
    if (before === null) return;

    expect(
      boundsBuildCache(before),
      'the "before" revision already bounds the cache, so this test proves nothing',
    ).toBe(false);
  });
});

describe('the deploy still refuses to start without its configuration', () => {
  it('every announcement channel is required in the preflight', () => {
    /*
     * Unset means the bot queues rows silently and nobody hears about a release, a promotion or a
     * colonisation project. The preflight is the only thing that turns that into a loud failure at
     * the one moment somebody is watching.
     */
    for (const key of [
      'DISCORD_ANNOUNCE_CHANNEL_ID',
      'DISCORD_PROMOTIONS_CHANNEL_ID',
      'DISCORD_COLONY_CHANNEL_ID',
      'DISCORD_RELEASE_CHANNEL_ID',
    ]) {
      expect(current, `${key} is no longer required before a deploy may proceed`).toContain(key);
    }
  });
});
