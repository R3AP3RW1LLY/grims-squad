import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseSystemLine, streamGalaxy } from './ingest-galaxy.js';

/**
 * Reading the Spansh galaxy dump.
 *
 * The parsing is what breaks when Spansh change their export, and it should not take an overnight
 * run to discover that. `parseSystemLine` is pure, so the shape is tested without the 4GB file.
 */

const REAL = 'D:/ai/knowledge/galaxy_populated.json.gz';

describe('parsing one line', () => {
  const line =
    '\t{"id64":2456727,"name":"HD 219286","coords":{"x":-2373.71875,"y":-27.21875,"z":-926.21875},' +
    '"allegiance":"Independent","government":"Cooperative","primaryEconomy":"Extraction",' +
    '"security":"Low","population":232952,"bodyCount":23,"controllingFaction":{"name":"The Guardians"},' +
    '"stations":[{"name":"Vinge Terminal","type":"Coriolis Starport","landingPads":{"large":4}}]},';

  it('MANDATORY: reads the system and its stations as separate rows', () => {
    /*
     * Stations must be their OWN rows. "Which stations have a large pad" is a query against
     * stations, and one buried inside a system's JSON can only be found by scanning every system in
     * the galaxy.
     */
    const rows = parseSystemLine(line);
    expect(rows).not.toBeNull();
    expect(rows?.map((r) => r.kind)).toEqual(['system', 'station']);
  });

  it('MANDATORY: keys on id64, not the name', () => {
    /*
     * Names are NOT unique in Elite — procedurally generated sectors repeat them constantly. A name
     * key would silently merge two different places into one row, and nobody would notice.
     */
    const rows = parseSystemLine(line) ?? [];
    expect(rows[0]?.extKey).toBe('2456727');
    // Stations are namespaced by system for exactly the same reason.
    expect(rows[1]?.extKey).toBe('2456727/Vinge Terminal');
  });

  it('MANDATORY: stations inherit the system coordinates', () => {
    // So a spatial search finds a station directly. Its position IS its system's for every question
    // anybody actually asks.
    const rows = parseSystemLine(line) ?? [];
    expect(rows[1]?.coords).toEqual(rows[0]?.coords);
  });

  it('keeps the attributes questions are asked about', () => {
    const sys = (parseSystemLine(line) ?? [])[0];
    expect(sys?.data).toMatchObject({
      allegiance: 'Independent',
      security: 'Low',
      population: 232952,
      controllingFaction: 'The Guardians',
    });
  });

  it('MANDATORY: array brackets and blank lines are not systems', () => {
    // The file opens with `[` and closes with `]`. Treating either as a record inserts junk.
    for (const junk of ['[', ']', '', '   ', '\t']) {
      expect(parseSystemLine(junk)).toBeNull();
    }
  });

  it('malformed JSON yields null rather than throwing', () => {
    // One bad line in tens of millions must cost that line, not the import.
    expect(parseSystemLine('\t{"id64":1,"name":')).toBeNull();
  });

  it('a system with no name or id is skipped', () => {
    expect(parseSystemLine('\t{"coords":{"x":1,"y":2,"z":3}}')).toBeNull();
  });
});

const live = existsSync(REAL) ? describe : describe.skip;

live('streaming the real dump', () => {
  it('reads real systems and stations at constant memory', async () => {
    /*
     * Stops after a few batches: this proves the streaming works against the real file without
     * spending twenty minutes in the test suite. The full import is a worker job, not a test.
     */
    let seen = 0;
    const sample: string[] = [];

    await streamGalaxy(
      REAL,
      async (rows) => {
        seen += rows.length;
        if (sample.length === 0) sample.push(...rows.slice(0, 3).map((r) => `${r.kind}:${r.name}`));
        if (seen > 4_000) throw new Error('STOP');
      },
      2_000,
    ).catch((e: Error) => {
      if (e.message !== 'STOP') throw e;
    });

    console.log('  sample:', sample.join(', '));
    expect(seen).toBeGreaterThan(1_000);
  }, 120_000);
});
