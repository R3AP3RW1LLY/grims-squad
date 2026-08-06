import { describe, it, expect } from 'vitest';
import {
  journalPathCandidates,
  noJournalsAdvice,
  isJournalFile,
  type Platform,
} from './journal-paths.js';

/**
 * Finding the journals on every platform a member might play on.
 *
 * ★ THE FACT THAT SHAPES THIS FILE ★
 *
 * Elite Dangerous has NO native macOS build — Frontier discontinued the Mac
 * client in 2015 and neither Horizons 4.0 nor Odyssey has one. Linux has no
 * native build either; it runs under Proton.
 *
 * So "supports Mac and PC" cannot mean "the game runs natively on both". It
 * means finding the journals wherever the member actually plays: natively on
 * Windows, inside a Proton prefix on Linux, and inside a CrossOver or Whisky
 * bottle on macOS.
 */
const ALL: Platform[] = ['win32', 'darwin', 'linux'];

describe('every supported platform has candidates', () => {
  it('MANDATORY: none returns an empty list', () => {
    // An empty list means the app silently supports nothing on that platform,
    // and the member sees "no journals found" with no idea why.
    for (const platform of ALL) {
      const paths = journalPathCandidates({ platform, home: '/home/cmdr' });
      expect(paths.length, platform).toBeGreaterThan(0);
    }
  });

  it('every candidate ends at the Frontier journal folder', () => {
    for (const platform of ALL) {
      for (const p of journalPathCandidates({ platform, home: '/home/cmdr' })) {
        expect(p, p).toContain('Saved Games/Frontier Developments/Elite Dangerous');
      }
    }
  });
});

describe('Windows', () => {
  const ctx = { platform: 'win32' as const, home: 'C:/Users/cmdr' };

  it('looks in the normal Saved Games location first', () => {
    expect(journalPathCandidates(ctx)[0]).toBe(
      'C:/Users/cmdr/Saved Games/Frontier Developments/Elite Dangerous',
    );
  });

  it('MANDATORY: also looks inside OneDrive', () => {
    /*
     * OneDrive silently redirects Saved Games on some Windows setups. The
     * member did not choose it and does not know it happened — they just see
     * an app that cannot find journals that are plainly there.
     */
    const paths = journalPathCandidates(ctx);
    expect(paths.some((p) => p.includes('OneDrive'))).toBe(true);
  });

  it('prefers USERPROFILE when it differs from home', () => {
    const paths = journalPathCandidates({ ...ctx, userProfile: 'D:/Profiles/cmdr' });
    expect(paths[0]).toContain('D:/Profiles/cmdr');
  });
});

describe('Linux', () => {
  const paths = journalPathCandidates({ platform: 'linux', home: '/home/cmdr' });

  it('MANDATORY: looks inside the Proton prefix, not a native path', () => {
    // There is no native Linux build. A native-looking path would find nothing,
    // forever, on every Linux machine.
    expect(paths[0]).toContain('compatdata/359320');
    expect(paths[0]).toContain('pfx/drive_c');
  });

  it('covers both common Steam install layouts', () => {
    expect(paths.some((p) => p.includes('/.steam/steam/'))).toBe(true);
    expect(paths.some((p) => p.includes('/.local/share/Steam/'))).toBe(true);
  });

  it('covers the Flatpak Steam layout', () => {
    expect(paths.some((p) => p.includes('com.valvesoftware.Steam'))).toBe(true);
  });
});

describe('macOS', () => {
  const paths = journalPathCandidates({ platform: 'darwin', home: '/Users/cmdr' });

  it('MANDATORY: looks inside Wine bottles, because there is no Mac client', () => {
    /*
     * Frontier discontinued the macOS version in 2015. Every Mac player is
     * running it through CrossOver or Whisky, so the journals are inside a
     * bottle. A Mac-native path would be looking for a file the game has never
     * written on that platform.
     */
    expect(paths.some((p) => p.includes('CrossOver'))).toBe(true);
    expect(paths.some((p) => p.includes('Whisky'))).toBe(true);
    expect(paths.some((p) => p.includes('drive_c'))).toBe(true);
  });

  it('the advice SAYS there is no Mac version', () => {
    // A Mac member who does not know this will assume our app is broken rather
    // than that their setup is unusual. Telling them is the difference between
    // a support conversation and an uninstall.
    expect(noJournalsAdvice('darwin')).toMatch(/no macOS version/i);
    expect(noJournalsAdvice('darwin')).toMatch(/CrossOver|Whisky/);
  });
});

describe('advice when nothing is found', () => {
  it('MANDATORY: every platform offers a next step', () => {
    // "We could not find your journals" with no next step is where somebody
    // uninstalls.
    for (const platform of ALL) {
      const advice = noJournalsAdvice(platform);
      expect(advice.length, platform).toBeGreaterThan(40);
      // Every platform's advice ends at the same escape hatch, because no list
      // of paths can predict every Wine prefix and Steam library.
      expect(advice, platform).toMatch(/point the app at/i);
    }
  });
});

describe('journal file matching', () => {
  it('matches real journal filenames', () => {
    expect(isJournalFile('Journal.2026-07-27T120000.01.log')).toBe(true);
    expect(isJournalFile('Journal.230715120000.01.log')).toBe(true);
  });

  it('MANDATORY: ignores every other file in the folder', () => {
    /*
     * The same folder holds Status.json, Market.json, Cargo.json, ModulesInfo and more. None of
     * them is a JOURNAL file, which is all this predicate decides — it drives the "which files do
     * we walk and track offsets for" loop, and walking a file the game overwrites in place would
     * be meaningless.
     *
     * ★ Market.json IS NOW READ, AND DELIBERATELY NOT HERE — 2026-08-06 ★
     *
     * This note used to say reading those files "is outside what the member agreed to — the app
     * says it reads the journal, so it reads the journal". That promise was kept, and the Data
     * Bounty feature built on top of it could not work: Frontier's `Market` journal event carries
     * no prices, they go into Market.json, and production had 1,092 of those events, zero market
     * rows and zero bounties paid, ever.
     *
     * The squadron owner chose to read the file and change the promise where members read it — the
     * telemetry catalogue now names Market.json in what the Market event reveals — rather than keep
     * a leaderboard that credits nobody.
     *
     * It is read by name, once, only when a Market event is in the chunk, and only under the same
     * `trade` consent as the event itself. It is still not a journal file, so it still belongs on
     * this list.
     */
    for (const other of [
      'Status.json',
      'Market.json',
      'Cargo.json',
      'ModulesInfo.json',
      'NavRoute.json',
      'Backpack.json',
      'JournalAlpha.2026-07-27T120000.01.log',
      'notes.txt',
    ]) {
      expect(isJournalFile(other), other).toBe(false);
    }
  });
});
