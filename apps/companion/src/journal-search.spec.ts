import { describe, it, expect } from 'vitest';
import { searchForJournalDir, searchRootsFor, MAX_DEPTH, type SearchFs } from './journal-search.js';

/**
 * Finding the journals when the known paths miss.
 *
 * ★ WHY THIS MATTERS MORE THAN IT LOOKS ★
 *
 * The alternative is asking a member to locate a folder they have never heard
 * of, inside a Wine prefix that only exists because the game does not run
 * natively on their machine. Most people will not, and the honest outcome of
 * "point the app at your journals" for a non-technical player is that they
 * close it and never come back.
 */

/** A fake tree. Keys are folders, values their entries. */
function fakeFs(tree: Record<string, string[]>): SearchFs {
  return {
    async readDir(path) {
      const entries = tree[path];
      if (entries === undefined) throw new Error('ENOENT');
      return entries.map((name) => ({
        name,
        isDirectory: tree[`${path}/${name}`] !== undefined,
      }));
    },
  };
}

const JOURNAL = 'Journal.2026-07-27T100000.01.log';

describe('finding journals', () => {
  it('MANDATORY: finds them by CONTENT, not by folder name', async () => {
    /*
     * The folder is only called "Elite Dangerous" inside an untouched install.
     * A renamed CrossOver bottle, a restored backup, a localised Windows —
     * matching on the name would miss all of them, and looking for the files
     * themselves cannot.
     */
    const fs = fakeFs({
      '/root': ['somewhere'],
      '/root/somewhere': ['a folder nobody would guess'],
      '/root/somewhere/a folder nobody would guess': [JOURNAL],
    });

    const r = await searchForJournalDir(fs, ['/root']);
    expect(r.found).toEqual(['/root/somewhere/a folder nobody would guess']);
  });

  it('finds a Steam library on a second drive', async () => {
    // The single most common reason the known paths miss.
    const prefix =
      '/D:/SteamLibrary/steamapps/compatdata/359320/pfx/drive_c/users/steamuser/Saved Games/Frontier Developments/Elite Dangerous';
    const tree: Record<string, string[]> = { [prefix]: [JOURNAL] };
    let path = '';
    for (const part of prefix.split('/').filter(Boolean)) {
      const parent = path === '' ? '/' + part : path;
      if (path !== '') tree[path] = [part];
      path = path === '' ? parent : `${path}/${part}`;
    }
    tree['/D:'] = ['SteamLibrary'];

    const r = await searchForJournalDir(fs2(tree), ['/D:'], { maxDepth: 20 });
    expect(r.found).toContain(prefix);
  });

  it('MANDATORY: prefers the real install over an old prefix or a backup', async () => {
    /*
     * A machine can genuinely hold several — a live install, a Proton prefix
     * from before somebody switched, a folder restored from a backup. Picking
     * the wrong one means uploading months-old ranks over current ones.
     */
    const fs = fakeFs({
      '/root': ['backup', 'Saved Games'],
      '/root/backup': ['old journals'],
      '/root/backup/old journals': [JOURNAL],
      '/root/Saved Games': ['Frontier Developments'],
      '/root/Saved Games/Frontier Developments': ['Elite Dangerous'],
      '/root/Saved Games/Frontier Developments/Elite Dangerous': [JOURNAL],
    });

    const r = await searchForJournalDir(fs, ['/root']);
    expect(r.found[0]).toBe('/root/Saved Games/Frontier Developments/Elite Dangerous');
  });

  it('MANDATORY: gives up on a deadline rather than running forever', async () => {
    /*
     * A naive scan of a disk with a few million files takes minutes and pins a
     * core. An app that appears to hang on first launch is an app that gets
     * uninstalled — reporting "found nothing yet" is strictly better.
     */
    const deep: Record<string, string[]> = { '/root': ['a'] };
    let path = '/root';
    for (let i = 0; i < 500; i += 1) {
      deep[path] = ['next'];
      path = `${path}/next`;
    }

    let clock = 0;
    const r = await searchForJournalDir(fakeFs(deep), ['/root'], {
      deadlineMs: 100,
      // Every check advances the clock, so the deadline is reached quickly and
      // deterministically rather than depending on how fast the test machine is.
      now: () => (clock += 30),
      maxDepth: 1000,
    });

    expect(r.timedOut).toBe(true);
  });

  it('MANDATORY: does not descend forever even without a deadline', async () => {
    const deep: Record<string, string[]> = {};
    let path = '/root';
    for (let i = 0; i < MAX_DEPTH + 10; i += 1) {
      deep[path] = ['next'];
      path = `${path}/next`;
    }
    // The journals are BELOW the depth limit, so they must not be found.
    deep[path] = [JOURNAL];

    const r = await searchForJournalDir(fakeFs(deep), ['/root']);
    expect(r.found).toEqual([]);
    expect(r.timedOut).toBe(false);
  });

  it('walks past folders the game cannot be in', async () => {
    // node_modules on a developer's machine is millions of files and zero
    // chance of a journal.
    const fs = fakeFs({
      '/root': ['node_modules', 'Saved Games'],
      '/root/node_modules': ['deep'],
      '/root/node_modules/deep': [JOURNAL],
      '/root/Saved Games': [JOURNAL],
    });

    const r = await searchForJournalDir(fs, ['/root']);
    expect(r.found).toEqual(['/root/Saved Games']);
  });

  it('survives a folder it is not allowed to read', async () => {
    // Permission denied is the common case on a real disk, not an error.
    const fs = fakeFs({
      '/root': ['locked', 'ok'],
      '/root/locked': ['x'], // present as a directory, but readDir on it throws
      '/root/ok': [JOURNAL],
    });
    const guarded: SearchFs = {
      async readDir(path) {
        if (path === '/root/locked') throw new Error('EACCES');
        return fs.readDir(path);
      },
    };

    const r = await searchForJournalDir(guarded, ['/root']);
    expect(r.found).toEqual(['/root/ok']);
  });

  it('does not loop on a symlink cycle', async () => {
    const fs = fakeFs({
      '/root': ['loop'],
      '/root/loop': ['back'],
      '/root/loop/back': ['loop'],
    });
    const r = await searchForJournalDir(fs, ['/root', '/root']);
    expect(r.found).toEqual([]);
  });
});

