import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A STATIC guard: every controller constructor parameter must name its own injection token.
 *
 * ★ THE API WOULD NOT START, AND THE WHOLE GATE WAS GREEN — 2026-08-08 ★
 *
 * Three new controllers in `systems/` were written with bare parameters —
 * `private readonly marks: SystemMarksService`, no `@Inject`. Nest then has nothing to resolve
 * from, and the application refused to boot:
 *
 *   Nest can't resolve dependencies of the SystemMarksDeviceController (?, Symbol(PairingService)).
 *
 * Typecheck passed. Lint passed. Seventeen packages of unit tests passed. The website answered 200
 * on every static page while everything behind the API returned an internal server error, and it
 * was a member hitting the site who found it, not the suite.
 *
 * ★ THE REASON WAS ALREADY WRITTEN DOWN, WHICH IS THE POINT ★
 *
 * `auth/me.controller.ts` has carried this since P1.2:
 *
 *   "@Inject is REQUIRED, not decoration: esbuild emits no decorator metadata, so Nest has no way
 *    to infer the type from the parameter and resolves it as undefined. The failure is a startup
 *    DI error, which is exactly the sort of thing that gets noticed late."
 *
 * It was right, it named this exact failure, and it did not prevent it — because a comment in one
 * file cannot enforce anything in another. At the time this guard was written, all 45 controllers
 * and all 139 parameters were already explicit. The convention was universal; what was missing was
 * anything that would notice the first exception.
 *
 * ★ WHY SOURCE TEXT AND NOT REFLECT-METADATA ★
 *
 * The first attempt at this test read `design:paramtypes` at runtime and asserted the set of
 * parameters lacking an explicit token was empty. It passed — including against the actual bug,
 * deliberately reintroduced to check it. Under vitest, esbuild emits NO decorator metadata at all,
 * so `design:paramtypes` is `undefined`, the parameter count was zero, and the assertion compared
 * two empty arrays forever.
 *
 * That is the same absence that causes the production failure, which makes runtime metadata the one
 * thing that cannot be used to detect it. Reading the source is not a workaround here — it is the
 * only place the fact exists.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT DO ★
 *
 * It does not check that the token is the RIGHT one, or that the module provides it. A controller
 * naming a token nobody exports still fails to boot and this guard will not say so. It catches the
 * mistake that is easy to make, invisible in review, and silent in every other check we run.
 */

const API_SRC = __dirname;

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) controllerFiles(full, out);
    else if (name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

/**
 * Comments must go before anything is parsed.
 *
 * The house comments heavily, and prose contains commas and parentheses. A first version of this
 * scanner reported 33 violations, every one of them a fragment of an explanatory comment split on
 * its own punctuation.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The constructor's parameters, split on top-level commas only.
 *
 * Depth tracking matters: `Map<string, number>`, default object literals and the argument list of
 * `@Inject(...)` itself all contain commas that do not separate parameters.
 */
function constructorParameters(source: string): string[] | null {
  const src = stripComments(source);
  const start = src.indexOf('constructor(');
  if (start === -1) return null;

  let depth = 0;
  let end = start + 'constructor'.length;
  for (; end < src.length; end++) {
    if (src[end] === '(') depth++;
    else if (src[end] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }

  const inner = src.slice(start + 'constructor('.length, end);
  const parts: string[] = [];
  let buf = '';
  let d = 0;
  for (const ch of inner) {
    if ('([{<'.includes(ch)) d++;
    else if (')]}>'.includes(ch)) d--;
    if (ch === ',' && d === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') parts.push(buf);

  return parts.map((p) => p.trim().replace(/\s+/g, ' ')).filter((p) => p !== '');
}

describe('every controller states its own dependencies', () => {
  const files = controllerFiles(API_SRC);

  it('found the controllers to check', () => {
    // If a refactor moves them, this guard must fail rather than quietly protect nothing.
    expect(files.length).toBeGreaterThan(40);
  });

  it('★ MANDATORY: no constructor parameter relies on emitted metadata ★', () => {
    const bare: string[] = [];

    for (const file of files) {
      const parameters = constructorParameters(readFileSync(file, 'utf8'));
      if (parameters === null) continue;

      for (const parameter of parameters) {
        if (/@Inject\s*\(/.test(parameter)) continue;
        bare.push(`${relative(API_SRC, file).replace(/\\/g, '/')}  ::  ${parameter.slice(0, 90)}`);
      }
    }

    /*
     * ★ WHERE THIS ACTUALLY BITES — MEASURED 2026-08-10 ★
     *
     * Worth stating precisely, because the two answers differ and the vaguer version sends somebody
     * hunting a production outage that is not there:
     *
     *   The production image builds with `tsc -b` and `emitDecoratorMetadata: true`, so it DOES
     *   emit the token. Checked inside the running container: `dist/systems/*.controller.js` carries
     *   `design:paramtypes`, and Nest resolves a bare parameter from it perfectly well.
     *
     *   Every esbuild path — `tsx` in local dev, and vitest — emits nothing. A controller written
     *   this way therefore works in the image and fails on the machine of whoever next runs the API
     *   locally, which is the worst place for a difference to live.
     *
     * So the rule is not "this breaks production". It is that a constructor must not depend on
     * WHICH COMPILER ran, and the two of these that reached main did.
     */
    expect(
      bare,
      'These constructor parameters have no @Inject(), so they resolve only where decorator ' +
        'metadata is emitted. The production tsc build emits it; tsx and vitest do not — the API ' +
        'boots in the image and refuses to start locally, with typecheck, lint and every unit test ' +
        'green. Name the token: @Inject(TheService) private readonly x: TheService.\n\n' +
        bare.join('\n'),
    ).toEqual([]);
  });
});
