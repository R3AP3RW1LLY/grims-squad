import { autoUpdater } from 'electron-updater';

/**
 * Updating itself, without interrupting anybody.
 *
 * ★ WHY THIS WAITS FOR THE GAME TO CLOSE ★
 *
 * Squadron owner, 2026-07-30, asked for silent auto-update and "restart when idle". The literal
 * reading — install as soon as it downloads — is the wrong one: relaunching the app mid-session
 * drops the journal watcher for however long the installer takes, and the member loses telemetry
 * from exactly the session they were most likely playing. It also puts an installer window over a
 * running game, which is the single most annoying thing a background app can do.
 *
 * So the download happens whenever, and the INSTALL waits for Elite to be closed.
 *
 * ★ AND WHY IT NEVER PROMPTS ★
 *
 * The whole request was an app you install once and never touch. A prompt is a decision, and a
 * decision somebody ignores is a version that never updates — which on this app means a member
 * quietly running a build with a known telemetry bug for months.
 *
 * ★ FAILURE IS SILENT ON PURPOSE ★
 *
 * Every handler swallows. An update that cannot be found or downloaded is not news the member can
 * act on, and an error dialog about it would be alarming, useless, and shown to somebody who never
 * asked to think about updates at all. The app carries on doing its job on the version it has.
 */

export interface UpdateHooks {
  /** Whether Elite is running right now. The install waits until this is false. */
  readonly gameRunning: () => Promise<boolean>;
  /** Called when an update is downloaded and waiting, so the panel can say so. */
  readonly onPending: (version: string) => void;
  /** Applies the update. Separated so it can be tested without quitting the process. */
  readonly install: () => void;
  /**
   * The device token, read fresh each check so a re-pair mid-run is picked up.
   *
   * The release feed is members-only and the updater has no session cookie — the token the app
   * already holds is its proof. Empty string means unpaired, and an unpaired app skips the check
   * entirely rather than knocking hourly on a door that will refuse it.
   */
  readonly deviceToken: () => string;
}

/** How often to look for an update. Hourly: a squadron app is not a browser. */
export const UPDATE_CHECK_MS = 60 * 60_000;

/** How often to re-check whether the game has closed, once an update is waiting. */
export const INSTALL_RETRY_MS = 60_000;

/**
 * Decides whether an update may be installed right now.
 *
 * Extracted and pure so the rule can be tested. The Electron main process cannot be unit tested —
 * which is exactly where the companion's last bad assumption lived unchallenged for thirteen hours.
 */
export function mayInstall(state: {
  readonly downloaded: boolean;
  readonly gameRunning: boolean;
}): boolean {
  return state.downloaded && !state.gameRunning;
}

export function startAutoUpdate(hooks: UpdateHooks): () => void {
  let downloadedVersion: string | null = null;
  let checkTimer: NodeJS.Timeout | null = null;
  let installTimer: NodeJS.Timeout | null = null;

  /*
   * Downloads on its own, but does NOT install on its own — that decision is ours, below, and it
   * depends on whether somebody is mid-session.
   */
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    downloadedVersion = info.version;
    hooks.onPending(info.version);
    void tryInstall();
  });

  // Swallowed deliberately — see the note at the top.
  autoUpdater.on('error', () => undefined);

  async function tryInstall(): Promise<void> {
    if (downloadedVersion === null) return;

    const gameRunning = await hooks.gameRunning().catch(() => true);
    if (!mayInstall({ downloaded: true, gameRunning })) {
      /*
       * Still playing. Try again shortly rather than giving up — `autoInstallOnAppQuit` is the
       * backstop if they close the app first, but a member who leaves it running for a week should
       * still end up on the new version.
       */
      if (installTimer === null) {
        installTimer = setInterval(() => void tryInstall(), INSTALL_RETRY_MS);
      }
      return;
    }

    if (installTimer !== null) {
      clearInterval(installTimer);
      installTimer = null;
    }
    hooks.install();
  }

  const check = (): void => {
    const token = hooks.deviceToken();
    if (token === '') return;
    autoUpdater.requestHeaders = { authorization: `Bearer ${token}` };
    void autoUpdater.checkForUpdates().catch(() => undefined);
  };

  check();
  checkTimer = setInterval(check, UPDATE_CHECK_MS);

  return () => {
    if (checkTimer !== null) clearInterval(checkTimer);
    if (installTimer !== null) clearInterval(installTimer);
  };
}
