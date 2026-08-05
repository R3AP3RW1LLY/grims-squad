import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, hubKey, DEFAULT_CONFIG } from './config.js';

/**
 * A reading position belongs to a DESTINATION, not just to a file.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "it appears that not all of my historical journal data was sent, i joined a colonization project
 * that i was doing in development, and nothing ive done there was attributed, im wondering if my
 * development data is not being sent journal wise"
 *
 * It was not, and the reason is the shape of one field. An offset recorded how far a FILE had been
 * read and said nothing whatsoever about where those lines had been sent. So a run against
 * localhost read the journals, advanced the numbers, and delivered every event to the development
 * database — and when the app was later pointed at grims-squad.com it resumed from where
 * development had stopped. Production never saw a line of it.
 *
 * Nothing reported a problem, because from the app's point of view the work was done. The member's
 * evidence was indirect and easy to disbelieve: a colonisation project with none of their hauling
 * attributed to it.
 *
 * (Before `productName` was set, the packaged app and a `pnpm start` run also shared one config
 * file, which is how a development session could advance the offsets of a real install.)
 */

const dirs: string[] = [];

function configDir(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'grims-offsets-'));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'companion-config.json'), JSON.stringify(contents), 'utf8');
  return dir;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('offsets are tracked per hub', () => {
  it('MANDATORY: the stored shape is keyed by hub, not by file alone', () => {
    // The type is the guarantee. A flat map cannot express "read this far, for that hub".
    expect(DEFAULT_CONFIG.offsetsByHub).toEqual({});
    expect(DEFAULT_CONFIG).not.toHaveProperty('offsets');
  });

  it('MANDATORY: a legacy flat map is attributed to the hub it was pointed at', () => {
    /*
     * The overwhelming majority: one install, one hub, never moved. Their position must survive
     * the upgrade, or the next launch re-uploads months of journals to a hub that already has
     * every line of them.
     */
    const dir = configDir({
      apiBaseUrl: 'https://grims-squad.com',
      deviceToken: 'tok',
      offsets: { 'Journal.01.log': 4096 },
    });

    const loaded = loadConfig(dir);
    expect(loaded.offsetsByHub).toEqual({
      'https://grims-squad.com': { 'Journal.01.log': 4096 },
    });
  });

  it('MANDATORY: a different hub does not inherit another hub’s position', () => {
    /*
     * The bug itself. Development read to byte 4096; production has read nothing, and must be
     * told so — an absent entry is what makes the next pass start at the top and send the history.
     */
    const dir = configDir({
      apiBaseUrl: 'https://grims-squad.com',
      deviceToken: 'tok',
      offsetsByHub: { 'http://localhost:5001': { 'Journal.01.log': 4096 } },
    });

    const loaded = loadConfig(dir);
    expect(loaded.offsetsByHub['https://grims-squad.com']).toBeUndefined();
    expect(loaded.offsetsByHub['http://localhost:5001']).toEqual({ 'Journal.01.log': 4096 });
  });

  it('trailing slashes and case are the same destination, not two', () => {
    // Otherwise one member's config accumulates several positions for one hub and each of them is
    // wrong — which is the same class of mistake this field exists to prevent.
    expect(hubKey('https://Grims-Squad.com/')).toBe(hubKey('https://grims-squad.com'));
    expect(hubKey('  https://grims-squad.com//  ')).toBe('https://grims-squad.com');
  });

  it('a config with neither shape starts empty rather than throwing', () => {
    const dir = configDir({ apiBaseUrl: 'https://grims-squad.com', deviceToken: 'tok' });
    expect(loadConfig(dir).offsetsByHub).toEqual({});
  });
});
