import { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, dialog } from 'electron';
import { readdir, readFile, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import {
  journalPathCandidates,
  noJournalsAdvice,
  isJournalFile,
  type Platform,
} from '@grims/shared';
import {
  loadConfig,
  saveConfig,
  redactToken,
  apiBaseUrlFor,
  type CompanionConfig,
} from './config.js';
import { Uploader } from './uploader.js';
import { runWatchPass, type JournalFs, type WatchOutcome } from './watcher.js';

/**
 * The Electron half: a window, a tray icon, and a timer.
 *
 * ★ AS THIN AS IT CAN BE ★
 *
 * Every decision worth testing lives in watcher.ts, journal-reader.ts and
 * config.ts, none of which import Electron. What is left here is plumbing —
 * which is exactly the part that cannot be unit-tested, so there should be as
 * little of it as possible.
 *
 * ★ IT RUNS IN THE BACKGROUND, AND SAYS SO ★
 *
 * Closing the window hides it to the tray rather than quitting, because the app
 * is only useful while Elite is running and nobody wants a second window on
 * their second monitor. Quit is on the tray menu, and the first close explains
 * itself rather than leaving somebody hunting for a process they cannot find.
 */

/**
 * Where our own files are.
 *
 * `app.getAppPath()` rather than `import.meta.url` or `__dirname`: this file is
 * bundled to CommonJS (a sandboxed preload cannot be anything else), so
 * import.meta is unavailable — and inside a packaged asar the two disagree
 * anyway. Electron's own answer is the one that is right in both.
 */
const ours = (...parts: string[]): string => join(app.getAppPath(), 'dist', ...parts);

/** How often to look for new journal lines. */
const POLL_MS = 20_000;

let tray: Tray | null = null;
let window: BrowserWindow | null = null;
let config: CompanionConfig;
let timer: NodeJS.Timeout | null = null;
let lastOutcome: WatchOutcome | null = null;
let explainedTrayOnce = false;

/**
 * The platform, narrowed to one Elite actually runs on.
 *
 * Windows is the only native build; Mac goes through CrossOver or Whisky and
 * Linux through Proton, and both put the journals somewhere we know how to look.
 * Anything else — AIX, SunOS, a BSD — cannot be running the game, so there is
 * nothing to find and saying so plainly beats guessing at a path.
 */
function supportedPlatform(): Platform | null {
  const p = platform();
  return p === 'win32' || p === 'darwin' || p === 'linux' ? p : null;
}

const nodeFs: JournalFs = {
  async listFiles(dir) {
    return (await readdir(dir)).filter(isJournalFile);
  },
  async readFrom(path, offset) {
    /*
     * Opened and read from the offset rather than slurped whole. A long session
     * produces journals of tens of megabytes, and reading all of it every
     * twenty seconds to look at the last few lines would make the app the
     * heaviest thing on the machine after the game.
     */
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat();
      if (size <= offset) return '';
      const buffer = Buffer.alloc(size - offset);
      await handle.read(buffer, 0, buffer.length, offset);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  },
  async sizeOf(path) {
    return (await stat(path)).size;
  },
};

/**
 * Where the journals are.
 *
 * The override wins, then the first candidate that exists. Returns null when
 * nothing is found, which is a normal state on a machine where Elite has never
 * run — not an error to shout about.
 */
async function findJournalDir(): Promise<string | null> {
  if (config.journalPathOverride !== null) return config.journalPathOverride;

  const os = supportedPlatform();
  if (os === null) return null;

  const candidates = journalPathCandidates({
    platform: os,
    home: homedir(),
    userProfile: process.env['USERPROFILE'],
  });

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Not there. Expected for most candidates — we list every layout the
      // three platforms use and only one of them is ever right.
    }
  }
  return null;
}

