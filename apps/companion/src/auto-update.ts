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
  /**
   * Called once when a restart is coming despite the game being open, with how long they have.
   *
   * Separate from `onPending` because it is a different message: one says an update is ready and
   * will land when convenient, the other says the app is about to close under them. Conflating the
   * two would mean either a warning nobody needed or a restart nobody expected.
   */
  readonly onForced: (version: string, graceMs: number) => void;
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
 * How often the pending install re-evaluates.
 *
 * Deliberately shorter than the grace period: a sixty-second countdown polled every sixty seconds
 * would take up to two minutes to fire, and a member told "one minute" deserves one minute.
 */
export const FORCED_INSTALL_TICK_MS = 10_000;

/**
 * How long a member gets between being told and being restarted, when the game is running.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * Asked whether an update could be forced through mid-session, and chose to tie the floor to the
 * PUBLISHED version — every release installs, rather than only ones marked critical — with a
 * countdown rather than silence.
 *
 * The reason is data, not tidiness. v0.5.1 fixed how the app RECORDS things: journal offsets that
 * were sending a member's history to the wrong hub, and a carrier hold that only ever climbed. A
 * member in a twelve-hour session is exactly the member whose data is wrong and exactly the one the
 * old rule would never update — it waited for a game close that might be a week away.
 *
 * ★ WHAT THIS COSTS, STATED HONESTLY ★
 *
 * Every update now interrupts play, not just important ones. Sixty seconds is the mitigation: long
 * enough to finish a docking sequence or drop out of supercruise, short enough that the update
 * actually lands. Journal offsets are on disk, so the watcher resumes at the exact byte it stopped
 * at and no journal event is lost — what a restart does cost is the in-memory folds: the current
 * trip's ledger and the carrier-hold witness state.
 */
export const FORCED_INSTALL_GRACE_MS = 60_000;

/**
 * Decides whether an update may be installed right now.
 *
 * Extracted and pure so the rule can be tested. The Electron main process cannot be unit tested —
 * which is exactly where the companion's last bad assumption lived unchallenged for thirteen hours.
 */
export function mayInstall(state: {
  readonly downloaded: boolean;
  readonly gameRunning: boolean;
  /**
   * When the member was told this update is coming, or null if they have not been told.
   *
   * Only consulted while the game is running — a closed game installs at once and needs no warning
   * about an interruption that is not happening.
   */
  readonly warnedAt?: number | null;
  readonly now?: number;
}): boolean {
  if (!state.downloaded) return false;
  if (!state.gameRunning) return true;

  /*
   * Mid-session. The countdown starts when the member is TOLD, so a warning that never reached the
   * screen cannot expire in the background and restart them without notice.
   */
  const warnedAt = state.warnedAt ?? null;
  if (warnedAt === null) return false;
  return (state.now ?? Date.now()) - warnedAt >= FORCED_INSTALL_GRACE_MS;
}

export function startAutoUpdate(hooks: UpdateHooks): () => void {
  let downloadedVersion: string | null = null;
  /** When the member was warned that a mid-session restart is coming. Null until they are. */
  let warnedAt: number | null = null;
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

    /*
     * ★ THE WARNING IS WHAT STARTS THE CLOCK ★
     *
     * Told once, on the first pass that finds them mid-session, and the countdown runs from that
     * moment. Doing it the other way round — starting a timer and warning later — would let the
     * grace period expire against a member who was never told, which is the silent restart this
     * design exists to avoid.
     */
    if (gameRunning && warnedAt === null) {
      warnedAt = Date.now();
      hooks.onForced(downloadedVersion, FORCED_INSTALL_GRACE_MS);
    }

    if (!mayInstall({ downloaded: true, gameRunning, warnedAt })) {
      /*
       * Either mid-session with the countdown still running, or between checks. Re-checked shortly
       * rather than given up on — `autoInstallOnAppQuit` is the backstop if they close the app
       * first, and the countdown needs a tick to expire against.
       *
       * The retry is faster than the grace period on purpose: a sixty-second countdown polled
       * every sixty seconds could take two minutes to fire.
       */
      if (installTimer === null) {
        installTimer = setInterval(() => void tryInstall(), FORCED_INSTALL_TICK_MS);
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
