import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Importing a Raven Colonial export into a plan.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "in raven colonial, we can export a json file with a users build plan, can we take this file ...
 * and generate a new colonization plan" — and on the one real conflict, "Import wins, and say so."
 *
 * ★ WHAT IS WORTH GUARDING ★
 *
 * The reading and the diffing are pure and have thirty-odd tests of their own in
 * `raven-import.spec.ts` and `raven-preview.spec.ts`. What cannot be tested there is whether this
 * service uses them the way the ruling requires, and three ways of getting that wrong would each be
 * quiet:
 *
 *   - applying without previewing, which is the silent replacement the whole design avoids
 *   - writing slot counts without marking them imported, which destroys the "say so" half and makes
 *     the NEXT import warn about work the member never did
 *   - the two doors drifting, so the app and the website disagree about what a file would do
 *
 * None of those fails a type check. Two of them produce perfectly ordinary-looking output.
 */

const HERE = join(process.cwd(), 'src', 'logistics');
const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

/**
 * One method's body, and nothing after it.
 *
 * ★ THE FIRST VERSION OF THIS FILE SLICED TO END-OF-FILE ★
 *
 * Which meant an assertion about what `applyImport` does NOT touch was really an assertion about
 * every method that follows it. It failed on `#bump`, four methods away, for mentioning a table
 * this one never writes — the test being wrong rather than the code.
 *
 * Bounded on the next member declaration at class indent, so "this method does not write sites" is
 * a claim about this method.
 */
function methodBody(source: string, name: string): string {
  const start = source.indexOf(name);
  if (start === -1) return '';
  const rest = source.slice(start + name.length);
  const end = rest.search(/\n {2}(?:async |#|\/\*\*)/);
  return end === -1 ? rest : rest.slice(0, end);
}

const SERVICE = 'colony-plan.service.ts';
const WEB = 'colony.controller.ts';
const DEVICE = 'colony-device.controller.ts';

describe('importing a Raven export', () => {
  it('★ MANDATORY: imported slot counts are MARKED as imported ★', () => {
    /*
     * The "say so" half of the ruling. Without it these are indistinguishable from typed counts,
     * and the preview of the next import announces that work the member never did is about to be
     * replaced — the false warning that teaches people to click through real ones.
     */
    const service = read(SERVICE);

    expect(service, 'the apply writes the source').toMatch(/^\s*slots_source = 'import'$/m);
    expect(service, 'and the hand-entry path still says typed').toMatch(
      /^\s*slots_source = 'typed'$/m,
    );
  });

  it('★ MANDATORY: the preview writes NOTHING ★', () => {
    /*
     * A preview that mutated anything would defeat its own purpose. The pure function is already
     * tested against frozen input; this pins that the SERVICE wrapper around it does not write
     * either.
     */
    const preview = methodBody(read(SERVICE), 'async previewImport(');

    expect(preview.length, 'the preview exists').toBeGreaterThan(0);
    expect(preview, 'no update').not.toMatch(/UPDATE\s+colony_/i);
    expect(preview, 'no insert').not.toMatch(/INSERT\s+INTO/i);
    expect(preview, 'no delete').not.toMatch(/DELETE\s+FROM/i);
  });

  it('★ MANDATORY: applying checks the caller may EDIT this plan ★', () => {
    /*
     * Previewing needs only the right to open the plan — reading what a file would do to something
     * you can already see discloses nothing new. Writing is a different question, and it is asked
     * of `mayEdit`, which knows whose plan it is.
     */
    const apply = methodBody(read(SERVICE), 'async applyImport(');

    expect(apply.length, 'the method was found').toBeGreaterThan(0);
    expect(apply).toMatch(/if \(!\(await this\.mayEdit\(planId, callerId, mask\)\)\) \{/);
  });

  it('★ MANDATORY: the apply goes through the preview, never around it ★', () => {
    /*
     * If apply re-derived its own list of changes there would be two implementations of "what this
     * file does", and the one that drifted would be the one actually writing to the database.
     */
    const apply = methodBody(read(SERVICE), 'async applyImport(');

    expect(apply).toMatch(/await this\.previewImport\(planId, callerId, raw\)/);
    expect(apply, 'and writes only what the preview listed').toMatch(
      /read\.preview\.slotsAdded, \.\.\.read\.preview\.slotsChanged/,
    );
  });

  it('★ MANDATORY: both surfaces use the SAME service ★', () => {
    /*
     * The standing rule — "full parity on the website and the companion app". Two implementations
     * would drift, and the half that drifted would be the one deciding whether somebody's typed
     * slot counts get overwritten.
     */
    for (const file of [WEB, DEVICE]) {
      const source = read(file);
      expect(source, `${file} previews`).toMatch(
        /this\.plans_\.previewImport\(id, me\.userId, body\.file\)/,
      );
      expect(source, `${file} applies`).toMatch(/this\.plans_\.applyImport\(/);
    }
  });

  it('does not distinguish a plan you cannot see from one that is not there', () => {
    /*
     * The same reasoning the project routes follow: "no such plan" and "not yours" are one answer,
     * so a caller learns only that they cannot have it.
     */
    for (const file of [WEB, DEVICE]) {
      const source = read(file);
      const route = source.indexOf("@Post('plans/:id/import/preview')");
      expect(route, `${file} has the route`).toBeGreaterThan(-1);

      expect(source.slice(route, route + 1800)).toMatch(
        /could not be read as a Raven Colonial export/,
      );
    }
  });

  it('applying asks for the POST right, previewing only for VIEW', () => {
    // Reading what a file would do to a plan you can already open discloses nothing new.
    for (const file of [WEB, DEVICE]) {
      const source = read(file);
      const preview = source.slice(source.indexOf("@Post('plans/:id/import/preview')"));
      const apply = source.slice(source.indexOf("@Post('plans/:id/import')"));

      expect(preview.slice(0, 900), `${file} preview`).toMatch(/Permission\.COLONY_VIEW/);
      expect(apply.slice(0, 900), `${file} apply`).toMatch(/Permission\.COLONY_POST/);
    }
  });

  it('★ MANDATORY: structures are NOT written ★', () => {
    /*
     * Slot counts are the thing no other source can supply — the journal does not carry them, and
     * typing them measurably does not scale.
     *
     * Structures are different: the plan has its own ordering, its own primary, and rows that have
     * become real projects. Writing somebody else's export over that is the silent replacement this
     * feature is shaped to avoid. The preview REPORTS what the file claims so a member can act on it
     * themselves; applying them is a separate decision nobody has asked for.
     */
    const apply = methodBody(read(SERVICE), 'async applyImport(');

    expect(apply.length, 'the method was found').toBeGreaterThan(0);
    expect(apply, 'no site rows are created').not.toMatch(/colony_plan_sites/i);
    expect(apply, 'and only bodies are updated').toMatch(/UPDATE colony_bodies/);
  });
});
