import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ACL_MODELS } from '@grims/db';

/**
 * A STATIC guard: an ACL-bearing model may only be read through `AclDbService`.
 *
 * ★ WHY A STATIC CHECK AND NOT A RUNTIME ONE ★
 *
 * The code this protects does not exist yet. P2 will write the first forum
 * repository, P7 the first loadout read, P8 the first knowledge-chunk retrieval.
 * A runtime assertion cannot fail on a query nobody has written — so it would
 * pass every day until the day it mattered, which is exactly how INV-002 came to
 * be reported as covered while nothing enforced it.
 *
 * This reads the source tree instead. The moment somebody writes
 * `prisma.forumCategory.findMany(...)` against the plain injected client, this
 * test names the file and the line.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT DO ★
 *
 * It does not try to prove the query is CORRECT, or that the right principal was
 * used. It proves the plain client is not being used to reach a gated table,
 * which is the one mistake that is both easy to make and invisible in review.
 * `acl-db.service.spec.ts` proves the filtering itself.
 *
 * ★ SCOPE: apps/api ONLY, AND THAT IS A KNOWN LIMIT ★
 *
 * The worker and the bot hold their own Prisma clients and have no
 * `AclDbService` — they are background processes that legitimately operate
 * across every member, which is what `forSystem` exists to express on this side.
 * Extending this guard to them would flag correct code with no way to satisfy it.
 *
 * The exposure that remains: a future worker job reading a gated table would not
 * be caught here. It is written down rather than papered over, and the honest fix
 * when P2 arrives is a system-principal helper in the worker with the same
 * "state your reason" shape.
 */

const API_SRC = join(__dirname, '..');

/** Prisma's accessor for a model: `ForumCategory` -> `forumCategory`. */
function accessorFor(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.ts$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Files allowed to name an ACL accessor.
 *
 * `acl-db.service.ts` is the enforcement point: it MUST read
 * `forumCategory` to resolve the visible set, and that read is the one place the
 * unfiltered client is correct. Listed by exact filename rather than a pattern,
 * so a new exemption is a visible edit to this list.
 */
const ALLOWED = new Set(['authz/acl-db.service.ts']);

describe('INV-002 — no ACL-bearing model is read through the plain client', () => {
  const files = sourceFiles(API_SRC);

  it('scans a plausible number of files', () => {
    // A guard that silently scanned nothing would pass forever. This is the
    // check on the check.
    expect(files.length).toBeGreaterThan(50);
  });

  it('knows which models carry an ACL', () => {
    // Sourced from the same constant the extension uses, so a model added there
    // is covered here automatically rather than needing this list updated.
    expect(Object.keys(ACL_MODELS).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(ACL_MODELS)).toContain('ForumCategory');
  });

  it('MANDATORY @INV-002: nothing outside AclDbService touches an ACL model', () => {
    const accessors = Object.keys(ACL_MODELS).map(accessorFor);
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(API_SRC, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;

      const src = readFileSync(file, 'utf8');
      /*
       * Comments are stripped first. Several files discuss `forumCategory` in
       * prose — including this feature's own documentation — and a guard that
       * fired on an explanation would be turned off within a week.
       */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

      for (const accessor of accessors) {
        // `.forumCategory.` — a property access on some client, not the word.
        const re = new RegExp(`\\.\\s*${accessor}\\s*\\.`);
        if (re.test(code)) {
          const line = code.split('\n').findIndex((l) => re.test(l)) + 1;
          offenders.push(`${rel}:${line} reads .${accessor}. outside AclDbService`);
        }
      }
    }

    /*
     * If this fails, the fix is to inject `AclDbService` and call
     * `forCaller(userId)` — or, for genuine background work, `forSystem(reason)`
     * with the reason written down. It is not to add the file to ALLOWED.
     */
    expect(offenders).toEqual([]);
  });

  /*
   * The guard has to be able to fail, and the only honest way to know is to feed
   * it the offending shape. Without this, a broken regex would make the check
   * above pass on everything forever.
   */
  it('the guard actually detects the pattern it exists to catch', () => {
    const accessor = accessorFor('ForumCategory');
    const re = new RegExp(`\\.\\s*${accessor}\\s*\\.`);

    expect(re.test('await this.prisma.forumCategory.findMany({})')).toBe(true);
    expect(re.test('await this.db . forumCategory . count()')).toBe(true);
    // And does not fire on prose or on an unrelated identifier.
    expect(re.test('the forumCategory table is gated')).toBe(false);
    expect(re.test('const forumCategoryCount = 3')).toBe(false);
  });
});
