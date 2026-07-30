import { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, dialog } from 'electron';
import { readdir, readFile, stat, open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { accumulate } from './totals.js';
import { isGameRunning, isActivelyPlaying } from './game-process.js';
import {
  FRESH,
  onProofOfLife,
  onSuccess,
  onUnauthorised,
  shouldSkip,
  statusLine,
  type BackoffState,
} from './upload-backoff.js';
import { fetchHubSettings, type HubSettings } from './hub-settings.js';
import { updateAvailable } from './update-check.js';
import { searchForJournalDir, searchRootsFor, type SearchFs } from './journal-search.js';

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

/*
 * Upload backoff state. The RULES live in `upload-backoff.ts` so they can be unit tested — the
 * Electron main process imports `electron` and cannot be, which is exactly where the original
 * "give up on the first 401" assumption survived unchallenged for as long as it did.
 */
let backoff: BackoffState = FRESH;

let tray: Tray | null = null;
let window: BrowserWindow | null = null;
let config: CompanionConfig;
let timer: NodeJS.Timeout | null = null;
let lastOutcome: WatchOutcome | null = null;
let explainedTrayOnce = false;
let searching = false;

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
 * Runs a process listing.
 *
 * ★ A HARD TIMEOUT, BECAUSE THIS IS ON THE POLL PATH ★
 *
 * `tasklist` on a machine under load — which is what a machine running Elite
 * is — can take a moment, and without a ceiling a hung call would stall the
 * whole tick behind it. Two seconds is far longer than it ever needs and far
 * shorter than the twenty-second poll.
 *
 * `windowsHide` stops a console window flashing on screen every poll, which on
 * Windows is otherwise exactly what happens and is maddening while playing.
 */
const listProcesses = async (
  command: string,
  args: readonly string[],
): Promise<{ stdout: string }> => {
  const run = promisify(execFile);
  const { stdout } = await run(command, [...args], { timeout: 2_000, windowsHide: true });
  return { stdout };
};

const searchFs: SearchFs = {
  async readDir(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  },
};

/**
 * Every fixed drive, on Windows.
 *
 * A Steam library on D: is completely normal and is the single most common
 * reason the known paths miss. `wmic` is deprecated but present everywhere;
 * PowerShell is the fallback, and if both fail we look at C: and say so rather
 * than failing the whole search.
 */
async function windowsDrives(): Promise<string[]> {
  const run = promisify(execFile);
  try {
    const { stdout } = await run('powershell', [
      '-NoProfile',
      '-Command',
      '(Get-PSDrive -PSProvider FileSystem).Root',
    ]);
    const drives = stdout
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\\$/, ''))
      .filter((l) => /^[A-Za-z]:$/.test(l));
    return drives.length > 0 ? drives : ['C:'];
  } catch {
    return ['C:'];
  }
}

/**
 * Where the journals are.
 *
 * ★ THREE STEPS, CHEAPEST FIRST ★
 *
 *   1. The member's own override, if they set one.
 *   2. The known paths, which cover a normal install and cost nothing.
 *   3. A bounded SEARCH, once, cached.
 *
 * Step 3 is the one that matters for the people this app is hardest for. The
 * known paths miss a Steam library on a second drive, a Proton prefix under a
 * non-default root, a renamed CrossOver bottle, or OneDrive having quietly
 * moved Saved Games — and every one of those ends with a member being asked to
 * find a folder they have never heard of, inside a prefix that only exists
 * because the game does not run natively. Most will not.
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

  // Cached from a previous search. Re-checked, because a member can uninstall
  // the game or unplug the drive it was on.
  if (config.discoveredJournalPath !== null) {
    try {
      if ((await stat(config.discoveredJournalPath)).isDirectory()) {
        return config.discoveredJournalPath;
      }
    } catch {
      // Gone. Fall through and search again.
      config = { ...config, discoveredJournalPath: null, searchedAndFoundNothing: false };
    }
  }

  // Already searched and came up empty. Not repeated every twenty seconds —
  // the answer will not have changed, and the member has been told.
  if (config.searchedAndFoundNothing) return null;

  return runDeepSearch(os);
}

/** The bounded search, run once and remembered either way. */
async function runDeepSearch(os: Platform): Promise<string | null> {
  searching = true;
  push();
  try {
    const roots = searchRootsFor({
      platform: os,
      home: homedir(),
      drives: os === 'win32' ? await windowsDrives() : undefined,
    });

    const { found, timedOut } = await searchForJournalDir(searchFs, roots, { deadlineMs: 25_000 });
    const hit = found[0] ?? null;

    config = {
      ...config,
      discoveredJournalPath: hit,
      /*
       * A search that ran out of TIME is not a search that found nothing — it
       * is a search that was interrupted, and giving up permanently on the
       * strength of it would strand somebody with a slow disk forever.
       */
      searchedAndFoundNothing: hit === null && !timedOut,
    };
    saveConfig(app.getPath('userData'), config);
    return hit;
  } finally {
    searching = false;
  }
}