async function tick(): Promise<void> {
  const dir = await findJournalDir();
  if (dir === null) {
    lastOutcome = {
      filesRead: 0,
      sent: 0,
      duplicates: 0,
      refused: {},
      unauthorised: false,
      error: advice(),
    };
    push();
    return;
  }

  const uploader = new Uploader({
    apiBaseUrl: apiBaseUrlFor(config, process.env),
    deviceToken: config.deviceToken,
  });

  try {
    const { outcome, config: next } = await runWatchPass(nodeFs, dir, config, uploader);
    lastOutcome = outcome;

    if (JSON.stringify(next) !== JSON.stringify(config)) {
      config = next;
      saveConfig(app.getPath('userData'), config);
    }

    if (outcome.unauthorised) {
      /*
       * The token is dead and will not recover. Stop polling rather than
       * retrying every twenty seconds forever — the member has to act, and the
       * window now says so.
       */
      stopPolling();
    }
  } catch (error) {
    lastOutcome = {
      filesRead: 0,
      sent: 0,
      duplicates: 0,
      refused: {},
      unauthorised: false,
      error: error instanceof Error ? error.message : 'Something went wrong reading your journals.',
    };
  }

  push();
  refreshTray();
}

function startPolling(): void {
  if (timer !== null) return;
  timer = setInterval(() => void tick(), POLL_MS);
  void tick();
}

