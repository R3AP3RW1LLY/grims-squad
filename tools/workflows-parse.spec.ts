import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every GitHub workflow file is valid YAML.
 *
 * ★ THE FAILURE THIS CATCHES IS SILENT — 2026-08-13 ★
 *
 * A broken workflow file does not fail CI. It stops CI EXISTING. GitHub reports "This run likely
 * failed because of a workflow file issue" on a page nobody opens, and the pull request shows one
 * unrelated check passing — which reads as "not much to run here", not as "your entire test suite,
 * typecheck, lint and build did not happen".
 *
 * That is exactly what it looked like: `close-if-outside` green, and nothing else. The PR would
 * have merged on a glance.
 *
 * ★ THE BUG THAT CAUSED IT, WHICH IS WORTH NAMING ★
 *
 * A script writing YAML emitted `printf '%s\\n'` with the escape already interpreted, so the line
 * broke in half and took the document with it. The same escaping mistake produced a regex full of
 * backspace characters earlier the same day, and a spec whose `.split()` argument was a literal
 * newline before that.
 *
 * A parse is the cheapest possible check and it catches all three shapes at once.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', '.github', 'workflows');

/**
 * A real parse, not a heuristic.
 *
 * The first version of this file hand-rolled a structural check and was wrong in both directions:
 * it flagged companion-release.yml, which had just built and published a release, and it would NOT
 * have caught the bug it was written for — that lived inside a `run: |` block, which any hand-rolled
 * reader has to skip wholesale.
 *
 * A guard that cries wolf on a working file and misses the real one is worse than no guard, so this
 * asks a parser. `yaml` was already in the lockfile as a transitive dependency; promoting it to a
 * devDependency is a smaller change than the failure it prevents.
 */
describe('the workflow files', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  it('★ MANDATORY: there are workflow files to check ★', () => {
    // A guard that silently checks nothing is worse than no guard.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`★ MANDATORY: ${file} parses ★`, () => {
      const text = readFileSync(join(DIR, file), 'utf8');

      // The whole guard. A file that does not parse runs NOTHING, and GitHub reports that on a page
      // nobody opens while the pull request shows one unrelated check passing — which reads as
      // "not much to run here" rather than "your entire suite did not happen".
      expect(() => parse(text), `${file} is not valid YAML`).not.toThrow();
    });

    it(`${file} still declares the jobs it parses to`, () => {
      /*
       * The other way a workflow goes inert: it parses, but a bad edit lost the jobs block. Asked of
       * the PARSED document rather than the text, because a `jobs:` that ended up nested under
       * something else reads fine to a regex and runs nothing.
       */
      const doc = parse(readFileSync(join(DIR, file), 'utf8')) as { jobs?: Record<string, unknown> };

      expect(doc.jobs, `${file} declares no jobs`).toBeDefined();
      expect(Object.keys(doc.jobs ?? {}).length).toBeGreaterThan(0);
    });

    it(`${file} uses spaces, never tabs`, () => {
      // YAML forbids tabs for indentation outright, and an editor inserting one is invisible.
      expect(readFileSync(join(DIR, file), 'utf8')).not.toMatch(/\t/);
    });
  }
});
