import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readCoriolis } from './ingest-coriolis.js';

/**
 * Reading EDCD's coriolis-data.
 *
 * Runs against the REAL checkout when it is present, and skips otherwise so CI is unaffected. The
 * shape of somebody else's repository is exactly the thing a unit test with a fixture cannot keep
 * honest — the fixture stays correct while upstream moves.
 */
const ROOT = 'D:/ai/knowledge/coriolis-data-master';
const live = existsSync(ROOT) ? describe : describe.skip;

live('reading the real coriolis-data checkout', () => {
  const rows = readCoriolis(ROOT);

  it('MANDATORY: finds ships, modules and blueprints', () => {
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds).toContain('ship');
    expect(kinds).toContain('module');
    // The highest-value file for an assistant: what every modification does at every grade.
    expect(kinds).toContain('blueprint');
  });

  it('MANDATORY: every row has a usable name', () => {
    /*
     * Each ship file is `{ "<key>": { properties: {...} } }`, not the ship directly. Assuming the
     * file IS the ship yields rows named `undefined` — which still inserts, still indexes, and
     * silently answers nothing.
     */
    const nameless = rows.filter((r) => typeof r.name !== 'string' || r.name.trim() === '');
    expect(nameless).toEqual([]);
  });

  it('MANDATORY: keys are unique, or re-ingest would overwrite', () => {
    // The unique index is (source, kind, ext_key). A collision means one row silently replacing
    // another on every run, and a module quietly disappearing.
    const keys = rows.map((r) => `${r.kind}/${r.extKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reads real ships with real stats', () => {
    const anaconda = rows.find((r) => r.kind === 'ship' && /anaconda/i.test(r.name));
    expect(anaconda).toBeDefined();
    const props = (anaconda?.data as { properties?: Record<string, unknown> }).properties ?? {};
    // The numbers an assistant needs to answer a build question at all.
    expect(typeof props['hullMass']).toBe('number');
    expect(typeof props['speed']).toBe('number');
  });

  it('a missing directory yields nothing rather than throwing', () => {
    // Upstream is somebody else's repo. A restructure must degrade the ingest, not crash the worker.
    expect(readCoriolis('D:/ai/knowledge/does-not-exist')).toEqual([]);
  });

  it('reports what it actually found', () => {
    const byKind = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.kind] = (acc[r.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.log('  ', JSON.stringify(byKind), 'total', rows.length);
    expect(rows.length).toBeGreaterThan(100);
  });
});
