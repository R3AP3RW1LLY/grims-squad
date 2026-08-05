import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { ACL_MODELS } from '@grims/db';

/**
 * An ACL-bound model may never be read with `findUnique`.
 *
 * ★ THE DEFECT THIS EXISTS TO PREVENT ★
 *
 * Squadron owner, 2026-07-30: "An unexpected error occurred" when posting, suspected to be about
 * a YouTube link. It was not about YouTube, and it was not about that post — EVERY thread creation
 * was returning a 500.
 *
 * `ThreadService.create` read the target category with `db.forumCategory.findUnique({ where: { id } })`.
 * The ACL extension merges its predicate into the same `where`, producing:
 *
 *     { AND: [ { id: "…" }, { id: { in: [ …visible ids… ] } } ] }
 *
 * That is a perfectly good FILTER and an illegal UNIQUE INPUT — `findUnique` requires a unique
 * field at the top level of `where` — so Prisma threw `PrismaClientValidationError` on every call.
 *
 * ★ WHY THE TEST SUITE DID NOT CATCH IT ★
 *
 * The forum unit tests use a hand-written fake client whose `findUnique` accepted `{ id }` happily.
 * A fake that accepts what the real client rejects does not just fail to catch a bug — it actively
 * conceals one, and reports green while doing it. The fake now implements `findFirst` and reads the
 * `AND`-wrapped shape the extension really produces.
 *
 * ★ WHY THIS IS A SOURCE GUARD RATHER THAN A RUNTIME CHECK ★
 *
 * The failure is not conditional: `findUnique` on a bound model is wrong on every call, for every
 * input. That makes it a property of the SOURCE, and a grep is a faster and more honest test of a
 * source property than an integration test that has to reach a database to discover it.
 */

const SRC = join(process.cwd(), 'src');

describe('ACL-bound models and findUnique', () => {
  it('MANDATORY: no service reads an ACL-bound model with findUnique', () => {
    const models = Object.keys(ACL_MODELS).map((m) => `${m[0]?.toLowerCase()}${m.slice(1)}`);

    const offenders: string[] = [];

    for (const rel of globSync('**/*.ts', { cwd: SRC })) {
      if (rel.endsWith('.spec.ts')) continue;
      const file = join(SRC, rel);
      const src = readFileSync(file, 'utf8');

      for (const model of models) {
        /*
         * Matches `<anything>.<model>.findUnique` — including `findUniqueOrThrow`, which fails the
         * same way for the same reason. The receiver is not pinned to `db`, because a bound client
         * held under any other name is still a bound client.
         */
        const pattern = new RegExp(`\\.${model}\\.findUnique(OrThrow)?\\s*\\(`, 'g');
        for (const match of src.matchAll(pattern)) {
          const line = src.slice(0, match.index).split('\n').length;
          offenders.push(`${rel}:${line} — .${model}.findUnique(`);
        }
      }
    }

    expect(
      offenders,
      'These read an ACL-bound model with findUnique. The ACL extension merges its predicate ' +
        'into `where` as an AND array, which is a legal filter and an ILLEGAL unique input — ' +
        'Prisma throws PrismaClientValidationError on every call, so the endpoint 500s always. ' +
        'Use findFirst with the same `where`:\n' +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('the model list is derived from ACL_MODELS, not hardcoded', () => {
    /*
     * Pinned so a model registered for ACL enforcement in future is covered automatically. A
     * hardcoded list would silently stop protecting the next model somebody adds — which is the
     * same shape of mistake as the fake that accepted what Prisma refused.
     */
    expect(Object.keys(ACL_MODELS).length).toBeGreaterThan(0);
    expect(Object.keys(ACL_MODELS)).toContain('ForumCategory');
  });
});
