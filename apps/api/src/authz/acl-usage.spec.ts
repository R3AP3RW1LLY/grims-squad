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
 * Files allowed to name an ACL accessor, and why each one is.
 *
 * ★ AN EXEMPTION IS ONLY LEGITIMATE IF SOMETHING ELSE ENFORCES IT ★
 *
 * Listed by exact filename with a reason, rather than a pattern, so adding one is
 * a visible edit somebody has to justify.
 *
 * `acl-db.service.ts` is the enforcement point: it MUST read `forumCategory`
 * unfiltered to resolve the visible set, and that is the one place the plain
 * client is correct.
 *
 * The forum services are exempt because the COMPILER enforces them instead. They
 * declare `db: AclBoundClient` — a phantom-branded type that can only be obtained
 * from `AclDbService` — so handing them a raw `PrismaClient` is a type error
 * rather than a review comment. That is strictly stronger than this regex, which
 * cannot tell a bound client passed as a parameter from an unbound one.
 *
 * The test below asserts each exemption actually carries that brand, so an
 * exemption cannot be added without earning it.
 */
const ALLOWED = new Map([
  ['authz/acl-db.service.ts', 'the enforcement point — mints the bound client'],
  ['forum/category.service.ts', 'takes AclBoundClient; compiler-enforced'],
  ['forum/thread.service.ts', 'takes AclBoundClient; compiler-enforced'],
  /*
   * The grant service — the only code that WIDENS access past a category ACL, so
   * this is the exemption to scrutinise hardest.
   *
   * It earns it the same way the other two do: every method takes `AclBoundClient`,
   * so a plain client is a compile error rather than a review question. What it adds
   * on top is that its central safety rule is expressed as a QUERY rather than as a
   * check — `#visibleThread` reads the thread through the granter's own bound client,
   * so a moderator who cannot see the officers' board gets `null` and cannot grant
   * access to it. That rule only holds while the client stays bound, which is
   * precisely what the brand guarantees and what BRAND_ENFORCED re-asserts below.
   */
  ['forum/grant.service.ts', 'takes AclBoundClient; the widening path, compiler-enforced'],
  /*
   * The post service — where INV-035 and INV-022 are enforced.
   *
   * Earns the exemption the same way: every method takes `AclBoundClient`, so a plain client
   * is a compile error. Two extra properties are worth naming, because both are ABSENCES that
   * only reading the file can confirm:
   *
   *   - `renderPostBody` is the only path from a request to a stored body (INV-035). Nothing
   *     else in the service writes bodyHtml.
   *   - there is no destructive delete anywhere in it (INV-022). `softDelete` sets a column.
   *
   * The BRAND_ENFORCED check below re-asserts the client type. The two absences are asserted
   * in `post.spec.ts`, structurally, for the same reason: a behavioural test cannot show that
   * something never happens.
   */
  ['forum/post.service.ts', 'takes AclBoundClient; compiler-enforced'],
  ['forum/notify.service.ts', 'takes AclBoundClient; fan-out re-checks per recipient (INV-039)'],
  ['forum/engage.service.ts', 'takes AclBoundClient; compiler-enforced'],
  ['forum/search.service.ts', 'raw SQL; carries the ACL in its own WHERE clause (INV-024)'],
  ['forum/moderation.service.ts', 'takes AclBoundClient; compiler-enforced'],
  ['forum/recruitment.service.ts', 'takes AclBoundClient; compiler-enforced'],
]);

/** Exemptions that rely on the brand rather than on being the enforcement point. */
const BRAND_ENFORCED = [
  'forum/category.service.ts',
  'forum/thread.service.ts',
  /*
   * The grant service. It is the ONLY thing in the codebase that widens access past
   * a category ACL, so the brand matters more here than anywhere else: its safety
   * rests entirely on reading the thread through the GRANTER'S OWN bound client, and
   * a plain client slipped into that parameter would let a moderator who cannot see
   * the officers' board hand out access to it.
   */
  'forum/grant.service.ts',
  'forum/post.service.ts',
  'forum/notify.service.ts',
  'forum/engage.service.ts',
  'forum/search.service.ts',
  'forum/moderation.service.ts',
  'forum/recruitment.service.ts',
];

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

      /*
       * ★ CLIENTS THIS FILE OBTAINED FROM AclDbService ★
       *
       * The guard used to flag ANY `.shipBuild.` access, which made the fix it prescribes —
       * "inject AclDbService and call forCaller(userId)" — fail its own check. A service that
       * resolves its own bound client is not a violation; it is the pattern.
       *
       * So local names assigned from `this.acl.forCaller(...)` or `.forSystem(...)` are collected
       * first, and accesses through them are not offences. This is strictly narrower than the
       * forum services' exemption, which trusts a whole file on the strength of a branded
       * parameter type.
       *
       * What remains an offence is unchanged and is the thing INV-002 names: reading an ACL model
       * off the PLAIN client.
       */
      const bound = new Set<string>(['this.acl.forCaller', 'this.acl.forSystem']);
      for (const m of code.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?this\.acl\.for(?:Caller|System)\s*\(/g,
      )) {
        bound.add(m[1] as string);
      }

      for (const accessor of accessors) {
        // `.forumCategory.` — a property access on some client, not the word.
        const re = new RegExp(`([\\w.)]+)\\s*\\.\\s*${accessor}\\s*\\.`);

        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const hit = re.exec(lines[i] as string);
          if (hit === null) continue;

          const receiver = (hit[1] as string).replace(/^await\s+/, '');

          /*
           * A chained call — `this.acl.forSystem('why').shipBuild.findFirst(...)` — leaves the
           * closing paren as the receiver, and the `this.acl.forX(` that produced it is on the
           * same statement. Both spellings are accepted; neither can name the plain client.
           */
          const chained =
            receiver.endsWith(')') &&
            /this\.acl\.for(?:Caller|System)\s*\(/.test(lines.slice(Math.max(0, i - 8), i + 1).join('\n'));

          if (bound.has(receiver) || chained) continue;

          offenders.push(`${rel}:${i + 1} reads .${accessor}. outside AclDbService`);
          break;
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
   * ★ EVERY BRAND-BASED EXEMPTION MUST ACTUALLY CARRY THE BRAND ★
   *
   * Otherwise the exemption list becomes the hole: a file added to it for
   * convenience would be silently unguarded by both mechanisms at once.
   */
  it('MANDATORY @INV-002: each exempt forum service demands a BOUND client', () => {
    for (const rel of BRAND_ENFORCED) {
      const src = readFileSync(join(API_SRC, rel), 'utf8');
      expect(src, `${rel} must import the branded type`).toContain('AclBoundClient');
      // And must NOT accept a plain client, which would defeat the point.
      expect(src, `${rel} must not accept a plain PrismaClient`).not.toMatch(
        /db:\s*PrismaClient/,
      );
    }
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
