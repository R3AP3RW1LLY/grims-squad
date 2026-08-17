import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing may read `carrier_cargo`.
 *
 * ★ WHAT HAPPENED — 2026-08-17 ★
 *
 * The table was created on 2026-08-02. Two days later the design split: the DECLARED half of a
 * carrier's hold (journal, cAPI, a crew member's hand) moved to `colony_carrier_cargo`, and the
 * MIRROR half — the carrier's public sell orders — was read from `market_entries` through the
 * freshest catalogue key.
 *
 * ONE query was left pointing at the old table. Nothing has ever written it: no INSERT exists
 * anywhere in the repository, and production held 0 rows against 5,745,190 mirror rows in
 * `market_entries`.
 *
 * So the carrier combined-run page — the screen whose entire purpose is to be the authoritative
 * answer for one carrier across every build it serves — reported `aboard 0` and `still to buy:
 * everything` for carriers the project page showed holding tens of thousands of tonnes. Its own
 * comment claimed parity with that page. It shipped, and it stayed for a fortnight.
 *
 * ★ WHY A GUARD AND NOT JUST A COMMENT ★
 *
 * A dead table with an inviting name, sitting next to a live one whose name differs by a prefix, is
 * how this happened once and is how it would happen again. Typecheck cannot see inside a raw SQL
 * string, and no runtime error is possible: querying an empty table succeeds and returns nothing,
 * which is indistinguishable from "this carrier has no cargo".
 *
 * That is the module's signature failure — a component behaving correctly on data that is not there
 * — and the only thing that catches it is a rule stated out loud.
 */

const ROOTS = ['apps/api/src', 'apps/worker/src', 'apps/web/src', 'apps/companion/src', 'packages'];

/** Every source file under the roots, skipping build output and dependencies. */
function sources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name === 'migrations') {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('the superseded carrier_cargo table', () => {
  it('★ MANDATORY: no code reads it ★', () => {
    /*
     * `colony_carrier_cargo` is the LIVE table and contains the dead one's name as a substring, so
     * the match has to be anchored on a word boundary that the prefix cannot satisfy. Checked with a
     * negative lookbehind rather than a plain `includes`, because a plain `includes` would flag every
     * legitimate query in the module and this guard would be deleted within a day.
     */
    const reads = /(?<!colony_)carrier_cargo/;

    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sources(join(process.cwd(), '..', '..', root))) {
        // This spec names the table in order to forbid it.
        if (file.endsWith('carrier-cargo-is-dead.spec.ts')) continue;

        const src = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*/g, '');

        if (reads.test(src)) offenders.push(file.replace(/\\/g, '/').split('/grim-squad/')[1] ?? file);
      }
    }

    expect(
      offenders,
      'nothing writes carrier_cargo, so anything reading it reads an empty table and cannot tell ' +
        'that apart from a carrier holding nothing. Read market_entries through the freshest ' +
        'catalogue key, the way forProject does.',
    ).toEqual([]);
  });

  it('★ MANDATORY: the combined-run page reads the REAL mirror ★', () => {
    /*
     * The positive half of the same claim. Forbidding the dead table does not by itself make the
     * page correct — it could simply read nothing at all, which is the state it was already in.
     */
    const src = readFileSync(
      join(process.cwd(), 'src/logistics/colony-carrier.service.ts'),
      'utf8',
    );
    const from = src.indexOf('const mirrorRows =');
    expect(from, 'the manifest must still read a mirror').toBeGreaterThan(-1);

    const query = src.slice(from, from + 700);
    expect(query, 'the mirror lives in market_entries').toContain('FROM market_entries m');
    expect(
      query,
      'and a carrier has one catalogue row per system it has jumped to — joining naively counts the ' +
        'hold once per berth, which is the 21,120-vs-6,600 over-count recorded above FRESHEST_KEY',
    ).toContain('FRESHEST_KEY');
  });
});