/**
 * Whether the last pass considered them in-game.
 *
 * Held in memory rather than the config: it describes THIS run of the app, and
 * a value restored from disk after a restart would fire a stop signal for a
 * session that ended days ago.
 */
let wasPlaying = false;

/**
 * When the newest journal was last written, in epoch milliseconds.
 *
 * ★ WHY NOT JUST "DID IT GROW THIS PASS" ★
 *
 * That is what `outcome.gameRunning` already answers, and it is too strict on
 * its own: Elite writes nothing during long supercruise, so a member mid-flight
 * would flicker offline every pass that happened to catch a quiet moment. The
 * modification time survives those gaps.
 *
 * Null when there are no journals or the directory cannot be read — which the
 * caller treats as "not playing", the safe direction.
 */
async function newestJournalWriteAt(dir: string): Promise<number | null> {
  try {
    const files = (await readdir(dir)).filter(isJournalFile).sort();
    const newest = files[files.length - 1];
    if (newest === undefined) return null;
    return (await stat(join(dir, newest))).mtimeMs;
  } catch {
    return null;
  }
}

async function tick(): Promise<void> {
  /*
   * ★ BEFORE THE JOURNAL CHECK, NOT AFTER ★
   *
   * This sat at the END of the tick, past the early return below — so a member
   * whose journals we cannot find would never have seen what the squadron
   * keeps. That is exactly the member most likely to open the window and look,
   * and the panel would have said "Asking the hub…" forever.
   *
   * TTL-guarded, so on almost every pass this returns without a request.
   */
  void refreshHubSettings();

  /*
   * ★ BACKING OFF, NOT STOPPING ★
   *
   * The timer keeps running at its normal cadence; this pass simply skips the upload while a
   * backoff is in force. That matters more than it looks: the settings poll above still runs, so
   * the moment it succeeds `credentialProvenAlive()` clears the backoff and the very next pass
   * sends. A cleared interval could never have done that — which is precisely how the app sat
   * silent for thirteen hours with a perfectly good token.
   */
  if (shouldSkip(backoff, Date.now())) {
    /*
     * ★ SAY SO, LOUDLY ★
     *
     * Silence was the failure mode that actually hurt: the old code stopped uploading and went on
     * looking connected and healthy for thirteen hours, and the first anyone knew was the roster
     * showing members offline while they were in game. A skipped pass now writes a real error into
     * the outcome the window and the tray both read.
     */
    lastOutcome = {
      gameRunning: lastOutcome?.gameRunning ?? false,
      filesRead: 0,
      newFilesRead: 0,
      txBytes: 0,
      rxBytes: 0,
      sent: 0,
      duplicates: 0,
      refused: {},
      unauthorised: true,
      error: statusLine(backoff, Date.now()) ?? 'Not sending — retrying shortly.',
    };
    push();
    refreshTray();
    return;
  }

  const dir = await findJournalDir();
  if (dir === null) {
    lastOutcome = {
      gameRunning: false,
      filesRead: 0,
      newFilesRead: 0,
      txBytes: 0,
      rxBytes: 0,
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
    const pass = await runWatchPass(nodeFs, dir, config, uploader);
    const nextConfig = pass.config;
    let outcome = pass.outcome;

    /*
     * ★ THE JOURNAL GOING QUIET IS NOT THE MEMBER LEAVING ★
     *
     * `outcome.gameRunning` means the newest journal GREW during this pass.
     * That is a real signal and a poor one: outfitting, the galaxy map, a
     * station menu and a parked ship all write nothing for half an hour.
     *
     * Reported from a live machine — EliteDangerous64.exe resident at 3.2 GB,
     * journal untouched for twenty-six minutes, member shown as offline while
     * sitting in the game.
     *
     * So when the journal is quiet we ask the operating system instead, and
     * send the heartbeat ourselves. The process cannot be idle-quiet.
     *
     * Only when the journal is quiet: a pass that already sent a heartbeat has
     * nothing to add, and spawning a process listing every twenty seconds for
     * an answer we already have is a cost with no benefit.
     */
    if (config.enabled && config.deviceToken !== '') {
      /*
       * ★ IN-GAME, NOT MERELY OPEN — owner's decision, 2026-07-29 ★
       *
       * The process alone was reported as wrong, and the report was right: a
       * member had quit and the roster still said Playing now, because Elite
       * keeps `EliteDangerous64.exe` alive at the main menu, at commander
       * select, and for anybody who leaves it running and walks away.
       *
       * So both halves are required — the process AND a journal written
       * recently. The pass above already tells us whether the newest journal
       * GREW; `newestJournalWriteAt` covers the case where it did not grow this
       * pass but was written moments ago, which is most of a real session.
       */
      const processRunning = await isGameRunning(platform(), listProcesses);
      const playing =
        outcome.gameRunning || isActivelyPlaying(processRunning, await newestJournalWriteAt(dir));

      if (playing && !outcome.gameRunning) {
        // The journal did not grow this pass but they are demonstrably in the
        // game, so the hub still needs to hear it.
        const beat = await uploader.send([], { gameRunning: true });
        outcome = {
          ...outcome,
          gameRunning: true,
          txBytes: outcome.txBytes + beat.txBytes,
          rxBytes: outcome.rxBytes + beat.rxBytes,
          // A heartbeat that comes back unauthorised must stop the loop exactly
          // as an upload would; otherwise a revoked device polls forever.
          unauthorised: outcome.unauthorised || beat.unauthorised,
          error: outcome.error ?? beat.error,
        };
      }

      /*
       * ★ SAY SO THE MOMENT THEY STOP ★
       *
       * Presence ages out after five minutes on the server, so without this a
       * member who quits keeps showing as Playing now for up to five minutes.
       * The app knows within one poll; sitting on that is a choice, not a
       * limitation.
       *
       * Sent ONCE, on the transition. Repeating it every pass would be a
       * request every twenty seconds forever to say nothing has changed.
       */
      if (!playing && wasPlaying) {
        const stop = await uploader.send([], { gameStopped: true });
        outcome = {
          ...outcome,
          txBytes: outcome.txBytes + stop.txBytes,
          rxBytes: outcome.rxBytes + stop.rxBytes,
          unauthorised: outcome.unauthorised || stop.unauthorised,
        };
      }

      wasPlaying = playing;
    }

    lastOutcome = outcome;
    noteRate(outcome);

    /*
     * Folded in BEFORE the comparison below, so a pass that only moved the
     * totals still gets written to disk. Accumulating after the save would lose
     * the tally on every quit.
     */
    const withTotals = { ...nextConfig, totals: accumulate(config.totals, outcome) };

    if (JSON.stringify(withTotals) !== JSON.stringify(config)) {
      config = withTotals;
      saveConfig(app.getPath('userData'), config);
    }

    if (outcome.unauthorised) {
      /*
       * ★ ONE 401 IS NOT A DEAD TOKEN — THIS COST THIRTEEN HOURS OF TELEMETRY ★
       *
       * This used to call `stopPolling()` on the first unauthorised response, on the reasoning
       * that "the token is dead and will not recover". On 2026-07-30 that assumption was wrong in
       * production: uploads stopped at 07:00 UTC and never resumed, while the settings poll kept
       * authenticating with THE SAME TOKEN every five minutes and returning 200 for thirteen
       * hours. The token was fine. A transient refusal — a deploy, a restart, a blip — is
       * indistinguishable here from a revoked one, and the app treated both as terminal.
       *
       * Worse, it failed INVISIBLY: the settings timer survived, so the app looked connected and
       * healthy the entire time it was sending nothing.
       *
       * `device_tokens` has no expiry column. A token is valid until somebody revokes it, so
       * "gave up" is almost never the right conclusion — and when it IS right, backing off costs
       * one request every half hour rather than a member's whole session.
       */
      backoff = onUnauthorised(backoff, Date.now());
    } else {
      // Any successful pass clears it: whatever the condition was, it has passed.
      backoff = onSuccess();
    }
  } catch (error) {
    lastOutcome = {
      gameRunning: false,
      filesRead: 0,
      newFilesRead: 0,
      txBytes: 0,
      rxBytes: 0,
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
    searching,
    journalPath: config.journalPathOverride ?? config.discoveredJournalPath,
    last: lastOutcome,
    /*
     * The lifetime tally, which is what the panel actually shows. `last` stays
     * because the error and the refusal list come from it — but the numbers a
     * member reads are these.
     */
    totals: config.totals,
    /*
     * The instantaneous rate, computed over the gap between the last two passes
     * that actually moved bytes.
     *
     * Held in memory rather than persisted: a rate is a statement about NOW, and
     * one restored from disk after a restart would describe a transfer that
     * finished days ago.
     */
    rate,
    /*
     * What the hub says it is keeping. Null until the first fetch answers, so
     * the panel can say "asking…" rather than rendering an empty list that
     * looks like "nothing is being collected" — which would be the most
     * alarming possible way to be wrong.
     */
    hub: hubSettings,
    hubError,
    /*
     * The update banner.
     *
     * The version comes from Electron rather than a constant, so it is
     * whatever was actually installed — a hardcoded string would keep claiming
     * to be current after a release.
     */
    appVersion: app.getVersion(),
    updateAvailable: updateAvailable(app.getVersion(), hubSettings?.latestVersion ?? null),
  };
}

/*
 * ★ CACHED, AND REFRESHED ON A SLOW TIMER ★
 *
 * The member changes these on the website, not here, so they change rarely —
 * and fetching them on every twenty-second poll would be a request a minute,
 * forever, to redraw a list that almost never differs.
 */
/**
 * Bytes per second, over the interval between the last two transfers.
 *
 * ★ MEASURED BETWEEN TRANSFERS, NOT OVER THE POLL ★
 *
 * Dividing by the twenty-second poll would report a burst that took 200ms as
 * one-hundredth of its real speed. The elapsed time used is the gap between
 * this transfer and the previous one, which is what those bytes actually
 * occupied.
 *
 * Reset to zero once a poll passes with nothing moved, so the panel does not
 * sit claiming a live transfer rate for a connection that has been silent for
 * an hour.
 */
let rate = { tx: 0, rx: 0, at: 0 };
let lastTransferAt = 0;

function noteRate(outcome: WatchOutcome): void {
  const moved = outcome.txBytes + outcome.rxBytes;
  const now = Date.now();

  if (moved === 0) {
    rate = { tx: 0, rx: 0, at: now };
    return;
  }

  /*
   * The FIRST transfer has no previous one to measure against. Reporting
   * bytes-since-the-epoch would be an absurd number; reporting zero would hide
   * a real transfer. The poll interval is the honest bound on how long it could
   * have taken.
   */
  const elapsedMs = lastTransferAt === 0 ? POLL_MS : Math.max(1, now - lastTransferAt);
  const seconds = elapsedMs / 1000;

  rate = {
    tx: Math.round(outcome.txBytes / seconds),
    rx: Math.round(outcome.rxBytes / seconds),
    at: now,
  };
  lastTransferAt = now;
}

let hubSettings: HubSettings | null = null;
let hubError: string | null = null;
let hubFetchedAt = 0;

const HUB_SETTINGS_TTL_MS = 5 * 60_000;

async function refreshHubSettings(force = false): Promise<void> {
  if (config.deviceToken === '') {
    hubSettings = null;
    hubError = null;
    return;
  }
  if (!force && hubSettings !== null && Date.now() - hubFetchedAt < HUB_SETTINGS_TTL_MS) return;

  const result = await fetchHubSettings({
    apiBaseUrl: apiBaseUrlFor(config, process.env),
    deviceToken: config.deviceToken,
    /*
     * From Electron, never a constant — it is whatever was actually installed.
     * A hardcoded string would go on telling the hub this machine is current
     * after the next release, which is precisely the banner this exists to
     * switch off.
     */
    appVersion: app.getVersion(),
  });

  hubFetchedAt = Date.now();
  if (result.ok) {
    hubSettings = result.settings;
    hubError = null;
    /*
     * This call authenticated with the same token the uploader uses. Whatever refused an upload
     * earlier, the credential is provably alive NOW — so any backoff is based on a conclusion that
     * has since been disproved, and holding to it would keep the member silent for no reason.
     */
    backoff = onProofOfLife();
  } else {
    /*
     * The last good answer is KEPT on a failure. A dropped connection is not
     * news about what is being collected, and blanking the panel would tell the
     * member their settings had changed when only the network had.
     */
    hubError = result.error;
  }
  push();
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
    // Restore first: a window minimised to the taskbar stays minimised when
    // shown, so clicking the tray icon would appear to do nothing at all.
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }

  window = new BrowserWindow({
    width: 620,
    height: 700,
    title: "Grim's Squad Hub",
    // The squadron badge, so the taskbar and Alt-Tab show us rather than the
    // default Electron atom — which reads as "some developer's test build".
    /*
     * ★ .ico ON WINDOWS, PNG EVERYWHERE ELSE ★
     *
     * Windows draws this in the title bar at 16px and in Alt-Tab at 32. Handed
     * a 512px PNG it downscales in one step and the result is the smeared mark
     * that was reported. The .ico carries 32/48/64/128/256 so it picks the
     * nearest.
     *
     * macOS and Linux do not read .ico at all — they get the PNG, which they
     * scale well and which has no title-bar equivalent to get wrong.
     */
    icon: ours('renderer', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
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

  /*
   * Minimising goes to the TRAY, not the taskbar.
   *
   * The app is a background agent — it is useful precisely when nobody is
   * looking at it, and a taskbar button that does nothing but sit there is
   * clutter on a machine that is also running a game. Hiding takes it out of
   * the taskbar entirely, and the tray icon stays as the way back in.
   */
  window.on('minimize', () => {
    window?.hide();
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

    /*
     * The tray icon.
     *
     * macOS wants a TEMPLATE image — a monochrome mask it recolours for light
     * and dark menu bars. Handing it a colour badge produces something that
     * looks broken in dark mode, so the badge is used everywhere else and the
     * template flag is set only where it means something.
     */
    /*
     * The tray takes the SMALL mark, not the app icon.
     *
     * Windows draws the tray at 16px and macOS at 22, doubled on a high-DPI
     * screen. `tray.png` is the 32px brand badge and `tray@2x.png` the 64px, so
     * Electron has a real image at both densities instead of resampling the
     * 512.
     */
    const trayIcon = nativeImage.createFromPath(ours('renderer', 'tray.png'));
    tray = new Tray(trayIcon);
    tray.on('click', () => showWindow());
    refreshTray();

    ipcMain.handle('state', () => state());

    /*
     * A FORCED refresh, bypassing the cache. This is the button somebody
     * presses precisely because they just changed something on the website, so
     * serving them a five-minute-old answer would look like the change had not
     * taken.
     */
    ipcMain.handle('refreshSettings', async () => {
      await refreshHubSettings(true);
      return state();
    });

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

    /*
     * Runs the search again on demand.
     *
     * The member has just installed the game, or plugged the drive back in, or
     * moved their library — all of which mean the cached "found nothing" is now
     * wrong. Better than telling them to reinstall the app.
     */
    ipcMain.handle('rescan', async () => {
      const os = supportedPlatform();
      if (os === null) return { ok: false, advice: advice() };

      config = { ...config, discoveredJournalPath: null, searchedAndFoundNothing: false };
      const hit = await runDeepSearch(os);
      void tick();
      return hit === null ? { ok: false, advice: advice() } : { ok: true, path: hit };
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