describe('where the search starts', () => {
  it('MANDATORY: never starts at the filesystem root', () => {
    // A search from / is a search of everything. On Windows it would walk the
    // recycle bin and every restore point before reaching anywhere useful.
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const roots = searchRootsFor({ platform, home: '/home/cmdr' });
      expect(roots, platform).not.toContain('/');
      expect(roots.length, platform).toBeGreaterThan(0);
    }
  });

  it('covers every fixed drive on Windows', () => {
    // A Steam library on D: is completely normal.
    const roots = searchRootsFor({ platform: 'win32', home: 'C:/Users/cmdr', drives: ['C:', 'D:'] });
    expect(roots.some((r) => r.startsWith('D:/'))).toBe(true);
  });

  it('looks inside Wine bottles on macOS', () => {
    // Elite has had no native Mac client since 2015. Every Mac player is
    // running it through CrossOver or Whisky, so the journals are inside a
    // prefix rather than anywhere a Mac user would think to look.
    const roots = searchRootsFor({ platform: 'darwin', home: '/Users/cmdr' });
    expect(roots.join(' ')).toMatch(/CrossOver|Whisky/);
  });

  it('looks inside Proton prefixes on Linux', () => {
    const roots = searchRootsFor({ platform: 'linux', home: '/home/cmdr' });
    expect(roots.join(' ')).toContain('compatdata');
  });
});

/** A variant that treats any key in the tree as a directory. */
function fs2(tree: Record<string, string[]>): SearchFs {
  return {
    async readDir(path) {
      const entries = tree[path];
      if (entries === undefined) throw new Error('ENOENT');
      return entries.map((name) => ({
        name,
        isDirectory: tree[`${path}/${name}`] !== undefined,
      }));
    },
  };
}