function stopPolling(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** Sends the current state to the window, if one is open. */
function push(): void {
  window?.webContents.send('state', state());
}

function state(): Record<string, unknown> {
  return {
    paired: config.deviceToken !== '',
    tokenHint: redactToken(config.deviceToken),
    enabled: config.enabled,
    apiBaseUrl: apiBaseUrlFor(config, process.env),
    journalPathOverride: config.journalPathOverride,
    running: timer !== null,
    last: lastOutcome,
  };
}

function refreshTray(): void {
  if (tray === null) return;

  const status = !config.enabled
    ? 'Paused'
    : config.deviceToken === ''
      ? 'Not paired'
      : lastOutcome?.unauthorised === true
        ? 'Re-pair needed'
        : lastOutcome?.error != null
          ? 'Cannot reach the hub'
          : 'Watching';

  tray.setToolTip(`Grim's Squad — ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Grim's Squad Hub — ${status}`, enabled: false },
      { type: 'separator' },
      { label: 'Open', click: () => showWindow() },
      {
        label: config.enabled ? 'Pause sending' : 'Resume sending',
        click: () => {
          config = { ...config, enabled: !config.enabled };
          saveConfig(app.getPath('userData'), config);
          if (config.enabled) startPolling();
          else stopPolling();
          refreshTray();
          push();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function showWindow(): void {
  if (window !== null) {
    window.show();
    window.focus();
    return;
  }

  window = new BrowserWindow({
    width: 620,
    height: 700,
    title: "Grim's Squad Hub",
    autoHideMenuBar: true,
    webPreferences: {
      preload: ours('preload.cjs'),
      /*
       * ★ THE THREE THAT MATTER ★
       *
       * The renderer gets no Node access and no direct main-process reach; it
       * talks over a named channel and nothing else. This window renders our own
       * local HTML, but the settings are what stop a future version that loads
       * anything remote from being a full compromise of the member's machine.
       */
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void window.loadFile(ours('renderer', 'index.html'));
  window.once('ready-to-show', () => push());

  /*
   * Closing HIDES. The app is only useful while it is running, and a member who
   * closes the window is nearly always saying "get off my screen" rather than
   * "stop watching". Quit is on the tray menu, and the first time this happens
   * we say so — otherwise it is a process they cannot find and cannot stop.
   */
  window.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window?.hide();

    if (!explainedTrayOnce) {
      explainedTrayOnce = true;
      void dialog.showMessageBox({
        type: 'info',
        title: 'Still running',
        message: "Grim's Squad Hub is still running in the background.",
        detail:
          'It lives in your system tray. Right-click the icon there to pause it or quit properly.',
        buttons: ['Got it'],
      });
    }
  });

  window.on('closed', () => {
    window = null;
  });

  // External links open in the real browser. A member signing in to the hub
  // should be doing it somewhere they can see the address bar.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
});

/*
 * ★ ONE INSTANCE ONLY ★
 *
 * Two copies would read the same journals and race each other's offsets, and
 * the loser would write back a stale one — re-sending events already sent. The
 * hub would dedupe them, so it is not corruption, but it is pointless load and
 * a confusing pair of tray icons.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  void app.whenReady().then(() => {
    config = loadConfig(app.getPath('userData'));

    tray = new Tray(nativeImage.createFromPath(ours('renderer', 'tray.png')));
    tray.on('click', () => showWindow());
    refreshTray();

    ipcMain.handle('state', () => state());

    ipcMain.handle('pair', (_e, token: unknown) => {
      const value = typeof token === 'string' ? token.trim() : '';
      if (!value.startsWith('gsq_')) {
        // Checked here as well as on the server, so a mistyped paste is a
        // sentence rather than a round trip and a 401.
        return { ok: false, error: "That does not look like a pairing code — they start with 'gsq_'." };
      }

      config = { ...config, deviceToken: value };
      saveConfig(app.getPath('userData'), config);
      lastOutcome = null;
      if (config.enabled) startPolling();
      refreshTray();
      return { ok: true };
    });

    ipcMain.handle('unpair', () => {
      /*
       * Forgets the token locally. Deliberately does NOT revoke it on the
       * server — that would need the token to still be valid, and the common
       * reason to unpair is that it no longer is. Revoking is on the website,
       * where the member is authenticated properly.
       */
      config = { ...config, deviceToken: '' };
      saveConfig(app.getPath('userData'), config);
      stopPolling();
      refreshTray();
      return { ok: true };
    });

    ipcMain.handle('setEnabled', (_e, enabled: unknown) => {
      config = { ...config, enabled: enabled === true };
      saveConfig(app.getPath('userData'), config);
      if (config.enabled) startPolling();
      else stopPolling();
      refreshTray();
      return { ok: true };
    });

    ipcMain.handle('openHub', () => {
      void shell.openExternal(`${apiBaseUrlFor(config, process.env).replace(/\/+$/, '')}/settings/devices`);
    });

    ipcMain.handle('chooseJournalFolder', async () => {
      const result = await dialog.showOpenDialog({
        title: 'Where are your Elite Dangerous journals?',
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths[0] === undefined) return { ok: false };

      config = { ...config, journalPathOverride: result.filePaths[0] };
      saveConfig(app.getPath('userData'), config);
      void tick();
      return { ok: true, path: result.filePaths[0] };
    });

    /*
     * Shows the member exactly what a batch would contain, from their own
     * journals, before they turn anything on.
     *
     * ★ WORTH THE CODE ★
     *
     * "We only send these six events" is a claim. This is the claim, checkable,
     * against their own data, without trusting us — and it is the difference
     * between asking for consent and informing it.
     */
    ipcMain.handle('preview', async () => {
      const dir = await findJournalDir();
      if (dir === null) return { ok: false, advice: advice() };

      const files = (await readdir(dir)).filter(isJournalFile).sort();
      const newest = files.at(-1);
      if (newest === undefined) return { ok: false, advice: advice() };

      const text = await readFile(join(dir, newest), 'utf8');
      const { readJournalChunk } = await import('./journal-reader.js');
      const { events } = readJournalChunk(text);

      return { ok: true, dir, file: newest, events: events.slice(0, 40) };
    });

    showWindow();
    if (config.enabled && config.deviceToken !== '') startPolling();
  });
}

/** What to tell somebody when we cannot find any journals. */
function advice(): string {
  const os = supportedPlatform();
  return os === null
    ? 'Elite Dangerous does not run on this operating system, so there are no journals to read.'
    : noJournalsAdvice(os);
}

// No windows open is the NORMAL state — the app lives in the tray. Quitting on
// macOS when the last window closes would defeat the point of it.
app.on('window-all-closed', () => {});
