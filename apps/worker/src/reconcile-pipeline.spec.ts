import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The nightly reconcile actually RUNS every stage it depends on.
 *
 * ★ TWO FUNCTIONS EXISTED AND NOTHING CALLED EITHER ★
 *
 * `syncGuildRoles` and `classifyGuildRoles` were both written, documented and
 * unit-tested. Neither was ever invoked, and no `ClassifyStore` was ever
 * implemented. Every unit test passed the whole time — they test the functions,
 * not whether anything runs them.
 *
 * In production that meant `discord_roles` was empty, then full of names with
 * every category left at the default `other`. Both look identical from the
 * outside: the roster, the profile and the activity table all filter to
 * `rank`/`membership`/`award`, so they showed NOTHING. Reported as "none of my
 * roles or ranks are showing" and "the unranked people have no labels".
 *
 * A unit test cannot catch an uncalled function. This reads the entrypoint.
 */
const main = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');

describe('the nightly reconcile pipeline', () => {
  it('MANDATORY: caches the guild role names', () => {
    // Without it every snowflake is unresolvable and every role chip vanishes.
    expect(main).toContain('syncGuildRoles(');
  });

  it('MANDATORY: classifies the roles it just cached', () => {
    /*
     * Caching the name is only half. A freshly synced role defaults to `other`,
     * and every surface filters to rank/membership/award — so a full cache with
     * no categories renders exactly like an empty one.
     */
    expect(main).toContain('classifyGuildRoles(');
  });

  it('MANDATORY: classification runs AFTER the sync', () => {
    // Classifying before fetching would decide nothing on the first run and
    // leave the new roles uncategorised until the following night.
    expect(main.indexOf('syncGuildRoles(')).toBeLessThan(main.indexOf('classifyGuildRoles('));
  });

  it('still reconciles — the role work must not have displaced it', () => {
    expect(main).toContain('ReconcileService');
    expect(main).toContain('.run()');
  });

  it('reports what each stage did', () => {
    // A stage that runs silently is one nobody can tell has stopped running.
    expect(main).toContain('guild role cache synced');
    expect(main).toContain('guild roles classified');
  });
});
