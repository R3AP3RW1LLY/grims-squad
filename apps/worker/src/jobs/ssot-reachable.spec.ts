import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { readLadderFromSsot } from './promotion-run.wiring.js';

/**
 * Can the promotion run find the ladder?
 *
 * ★ IT COULD NOT, IN THE ONLY PLACE THAT MATTERS ★
 *
 * `promote.ts` resolved the repo root as `resolve(process.cwd(), '../..')`,
 * which is right when started from `apps/worker` — what `pnpm promote` does —
 * and wrong in the production image, which runs `node apps/worker/dist/promote.js`
 * from `/app`. It resolved to `/` and the job died on
 * `ENOENT /ssot/02-domain/rank-progression.yaml`.
 *
 * Every unit test passed. It would have failed at midnight on 1 August 2026, on
 * the single run the whole feature exists for, and the only trace would have
 * been a line in cron's mail.
 */

/** The same walk `promote.ts` does. Kept in step by the test below. */
function findRepoRoot(from: string): string | null {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, 'ssot', '02-domain', 'rank-progression.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

describe('finding the ladder', () => {
  it('MANDATORY: finds it from a DEEP directory, as the container does', () => {
    /*
     * The container runs from the repo root; `pnpm promote` runs from
     * apps/worker. Walking up satisfies both, and any layout somebody invents
     * later — it asks where the file is instead of assuming a depth.
     */
    const fromDeep = findRepoRoot(resolve(process.cwd(), 'src/jobs'));
    expect(fromDeep).not.toBeNull();
  });

  it('MANDATORY: finds it from the repo root itself', () => {
    // The case that broke: cwd IS the root, and `../..` walks off the top.
    const root = findRepoRoot(process.cwd());
    expect(root).not.toBeNull();
    expect(existsSync(join(root as string, 'ssot/02-domain/rank-progression.yaml'))).toBe(true);
  });

  it('MANDATORY: the ladder actually parses, and is not empty', () => {
    // Finding the file is not the same as being able to read a ladder out of
    // it. An empty parse would promote nobody and report success.
    const root = findRepoRoot(process.cwd()) as string;
    const rungs = readLadderFromSsot(root);

    expect(rungs.length).toBeGreaterThan(0);
    expect(rungs.map((r) => r.rank)).toContain('Cadet');
    expect(rungs.map((r) => r.rank)).toContain('Grand Master General');
  });

  it('gives up rather than looping at the filesystem root', () => {
    // `dirname('/')` is `/`. A walk without this check spins forever.
    expect(findRepoRoot(resolve('/'))).toBeNull();
  });

  it('MANDATORY: promote.ts no longer ASSIGNS the root by directory depth', () => {
    /*
     * The exact regression: `const repoRoot = resolve(process.cwd(), '../..')`.
     *
     * Narrowed to the ASSIGNMENT deliberately. `findRepoRoot` keeps that
     * expression as its last-resort fallback — reached only when the walk finds
     * nothing — and a blanket ban would fail on the fix itself, which is how a
     * guard ends up deleted for being wrong.
     */
    const source = readFileSync(resolve(process.cwd(), 'src/promote.ts'), 'utf8');
    expect(source).not.toMatch(/const\s+repoRoot\s*=\s*resolve\(process\.cwd\(\)/);
    expect(source).toContain('findRepoRoot()');
  });
});
