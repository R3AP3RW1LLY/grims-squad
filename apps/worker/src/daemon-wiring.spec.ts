import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every background job the daemon imports must actually be STARTED.
 *
 * ★ THE FAILURE THIS PROJECT KEEPS HAVING ★
 *
 * A job that is written, tested, reviewed and imported — and never called — is invisible. Nothing
 * throws, nothing logs, no test fails, and the only symptom is that the thing it was supposed to do
 * quietly never happens. This session alone produced three of them:
 *
 *   - the orphan flags, complete on the website and absent from the app
 *   - 5,917 companion systems no sweep could ever select
 *   - semantic place search, whose "is it wired up" test passed with the call COMMENTED OUT
 *
 * The daemon had twelve `startX(db)` calls and not one test that any of them ran. Removing any line
 * would have shipped green.
 *
 * ★ WHY IT READS THE SOURCE ★
 *
 * Importing `daemon.ts` starts a worker: timers, database connections, an advisory lock. The
 * question here is not what the daemon DOES, it is whether a line exists — and the cheapest honest
 * way to ask that is to read the file.
 *
 * ★ ANCHORED TO LINE-START, DELIBERATELY ★
 *
 * `toContain` cannot tell code from a comment. That is not hypothetical: earlier today a test
 * asserting a retrieval leg was wired up passed with the call commented out, because the string was
 * still sitting there in the comment. Every assertion below requires the call to begin a line.
 */

const DAEMON = join(process.cwd(), 'src', 'daemon.ts');

/**
 * Every `startSomething` the daemon has available to call — DEFINED here or IMPORTED.
 *
 * Both, because the daemon does both. Written to scan imports alone first, which found exactly one
 * name: all but one of these are local functions, and a guard that only watched imports would have
 * declared eleven untested jobs perfectly guarded. The `toBeGreaterThanOrEqual` below is what
 * caught that, and is why it is there.
 */
function starters(src: string): string[] {
  const names = new Set<string>();

  // Local definitions: `function startX(` — the daemon's own helpers.
  for (const m of src.matchAll(/^\s*(?:export\s+)?function\s+(start[A-Z]\w*)\s*\(/gm)) {
    if (m[1] !== undefined) names.add(m[1]);
  }

  // Imported from a job module: `import { startX } from './jobs/x.js'`.
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.[^']*'/g)) {
    for (const raw of (m[1] ?? '').split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name !== undefined && /^start[A-Z]/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

describe('the daemon starts every job it imports', () => {
  const src = readFileSync(DAEMON, 'utf8');

  it('★ MANDATORY: no job is imported and left uncalled ★', () => {
    const found = starters(src);

    /*
     * A guard on the guard. If the import shape ever changes and this parses nothing, an empty list
     * would satisfy every assertion below and this file would go quiet while claiming to watch the
     * one thing it exists for.
     */
    expect(found.length, 'the scan found no start* imports — the pattern has gone stale').toBeGreaterThanOrEqual(8);

    const uncalled = found.filter(
      // Must BEGIN a line: a commented-out call still contains the text.
      (name) => !new RegExp(`^\\s*${name}\\(`, 'm').test(src),
    );

    expect(
      uncalled,
      'imported and never started — the job simply never runs, and nothing says so',
    ).toEqual([]);
  });

  it('★ MANDATORY: the companion reporting window is among them ★', () => {
    /*
     * Named specifically because it is the reason this file exists. The squadron owner reported
     * "Systems our members have flown to" as not scheduled; if this line is ever dropped the page
     * goes back to saying "Never run" and the report reads identically to the original bug.
     */
    expect(starters(src)).toContain('startCompanionWindows');
    expect(src).toMatch(/^\s*startCompanionWindows\(db\);/m);
  });
});
