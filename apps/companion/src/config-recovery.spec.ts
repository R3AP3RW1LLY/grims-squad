import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  saveConfig,
  configPath,
  quarantinePath,
  DEFAULT_CONFIG,
  type CompanionConfig,
} from './config.js';

/**
 * Surviving a settings file somebody else has touched.
 *
 * ★ THE INCIDENT THIS EXISTS BECAUSE OF — 2026-08-02 ★
 *
 * A UTF-8 BOM was written to a real `companion-config.json` while testing overlays. `JSON.parse`
 * threw, `loadConfig` swallowed it and returned defaults, and within seconds the polling loop saved
 * those defaults over the file. The device token, the journal offsets and the overlay arrangement
 * were gone permanently, and nothing anywhere said so: every visible symptom was of a fresh
 * install.
 *
 * It was an accident by a developer, and it is a trap laid for every member. PowerShell's
 * `Set-Content -Encoding utf8` writes a BOM by default. So does Notepad. Anybody who opens this file
 * to check their token — or follows a support answer that says "edit this line" — corrupts it just
 * by saving.
 *
 * So this file guards three things: the BOM is read through, an unreadable file is never destroyed,
 * and a write cannot leave a truncated one behind.
 */

/**
 * The byte order mark, by name.
 *
 * Written as a code point rather than pasted in: an invisible character in source is one no
 * reviewer can see, no diff can show, and `no-irregular-whitespace` rightly refuses. Which is the
 * same class of problem as the bug itself.
 */
const BOM = String.fromCharCode(0xfe_ff);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gs-companion-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const PAIRED: CompanionConfig = {
  ...DEFAULT_CONFIG,
  deviceToken: 'gsq_a_real_looking_token',
  enabled: true,
  offsetsByHub: { 'https://grims-squad.com': { 'Journal.2026-08-02T090000.01.log': 4096 } },
};

describe('a byte order mark', () => {
  it('MANDATORY: is read through, not thrown on', () => {
    /*
     * The whole incident in one assertion. Without the strip this returns DEFAULT_CONFIG and the
     * member is silently unpaired.
     */
    saveConfig(dir, PAIRED);
    const written = readFileSync(configPath(dir), 'utf8');
    writeFileSync(configPath(dir), `${BOM}${written}`, 'utf8');

    const loaded = loadConfig(dir);

    expect(loaded.deviceToken).toBe('gsq_a_real_looking_token');
    expect(loaded.enabled).toBe(true);
    expect(loaded.offsetsByHub).toEqual(PAIRED.offsetsByHub);
    // And it must not look like a recovery, because nothing was lost.
    expect(loaded.restoredFrom).toBeUndefined();
  });

  it('MANDATORY: does not leave the file quarantined', () => {
    // A BOM is now an ordinary readable file. Moving it aside would be a scary message about a
    // problem that no longer exists.
    saveConfig(dir, PAIRED);
    const written = readFileSync(configPath(dir), 'utf8');
    writeFileSync(configPath(dir), `${BOM}${written}`, 'utf8');

    loadConfig(dir);

    expect(existsSync(quarantinePath(dir))).toBe(false);
    expect(existsSync(configPath(dir))).toBe(true);
  });
});

describe('a genuinely unreadable file', () => {
  it('MANDATORY: is moved aside rather than overwritten', () => {
    /*
     * The second half of the incident, and the half that made it permanent. Falling back to
     * defaults is correct — the app must start. Letting the next save destroy the original is not.
     */
    writeFileSync(configPath(dir), '{ this is not json', 'utf8');

    const loaded = loadConfig(dir);

    expect(loaded.deviceToken).toBe('');
    expect(loaded.restoredFrom?.quarantined).toBe(true);
    expect(existsSync(quarantinePath(dir))).toBe(true);
    expect(readFileSync(quarantinePath(dir), 'utf8')).toBe('{ this is not json');
  });

  it('MANDATORY: survives the very next save, which is what destroyed it before', () => {
    // The app writes its config on every polling pass. The quarantined copy has to still be there
    // afterwards, or all this bought was a few seconds.
    writeFileSync(configPath(dir), 'corrupt', 'utf8');

    const loaded = loadConfig(dir);
    saveConfig(dir, loaded);

    expect(readFileSync(quarantinePath(dir), 'utf8')).toBe('corrupt');
  });

  it('says WHY, so the app can tell somebody', () => {
    // Silence is what made the original failure invisible: every symptom pointed at a fresh
    // install and nothing pointed at a file that could not be parsed.
    writeFileSync(configPath(dir), 'nonsense', 'utf8');

    expect(loadConfig(dir).restoredFrom?.reason).toBeTruthy();
  });

  it('MANDATORY: never writes the recovery notice back to disk', () => {
    /*
     * It describes one startup. Persisted, the app would report a corruption it had already
     * recovered from at every launch for ever — and the member would have no way to dismiss it.
     */
    writeFileSync(configPath(dir), 'corrupt', 'utf8');

    saveConfig(dir, loadConfig(dir));

    expect(JSON.parse(readFileSync(configPath(dir), 'utf8'))).not.toHaveProperty('restoredFrom');
    expect(loadConfig(dir).restoredFrom).toBeUndefined();
  });
});

describe('an ordinary file', () => {
  it('round-trips everything that matters', () => {
    saveConfig(dir, PAIRED);
    const loaded = loadConfig(dir);

    expect(loaded.deviceToken).toBe(PAIRED.deviceToken);
    expect(loaded.enabled).toBe(true);
    expect(loaded.offsetsByHub).toEqual(PAIRED.offsetsByHub);
    expect(loaded.restoredFrom).toBeUndefined();
  });

  it('is absent on a first run, and that is not a recovery', () => {
    // A fresh install has no file. It must not be reported as corruption — that would greet every
    // new member with a warning about losing settings they never had.
    const loaded = loadConfig(dir);

    expect(loaded.deviceToken).toBe('');
    expect(loaded.restoredFrom).toBeUndefined();
    expect(existsSync(quarantinePath(dir))).toBe(false);
  });

  it('MANDATORY: leaves no temporary file behind', () => {
    /*
     * The write is to a temporary file and then a rename, so a crash mid-write cannot leave a
     * truncated settings file. If the rename ever stopped happening, this catches it — a stray
     * `.tmp` beside the real file is the visible symptom of a write that did not complete.
     */
    saveConfig(dir, PAIRED);

    expect(existsSync(`${configPath(dir)}.tmp`)).toBe(false);
    expect(existsSync(configPath(dir))).toBe(true);
  });

  it('never leaves a zero-byte config, however many times it is written', () => {
    // Rewritten on every polling pass on a machine somebody is also gaming on. Truncate-then-write
    // has a window in which the file is empty and valid-looking; rename has none.
    for (let i = 0; i < 25; i += 1) saveConfig(dir, { ...PAIRED, totals: { ...PAIRED.totals, sent: i } });

    expect(readFileSync(configPath(dir), 'utf8').length).toBeGreaterThan(0);
    expect(loadConfig(dir).deviceToken).toBe(PAIRED.deviceToken);
  });
});
