import { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, dialog } from 'electron';
import {
  currentMode,
  isEditing,
  pushOverlayData,
  setEditing,
  setLayout,
  startOverlays,
  stopOverlays,
} from './overlay-runtime.js';
import { buildOverlayData } from './overlay-data.js';
import { EMPTY_BGS, type BgsSessionState } from './bgs-session.js';
import { fetchStandingOrders, type CompanionStanding } from './hub-bgs.js';
import { readTradePlan, readPlanOrigin } from './trade-plan.js';
import { recruitStatus, mintInvite } from './hub-recruit.js';
import { scoutSystems, surveySystem } from './hub-scout.js';
import { opsBoard, opsSignUp, opsWithdraw } from './hub-ops.js';
import { explain } from './display-mode.js';
import { commanderLocation } from './hub-commander.js';
import {
  colonyAssign,
  colonyAtMarket,
  colonyBuildType,
  addPlanSite,
  attachCarrier,
  colonyBuildTypes,
  colonyClose,
  colonyReportBuilt,
  DEFAULT_SHOPPING,
  colonyPriority,
  colonyAbandoned,
  colonyRemove,
  colonyReopen,
  colonyCarrierSearch,
  colonyCarrierManifest,
  detachCarrier,
  colonyPlan,
  colonyPlans,
  createColonyPlan,
  removeColonyPlan,
  removePlanSite,
  reorderPlan,
  setPlanSlots,
  colonyJoin,
  colonyLeave,
  colonyProject,
  colonyProjects,
  colonyDeclarePurchase,
  colonyPlanReview,
  colonyDraftLayout,
  colonySystemAdvice,
  colonyClaimStation,
  colonyPurchases,
  colonyStationClaims,
  colonyWithdrawStationClaim,
  colonyRoster,
  colonyUnassign,
  colonyCurrent,
  colonySetCurrent,
  colonyClearCurrent,
  postColonyProject,
  pushCarrierCargo,
  pushShipHold,
  setCarrierCargo,
  type CurrentBuild,
} from './hub-colony.js';
import { bountyBoard, bountyLeaderboard, reportNoMarket } from './hub-bounties.js';
import { leaderboardBoard } from './hub-leaderboards.js';
import { miningRings, miningSessions, miningValuation, type HoldValue } from './hub-mining.js';
import { holdOf, worthAsking } from './cargo-value.js';
import {
  helpConversation,
  helpConversations,
  helpEscalate,
  helpSend,
  helpStart,
  supportAccess,
  supportBadge,
  supportClose,
  supportConversation,
  supportConversations,
  supportReopen,
  supportReply,
} from './hub-support.js';
import { tradeCommodities, tradeCommodity, tradeRoutes, type TradeQuery } from './hub-trade.js';
import {
  shipyardBuild,
  shipyardBuilds,
  shipyardFit,
  shipyardOutfit,
  shipyardSave,
  shipyardShips,
} from './hub-shipyard.js';
import { readdir, readFile, stat, open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir, platform, hostname } from 'node:os';
import { startLink, awaitApproval } from './device-link.js';
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
  hubKey,
  webBaseUrlFor,
  type CompanionConfig,
} from './config.js';
import { Uploader } from './uploader.js';
import {
  fetchSavedSystems,
  pinSystem,
  recordSystemUsed,
  unpinSystem,
} from './hub-systems.js';
import { runWatchPass, type JournalFs, type WatchOutcome } from './watcher.js';
import {
  isFresh,
  mergeDock,
  seedFromJournal,
  SEED_TAIL_BYTES,
  type DockedAt,
} from './docked.js';
import { capacityFrom, parseCargo, type Hold } from './cargo.js';
import { EMPTY_TRIP, type TripLedger } from './trip-ledger.js';
import { EMPTY_PROSPECTING, type ProspectingState } from './prospector.js';
import { EMPTY_REFINING, type RefiningState } from './refinery.js';
import { readMiningSettings } from './mining-settings.js';
import { EMPTY_CARRIER_HOLD, carrierSnapshot, type CarrierHoldState } from './carrier-hold.js';
import { accumulate } from './totals.js';
import { isGameRunning, isActivelyPlaying,
  readStatusInGame } from './game-process.js';
import { startAutoUpdate } from './auto-update.js';
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
import {
  FRONTIER_POLL_MS,
  FRONTIER_WATCH_MS,
  frontierAccount,
  frontierGate,
  type FrontierAccount,
  type FrontierGate,
  type GateInput,
} from './frontier-gate.js';
import { updateAvailable } from './update-check.js';
import { searchForJournalDir, searchRootsFor, type SearchFs } from './journal-search.js';
import {
  append as appendActivity,
  gameLine,
  linesFor,
  pairingLine,
  type ActivityLine,
} from './activity.js';

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

/**
 * How often to look for new journal lines.
 *
 * ★ FIVE SECONDS, NOT TWENTY — SQUADRON OWNER, 2026-08-17 ★
 *
 * "can we also increase the live polling of the journal entries to try to make this as real-time as
 * possible".
 *
 * A pass reads from a stored byte offset and usually finds nothing, so the cost of asking more often
 * is a stat() on a file the OS already has cached — not a re-read. What it buys is the gap between
 * moving cargo and the boards agreeing: twenty seconds was long enough for a member to transfer,
 * look at the overlay, and see the old number.
 */
const POLL_MS = 5_000;

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
/** True while a sign-in is waiting for the member to approve it in the browser. */
let linking = false;
/** Set by the cancel button, read by the poll loop. */
let linkCancelled = false;

/**
 * The link currently awaiting approval, so the window can SHOW the code.
 *
 * ★ THE APP WAS THE ONLY THING THAT KNEW IT, AND WOULD NOT SAY ★
 *
 * The happy path puts the code in the URL, so the browser opens already knowing it. Every other
 * path — the browser failing to open, the member closing the tab, approving from a phone or another
 * machine — leaves the approval page correctly asking for a code that nothing on screen could
 * supply. Reported by the squadron owner, 2026-08-01.
 */
let activeLink: { code: string; verifyUrl: string } | null = null;

/**
 * What the app has actually been doing, newest last.
 *
 * ★ SQUADRON OWNER, 2026-08-01: "a real time log of activity ... thats being streamed" ★
 *
 * The window reported totals and rates — all of them numbers, none of them saying WHAT happened.
 * `linesFor` decides what is worth a line and, more importantly, what is not: a quiet pass produces
 * nothing at all, so a glance at this is meaningful rather than a wall of "nothing new".
 */
let activity: ActivityLine[] = [];

/** The last known game state, so only the TRANSITION is logged rather than the boolean. */
let gameWasRunning = false;

/**
 * Where the commander is docked, as of the last journal pass.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "it should appear automatically in the companion app on the new project page if it is not being
 * used please!"
 *
 * Held here rather than in the config: it describes right now, not a setting, and persisting it
 * would be a file write every twenty seconds to record something worthless the moment the app
 * closes.
 */
let dockedAt: DockedAt | null = null;

/**
 * What the startup seed found, kept for as long as it is useful.
 *
 * ★ KEPT, NOT CONSUMED ONCE ★
 *
 * The depot heartbeat arrives every fifteen seconds carrying only a market id, so the LIVE value is
 * rebuilt nameless over and over. Merging the seed in once would be undone by the next pass twenty
 * seconds later — which is precisely the half-filled form the owner reported: market id present,
 * station and system blank.
 *
 * It is discarded the moment the member docks somewhere else, because `mergeDock` refuses to apply
 * a name across a different market id.
 */
let seededDock: DockedAt | null = null;
/**
 * Whether we have watched the member leave, as opposed to simply not knowing where they are.
 *
 * The startup seed is a snapshot from app-start that is never recomputed, so without this a
 * departure fell back to it and the build tracker reverted to the delivery figures as they stood
 * when the app was launched. See the note on `mergeDock`.
 */
let departedDock = false;

/**
 * What is in the hold, and how big the hold is.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "the cargo hold overlay is not working as it is intended. i have a full hold and it is not
 * showing what i am carrying, its value, nothing at all!"
 *
 * It was sending null on purpose, because nothing in the app had ever read a hold. The contents
 * come from `Cargo.json` — Frontier's sidecar beside the journals, rewritten every time the hold
 * changes — and the capacity from `Loadout.CargoCapacity`, which is the only place it exists.
 *
 * Both live here rather than in the config: they describe right now, and persisting them would be
 * a disk write to record something worthless the moment the app closes.
 */
let hold: Hold | null = null;

/*
 * ★ WHAT THE HOLD IS WORTH — SQUADRON OWNER, 2026-08-06 ★
 *
 * "we want valiue information but its showing irrellevant sell information in it!"
 *
 * Priced by the hub against the squadron's market table, because nothing on this machine can
 * answer it. Held here rather than fetched by the panel so that one answer serves the overlay and
 * the window, and so the ASKING can be rate-limited — see `worthAsking`. A laser miner's cargo
 * changes every few seconds for an hour, and pricing it each time would be several hundred
 * fan-outs against eighteen million rows to watch one number creep upward.
 */
let holdValue: HoldValue | null = null;
let valuedAt: number | null = null;
let valuedFor: Record<string, number> | null = null;

/** Asks the hub what the hold is worth, when it is worth asking. Never throws into the caller. */
async function refreshHoldValue(): Promise<void> {
  if (hold === null) return;

  const want = holdOf(hold.items.map((i) => ({ ...i, wanted: false, paid: null })));
  const now = Date.now();
  if (!worthAsking({ hold: want, askedAt: valuedAt, askedFor: valuedFor, now })) return;

  // Stamped BEFORE the request, not after: an in-flight call must not be started again by the
  // next push, which on a busy journal pass is milliseconds away.
  valuedAt = now;
  valuedFor = want;

  const where = mergedDock()?.systemName ?? null;
  const answer = await miningValuation(
    { apiBaseUrl: apiBaseUrlFor(config, process.env), deviceToken: config.deviceToken },
    want,
    where,
  );
  if (!answer.ok) {
    // A hub that cannot price the hold is not an error worth showing: the lines simply do not
    // render, exactly as they do before the first valuation.
    return;
  }

  holdValue = answer.data;
  push();
}
let cargoCapacity: number | null = null;

/**
 * This trip's buying and selling, carried between passes the same way `dockedAt` is.
 *
 * Starts empty ON PURPOSE — nothing is seeded from the journal tail at launch, because a ledger
 * rebuilt from half a session shows a number whose starting point nobody can name. See the header
 * of trip-ledger.ts.
 */
let trip: TripLedger = EMPTY_TRIP;

/**
 * The mining session, carried between passes the same way `trip` is.
 *
 * Unseeded on start for the same reason: a hit rate rebuilt from half a session is a number whose
 * denominator nobody can name.
 */
let prospecting: ProspectingState = EMPTY_PROSPECTING;
let refining: RefiningState = EMPTY_REFINING;

/**
 * The BGS session, and the squadron's standing orders.
 *
 * `standingOrders` starts NULL rather than empty: the panel tells "we have not asked the hub yet"
 * apart from "the officers have ordered nothing", and merging them would have a member on a broken
 * connection reading "no standing orders" and believing it.
 */
let bgs: BgsSessionState = EMPTY_BGS;
let standingOrders: CompanionStanding[] | null = null;

/**
 * The member's own carrier's hold, carried between passes the same way `trip` is.
 *
 * Starts empty on purpose — a witness statement, not an inventory; see carrier-hold.ts. The hub
 * merges what this watched with what crew declare by hand, and the manual figure wins.
 */
let carrierHold: CarrierHoldState = EMPTY_CARRIER_HOLD;

/**
 * The moment this process started watching.
 *
 * Everything older is HISTORY: still read, still uploaded, and deliberately kept out of the trip
 * ledger and the carrier hold. Those two answer "what am I carrying right now", and a first-run
 * replay of thirty journal files — or a full re-read after the app is pointed at a different hub —
 * would otherwise pile a member's entire purchase history into one lot and put a months-old sale
 * on screen as the last transaction. Reported 2026-08-05; see the note in `runWatchPass`.
 *
 * Captured once at module load rather than per pass, so a long-running app keeps one honest
 * boundary instead of a moving one that would quietly discard the session it is meant to track.
 */
const WATCHING_SINCE = Date.now();

/**
 * The last carrier-hold snapshot the hub ACCEPTED, serialised.
 *
 * ★ THE DEBOUNCE IS "ON CHANGE", NOT "ON A TIMER" ★
 *
 * Compared against the current snapshot after every pass: identical means silence, different means
 * one small POST. A failed push leaves this unchanged, so the next pass simply tries again —
 * self-healing without a retry queue.
 */
let lastCarrierPush = '';

/**
 * Pushes the carrier-hold snapshot to the hub when it has changed.
 *
 * Never throws: a member's journal pass must not fail because this POST did. The hub quietly
 * ignores carriers that are not attached to any build, so the app does not need to know whether
 * this one is — pushing is cheap and the server holds the attachment list.
 */
async function pushCarrierHold(): Promise<void> {
  if (config.deviceToken === '') return;

  const snapshot = carrierSnapshot(carrierHold);
  if (snapshot === null) return;

  const serialised = JSON.stringify(snapshot);
  if (serialised === lastCarrierPush) return;

  const answer = await pushCarrierCargo(
    { apiBaseUrl: apiBaseUrlFor(config, process.env), deviceToken: config.deviceToken },
    snapshot,
  );
  if (answer.ok) lastCarrierPush = serialised;
}

/**
 * The last ship-hold snapshot the hub ACCEPTED.
 *
 * Same debounce as the carrier one beside it: identical means silence, different means one small
 * POST, and a failed push leaves this unchanged so the next pass retries without a queue.
 */
let lastHoldPush = '';

/**
 * Pushes the member's own hold to the hub when it has changed.
 *
 * ★ WHY THIS EXISTS AT ALL — SQUADRON OWNER, 2026-08-16 ★
 *
 * "materials being added to fleet carriers and in player holds are not registering properly"
 *
 * The overlay has always been right: it reads `Cargo.json` on this machine. The HUB had never
 * received a single hold — the website's column had no data behind it, zero rows against 8,706
 * depot readings — because nothing ever sent one.
 *
 * A snapshot rather than the journal's `Cargo` event, because Elite writes that event with a count
 * and keeps the inventory in the file. Forwarding the event would send a number with no commodities
 * in it.
 *
 * Never throws. A journal pass must not fail because this POST did.
 */
async function pushHold(): Promise<void> {
  if (config.deviceToken === '') return;

  const items = hold?.items ?? [];
  /*
   * An EMPTY hold is pushed, deliberately. Undocking empty is the event that clears what the hub is
   * showing, and skipping it would leave the board promising materials that were spent hours ago —
   * the wasted trip this module keeps producing under other names.
   */
  const snapshot = {
    commodities: items.map((i) => ({ commodity: i.commodity, tonnes: i.count })),
  };

  const serialised = JSON.stringify(snapshot);
  if (serialised === lastHoldPush) return;

  const answer = await pushShipHold(
    { apiBaseUrl: apiBaseUrlFor(config, process.env), deviceToken: config.deviceToken },
    snapshot,
  );
  if (answer.ok) lastHoldPush = serialised;
}

/**
 * The member's current build, as the hub last told us.
 *
 * ★ SQUADRON OWNER, 2026-08-04: THE BUILD OVERLAY MUST NOT GO DARK WHEN THEY LEAVE THE SITE ★
 *
 * Module state exactly the way `mergedDock` works: refreshed on a timer, pushed to the overlays on
 * every change, and read by `push()` whenever anything else changes. This is what keeps the build
 * tracker populated wherever the member flies — the hub folds in EVERY member's deliveries, so the
 * numbers move while this machine's journal says nothing at all.
 *
 * A fetch failure keeps the last good answer: a dropped connection is not news about the build.
 */
let currentProject: CurrentBuild | null = null;

/**
 * How often to ask the hub about the current build. Its numbers move on other members' hauling.
 *
 * ★ TEN SECONDS, NOT SIXTY ★
 *
 * This is the OTHER half of the lag. Even with the journal read every five seconds and pushed
 * immediately, the overlay only learned the hub's answer once a minute — so a member's own transfer
 * could take over a minute to come back to them, and a wingmate's delivery longer still.
 *
 * Sixty seconds was chosen when this route was expensive. It is much cheaper now that `byId` is no
 * longer priced per call on this path, and ten seconds is the interval at which "I moved cargo and
 * the panel agrees" reads as immediate rather than as a refresh.
 */
const CURRENT_BUILD_MS = 10_000;

async function refreshCurrentProject(): Promise<void> {
  if (config.deviceToken === '') {
    if (currentProject !== null) {
      currentProject = null;
      push();
    }
    return;
  }

  const answer = await colonyCurrent({
    apiBaseUrl: apiBaseUrlFor(config, process.env),
    deviceToken: config.deviceToken,
  });
  if (!answer.ok) return;

  // Pushed only on a real change: the overlays are told the moment another member's delivery
  // lands, and a minute of "nothing moved" costs no broadcast at all.
  const changed = JSON.stringify(answer.data.current) !== JSON.stringify(currentProject);
  currentProject = answer.data.current;
  if (changed) push();
}

/**
 * How often to ask the hub what the officers have ordered.
 *
 * The same cadence as the build tracker, and for the same reason: these numbers move on somebody
 * ELSE'S action — an officer changing the target faction — so this machine's journal will never
 * tell us. A member acting on an order that was countermanded ten minutes ago is the failure this
 * interval exists to bound.
 */
const STANDING_ORDERS_MS = 60_000;

async function refreshStandingOrders(): Promise<void> {
  if (config.deviceToken === '') {
    if (standingOrders !== null) {
      standingOrders = null;
      push();
    }
    return;
  }

  const next = await fetchStandingOrders({
    apiBaseUrl: apiBaseUrlFor(config, process.env),
    deviceToken: config.deviceToken,
  });

  /*
   * Pushed only on a real change. `fetchStandingOrders` returns an empty list on failure, so this
   * would otherwise flap between "no orders" and the real list every minute on a bad connection —
   * and a member watching the panel would see the squadron's instructions blink out and back.
   */
  const changed = JSON.stringify(next) !== JSON.stringify(standingOrders);
  standingOrders = next;
  if (changed) push();
}

/**
 * Rebuilds `dockedAt` from the tail of the newest journal, ignoring saved offsets.
 *
 * ★ WHY THIS HAS TO EXIST — REPORTED FROM A LIVE GAME, 2026-08-02 ★
 *
 * "i am currently in game, i am in the colonization window in the companion app, however, nothing at
 * all is auto populating!"
 *
 * The watcher reads FORWARD from a saved byte offset, so an arrival consumed before this feature
 * existed is behind it for ever. Their journal had `Docked` at byte 184,341 against a saved offset
 * of 211,038 — thirty thousand bytes in the past, and no amount of waiting would bring it back.
 *
 * This reads the last half-megabyte directly, once, at startup. Nothing is uploaded from it and no
 * offset moves: it exists purely to answer "where are they right now" for the app's own UI.
 */
async function seedDock(): Promise<void> {
  try {
    const dir = await findJournalDir();
    if (dir === null) return;

    const names = (await readdir(dir)).filter(isJournalFile).sort();
    const newest = names[names.length - 1];
    if (newest === undefined) return;

    const path = join(dir, newest);
    const { size } = await stat(path);
    const from = Math.max(0, size - SEED_TAIL_BYTES);

    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(size - from);
      await handle.read(buffer, 0, buffer.length, from);
      const tail = buffer.toString('utf8');
      const seeded = seedFromJournal(tail);

      /*
       * Capacity, out of the same read. `Loadout` fires on boarding and on every refit, so the LAST
       * one in the tail describes the ship they are flying now — and taking it from a read we were
       * already doing costs nothing.
       */
      const capacity = capacityFrom(tail);
      if (capacity !== null) cargoCapacity = capacity;
      /*
       * Kept rather than adopted. `state()` merges it with whatever the live pass holds, so the
       * name survives every nameless heartbeat instead of being overwritten by the next one.
       */
      if (seeded !== null) seededDock = seeded;
    } finally {
      await handle.close();
    }
  } catch {
    // Best effort, always. A journal we cannot read here simply means the form is not pre-filled,
    // which is exactly where the app was before this existed.
  }
}

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
 * True while a journal pass is actually uploading.
 *
 * ★ SUB-TICK, OR THE DOT IS A LIE ★
 *
 * Everything else the overlays show is sampled once per pass, which is fine for a build tracker.
 * "Sending" is not: a pass begins and ends between two samples, so an overlay reading this at pass
 * boundaries would observe `false` every single time and the light would never come on. A member
 * watching a status light that never changes concludes the app is dead — which is exactly the
 * failure the status panel exists to rule out.
 */
let sending = false;

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
      dockedAt,
      trip,
      carrierHold,
      prospecting,
      refining,
      bgs,
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
      dockedAt,
      trip,
      carrierHold,
      prospecting,
      refining,
      bgs,
    };
    push();
    return;
  }

  const uploader = new Uploader({
    apiBaseUrl: apiBaseUrlFor(config, process.env),
    deviceToken: config.deviceToken,
  });

  try {
    /*
     * The light goes on before the pass and off after it, whatever happens — including a throw.
     * `push()` on each edge so the overlay sees the transition rather than only the resting state.
     */
    sending = true;
    push();
    let pass;
    try {
      pass = await runWatchPass(
        nodeFs,
        dir,
        config,
        uploader,
        dockedAt,
        trip,
        carrierHold,
        WATCHING_SINCE,
        prospecting,
        refining,
        readMiningSettings(config.miningSettings ?? null),
        bgs,
        standingOrders ?? [],
      );
    } finally {
      sending = false;
    }
    /*
     * A transition from somewhere to nowhere is a DEPARTURE, and the only way it happens is the
     * watcher reading an `Undocked` or an `FSDJump` — it carries the previous dock forward
     * otherwise. That makes this the one place that can tell "they left" from "we do not know".
     */
    if (dockedAt !== null && pass.outcome.dockedAt === null) departedDock = true;
    // Docking again makes the seed relevant once more: the heartbeat carries no station name, and
    // the seed is where a name comes from until a `Docked` supplies one.
    if (pass.outcome.dockedAt !== null) departedDock = false;
    dockedAt = pass.outcome.dockedAt;
    // The trip ledger, carried the same way — the pass folded this pass's buys and sells over it.
    trip = pass.outcome.trip;
    // The own-carrier hold, likewise — and pushed to the hub the moment it differs from what the
    // hub last accepted. Fire-and-forget: a failed push retries on the next pass, and nothing
    // about a member's journal upload waits on it.
    carrierHold = pass.outcome.carrierHold;
    void pushCarrierHold();
    void pushHold();

    /*
     * The mining session, carried the same way. Omitting these two lines was a real bug and the
     * LINTER found it: prefer-const fired because nothing ever reassigned them, which is precisely
     * what "the fold never accumulates" looks like from the outside. The overlays would have sat
     * on their opening state for ever while every pass computed the right answer and discarded it.
     */
    prospecting = pass.outcome.prospecting;
    refining = pass.outcome.refining;
    bgs = pass.outcome.bgs;

    /*
     * ★ THE HOLD, READ FROM FRONTIER'S OWN SIDECAR ★
     *
     * `Cargo.json` sits beside the journals and is rewritten every time the hold changes. It is a
     * few hundred bytes, so reading it on every pass costs nothing measurable — and unlike the
     * journal's `Cargo` events it carries the actual inventory rather than a bare count.
     *
     * Never allowed to throw: a member's journal upload must not fail because a sidecar was being
     * written at the moment we looked at it. A failed read leaves the previous hold in place, which
     * is closer to the truth than nothing.
     */
    try {
      const text = await readFile(join(dir, 'Cargo.json'), 'utf8');
      const read = parseCargo(text);
      if (read !== null) hold = read;
    } catch {
      // Missing before the first time the game writes one, which is normal on a fresh install.
    }

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
        outcome.gameRunning ||
        isActivelyPlaying(
          processRunning,
          await newestJournalWriteAt(dir),
          Date.now(),
          // Status.json catches the quiet-journal sessions the fifteen-minute window loses.
          await readStatusInGame(dir),
        );

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

    // Read BEFORE `lastOutcome` is replaced: the recovery line depends on what the PREVIOUS pass
    // did, and reading it afterwards would always compare the pass against itself.
    const wasRefused = lastOutcome?.unauthorised === true;
    lastOutcome = outcome;

    /*
     * ★ THE ACTIVITY LOG ★
     *
     * Appended here, where the pass is finished and its outcome is final. `linesFor` returns an
     * empty array for a pass that did nothing, so a quiet twenty seconds adds nothing at all —
     * which is what keeps the panel worth looking at.
     */
    const now = Date.now();
    const fresh = linesFor(outcome, now, wasRefused);
    const transition = gameLine(gameWasRunning, outcome.gameRunning, now);
    gameWasRunning = outcome.gameRunning;
    activity = appendActivity(activity, transition === null ? fresh : [transition, ...fresh]);
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
    } else if (outcome.error !== null) {
      /*
       * ★ A FAILED SEND IS NOT A SUCCESSFUL PASS ★
       *
       * This was a bare `else` calling `onSuccess()`, so ONLY an unauthorised reply armed the
       * backoff. Every other failure — the hub down, DNS gone, a 500, a timeout — landed here and
       * CLEARED the throttle, and the app went on hammering at full cadence for ever.
       *
       * ★ AND THE FIRST FIX FOR THAT WAS WRONG — SQUADRON OWNER, 2026-08-03 ★
       *
       * "on the status page of the companion app we get this message: Elite is not running. Sending
       * since 8/2/2026. -- but it is running and active!"
       *
       * My condition was `newFilesRead > 0 && txBytes === 0` — read new journal lines and sent
       * nothing. That is not a failure at all: it is the NORMAL case. Most journal lines are events
       * we do not track, or are in a category the member has switched off, so a pass routinely
       * reads new bytes and has nothing worth sending.
       *
       * So a member playing normally armed the backoff, the next passes were skipped, and the skip
       * path reports the last known `gameRunning` — which never got refreshed, because the passes
       * that would have refreshed it were the ones being skipped. The app told somebody sitting in
       * their cockpit that Elite was not running.
       *
       * The real signal is an ERROR. `outcome.error` is set by the uploader when a send genuinely
       * failed, and by nothing else.
       *
       * That is also what made the freeze compound: a failed upload does not advance the file
       * offset, so every pass re-read and re-parsed the entire unsent journal, and nothing was
       * slowing the passes down.
       *
       * Read new bytes and sent none: something is wrong at the far end. Backed off on the same
       * schedule as an unauthorised reply.
       */
      backoff = onUnauthorised(backoff, Date.now());
    } else {
      // Any genuinely successful pass clears it: whatever the condition was, it has passed.
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
      dockedAt,
      trip,
      carrierHold,
      prospecting,
      refining,
      bgs,
    };
  }

  push();
  refreshTray();
}

/**
 * True while a pass is in flight.
 *
 * ★ SQUADRON OWNER, 2026-08-02: "the app seems to be freezing up quite a bit" ★
 *
 * The interval had no reentrancy guard. A pass that took longer than twenty seconds — which is the
 * NORMAL case after playing offline for a while, because a failed upload does not advance the file
 * offset and the whole unsent remainder is re-read and re-parsed every time — had the next pass
 * start on top of it. Two passes then read the same files against the same module-level config and
 * both wrote it back. Then three, then four, each synchronously parsing megabytes of journal on the
 * main thread. The app locks up harder the longer the member plays.
 *
 * A flag rather than a queue: a skipped pass costs nothing, because the next one twenty seconds
 * later reads from exactly the same offsets and does exactly the same work.
 */
let ticking = false;

function startPolling(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void tick().finally(() => {
      ticking = false;
    });
  }, POLL_MS);
  void tick();
}

/**
 * Registers or removes the app from Windows startup.
 *
 * ★ ONLY ONCE THEY HAVE OPTED IN ★
 *
 * Gated on `enabled` as well as `autoStart`, so an app that has been installed but never given
 * permission to send does not quietly add itself to the member's startup. Being installed is not
 * consent, and neither is being opened once.
 *
 * ★ MINIMISED, AND THAT IS THE POINT ★
 *
 * `--hidden` means it starts to the tray rather than throwing a window in somebody's face every
 * time they boot. An app that demands attention at login is an app that gets removed from startup.
 *
 * Called on every relevant change rather than once: Electron writes the registry entry, and the
 * member may toggle either switch at any time.
 */
function applyAutoStart(): void {
  // Windows and macOS only. Linux desktops handle this through .desktop files and Electron's
  // support there is unreliable — better to do nothing than to write something that misbehaves.
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;

  const shouldStart = config.autoStart && config.enabled && config.deviceToken !== '';

  app.setLoginItemSettings({
    openAtLogin: shouldStart,
    openAsHidden: true,
    args: ['--hidden'],
  });
}

function stopPolling(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** Sends the current state to the window, if one is open. */
function push(): void {
  window?.webContents.send('state', state());
  /*
   * ★ THE OVERLAYS, ON THE SAME SIGNAL AS THE WINDOW ★
   *
   * `push()` already means "something changed, tell the UI", and every mutation path calls it — the
   * end of every journal pass, every early return, a settings refresh, the startup dock seed, an
   * overlay layout change. So the overlays need no timer of their own: they are simply another
   * surface that gets told, and they cannot drift out of step with the window that shows the same
   * numbers.
   */
  pushOverlayData(
    buildOverlayData({
      dock: mergedDock(),
      sending,
      lastTransferAt,
      gameRunning: wasPlaying,
      hold,
      capacity: cargoCapacity,
      holdValue,
      // The two mining folds ride the same push as everything else, so the prospector panel updates
      // in the same breath as the rest rather than on a timer of its own.
      prospecting,
      refining,
      standingOrders,
      bgsSession: bgs,
      // Re-read on every push rather than cached: the config is the single record of what was
      // picked, and a cached copy is one more thing that can disagree with it.
      tradePicks: readTradePlan(config.tradePlan ?? null),
      tradeOrigin: readPlanOrigin(config.tradePlan ?? null),
      // The hub's whole-project answer rides every push, so the build tracker updates the moment
      // ANYTHING changes — a journal pass, a settings refresh, or the sixty-second hub refetch.
      currentProject,
      trip,
      now: Date.now(),
    }),
  );

  /*
   * Fired and not awaited: `push()` is called from every mutation path including synchronous ones,
   * and a network round trip must never be on that path. The valuation lands on a later push, which
   * `refreshHoldValue` triggers itself.
   */
  void refreshHoldValue();
}

/** The version waiting to be installed, once one has downloaded. Null the rest of the time. */
let pendingUpdate: string | null = null;
let stopAutoUpdate: (() => void) | null = null;

/**
 * Applies a downloaded update.
 *
 * Wrapped so `auto-update.ts` stays free of Electron imports and can be unit tested — the rule
 * about WHEN to install is the part worth testing, and it lives there.
 */
function autoUpdaterQuitAndInstall(): void {
  // `isSilent`, `isForceRunAfter`: install without a wizard, and come back up sending afterwards.
  void import('electron-updater').then(({ autoUpdater }) => autoUpdater.quitAndInstall(true, true));
}

/**
 * Where the commander is, live pass merged with the startup seed.
 *
 * Named rather than inlined because BOTH the window and the overlays ask, and two copies of a
 * merge rule is two chances for the app to tell somebody two different things about where they are.
 */
function mergedDock(): DockedAt | null {
  return mergeDock(dockedAt, seededDock, departedDock);
}

function state(): Record<string, unknown> {
  return {
    paired: config.deviceToken !== '',
    /*
     * ★ THE MOMENT A DELIVERY REACHED THE HUB ★
     *
     * Sent to the window so the colonisation pages can refresh the instant cargo is handed over,
     * rather than waiting out a poll. Squadron owner, 2026-08-03: a stale needs list "can cause
     * someone to buy materials when they may not be needed" — which is a wasted evening, not a
     * cosmetic problem.
     */
    lastTransferAt,
    linking,
    activity,
    linkCode: activeLink?.code ?? null,
    linkUrl: activeLink?.verifyUrl ?? null,
    tokenHint: redactToken(config.deviceToken),
    enabled: config.enabled,
    autoStart: config.autoStart,
    /*
     * The overlay arrangement, and whether it can actually be drawn over the game.
     *
     * `displayNote` is null whenever everything works — the settings panel shows it only when there
     * is something to say, because a line that always appears is a line nobody reads on the day it
     * matters.
     */
    /*
     * ★ WHERE THEY ARE DOCKED, FOR THE PROJECT FORM ★
     *
     * Squadron owner, 2026-08-02: "it should appear automatically in the companion app on the new
     * project page if it is not being used please!"
     *
     * Gated on `isFresh`. The app may have been closed for days with a `Docked` as the last thing
     * it saw, and pre-filling a form with a station somebody left on Tuesday creates a project
     * pointing at the wrong construction site — which then silently never updates, because the
     * market id is what a journal event matches on. A stale answer here is worse than none.
     */
    dockedAt: (() => {
      /*
       * The live pass knows WHERE and WHAT; the startup seed knows what it is CALLED. Merged on a
       * matching market id, so the form gets a name even when the only thing arriving is a depot
       * heartbeat that carries none.
       */
      const merged = mergeDock(dockedAt, seededDock, departedDock);
      return isFresh(merged, Date.now()) ? merged : null;
    })(),
    overlays: config.overlays,
    miningSettings: config.miningSettings ?? null,
    overlayEditing: isEditing(),
    displayMode: currentMode(),
    displayNote: explain(currentMode()),
    /** Set once an update has downloaded and is waiting for the game to close. */
    pendingUpdate,
    /*
     * Whether startup registration is even possible here. Linux desktops handle it through
     * .desktop files and Electron's support is unreliable, so the panel hides the switch rather
     * than offering one that quietly does nothing.
     */
    autoStartSupported: process.platform === 'win32' || process.platform === 'darwin',
    apiBaseUrl: apiBaseUrlFor(config, process.env),
    journalPathOverride: config.journalPathOverride,
    running: timer !== null,
    searching,
    journalPath: config.journalPathOverride ?? config.discoveredJournalPath,
    last: lastOutcome,
    /*
     * ★ THE STATUS PAGE READS THESE TWO AT THE TOP LEVEL ★
     *
     * `wasPlaying` is the combined verdict the tick already computes — journal growth OR the
     * process check with a fresh journal or a live Status.json. It existed only inside the
     * overlay payload, so the Status page's "Elite is running." line could never render and its
     * problem banner never appeared. The renderer reads `state.gameRunning` and `state.error`;
     * publishing anything less leaves the page lying about a game that is demonstrably up.
     */
    gameRunning: wasPlaying,
    error: lastOutcome?.error ?? null,
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
     * ★ THE MANDATORY FRONTIER STEP — SQUADRON OWNER, 2026-08-15 ★
     *
     * "after a member connects with discord and connects the app ... they are then given the login
     * with frontier, this is a manditory step"
     *
     * Published as a verdict rather than as raw facts, so the window has nothing to decide. Every
     * rule about WHEN somebody is stopped — and the several cases where they deliberately are not —
     * lives in `frontier-gate.ts` next to the reasoning and the tests, rather than being spelled
     * out again in JSX where it cannot be exercised.
     *
     * Recomputed on every push, never stored. That is what makes an existing paired member and a
     * fresh install behave identically the moment this build lands.
     */
    frontier: currentFrontierGate(),
    /*
     * The same facts, read for the settings page rather than for the door.
     *
     * The gate goes quiet the moment it decides to let somebody through — `pass` carries no
     * sentence and no days — so the Frontier tab cannot be built from it. Both are derived from
     * one set of inputs by one module, which is the point: the tab and the gate can never end up
     * describing different links.
     */
    frontierAccount: currentFrontierAccount(),
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

/**
 * Whether the window should be showing the Frontier step, and in which words.
 *
 * ★ EVERY INPUT COMES FROM THE HUB OR FROM THIS SESSION ★
 *
 * `config` supplies exactly one thing — whether there is a device token, which is what makes the
 * question askable at all — and nothing about Frontier is read from disk or written to it. The
 * owner's requirement that "existing members who already paired must see this on update" is only
 * satisfiable that way: any remembered "already done" would be this machine's opinion about a fact
 * that lives on the hub, and it would go on being believed after a grant was revoked.
 */
/**
 * The same question the gate asks, answered for somebody who came looking on purpose.
 *
 * Shares `gateInputs()` rather than re-reading `config` and `hubSettings`, so there is no way for
 * the tab to describe a link the gate has already judged differently.
 */
function currentFrontierAccount(): FrontierAccount {
  return frontierAccount(gateInputs());
}

function gateInputs(): GateInput {
  return {
    paired: config.deviceToken !== '',
    /*
     * Has the hub answered AT ALL this launch — not what it said. `hubSettings` starts null and is
     * KEPT across a later failure, which is precisely the distinction the gate needs: never
     * answered is an outage, answered-without-the-field is a hub too old to be asked.
     */
    answered: hubSettings !== null,
    link: hubSettings?.frontier,
    error: hubError,
  };
}

function currentFrontierGate(): FrontierGate {
  return frontierGate(gateInputs());
}

/**
 * The fast poll that runs while the member is away in their browser.
 *
 * ★ IT LIVES HERE, NOT IN THE WINDOW ★
 *
 * The member can close the window mid-flow — it is a tray app and closing it is the normal thing to
 * do with it. A timer in the renderer would die with the page and the gate would still be standing
 * when they came back, having missed the moment it cleared.
 *
 * ★ AND IT STOPS ★
 *
 * `device-link.ts` earned this rule: "A poll loop with no exit is how an app ends up hammering an
 * endpoint forever because somebody closed the browser tab." Three things end it — the link
 * arriving, the ceiling passing, and the device being unpaired underneath it. Pressing Connect
 * again while one is already running extends the deadline rather than starting a second timer.
 */
let frontierWatch: NodeJS.Timeout | null = null;
let frontierWatchUntil = 0;

function stopWatchingFrontier(): void {
  if (frontierWatch === null) return;
  clearInterval(frontierWatch);
  frontierWatch = null;
}

function watchFrontier(): void {
  frontierWatchUntil = Date.now() + FRONTIER_WATCH_MS;
  if (frontierWatch !== null) return;

  frontierWatch = setInterval(() => {
    if (
      Date.now() > frontierWatchUntil ||
      config.deviceToken === '' ||
      hubSettings?.frontier?.linked === true
    ) {
      stopWatchingFrontier();
      return;
    }
    /*
     * Forced past the five-minute cache, which is the entire point: the member has just changed
     * something on our side of the world and a cached answer would be a gate that stays shut for
     * minutes after they cleared it. That is the same reasoning the `refreshSettings` button was
     * written with, on a timer instead of a press.
     */
    void refreshHubSettings(true);
  }, FRONTIER_POLL_MS);
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
    /*
     * ★ RESIZED FOR THE NAVIGATION — SQUADRON OWNER, 2026-08-02 ★
     *
     * "change the app window size if needed please!"
     *
     * 620 wide was right for one column of status. It is not right for a 212px sidebar plus a
     * colonisation board with a shopping list in it, which was being squeezed into ~390px.
     *
     * `minWidth` matters as much as the default: below about 900 the three-column stat rows wrap
     * into something unreadable, and a member who drags the window narrow should hit a floor rather
     * than discover a broken layout.
     */
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    /*
     * ★ THE FIRST FRAME, BEFORE ANY CSS EXISTS ★
     *
     * Chromium paints one frame with its own default background before index.html's styles land.
     * Unset, that default is WHITE — a full-screen flash on every single launch of an application
     * that is otherwise near-black. One line, and it is the difference between a window that
     * appears and a window that blinks at you first.
     */
    backgroundColor: '#05070a',
    /*
     * ★ THE VERSION IN THE TITLE BAR — squadron owner, 2026-08-01 ★
     *
     * "can we add the companion app version number to the topbar of the electron app please?"
     *
     * From `app.getVersion()`, which reads package.json — never a string written here. A hardcoded
     * number would go on claiming to be the current version after every release, which is exactly
     * the question a member is answering when they look at a title bar to report a problem.
     */
    title: `Grim's Squad Companion — v${app.getVersion()}`,
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

  /*
   * ★ THE DOCUMENT DOES NOT GET TO NAME THE WINDOW ★
   *
   * `BrowserWindow({ title })` only holds until the page loads: Electron then adopts the document's
   * own `<title>`, and index.html had one. So the version was set correctly and immediately
   * replaced by "Grim's Squad Hub" — the title bar looked untouched and nothing was wrong with the
   * value.
   *
   * Preventing the default keeps the title the one built from `app.getVersion()`, which is the
   * whole point: a member reading their version off the title bar must be reading what is actually
   * installed, and the HTML cannot interpolate that.
   */
  window.on('page-title-updated', (event) => {
    event.preventDefault();
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
  // Stops the update timers. Without it they keep firing while the process is tearing down, and
  // an update check that resolves after teardown throws into a context with nothing to catch it.
  stopAutoUpdate?.();
  stopAutoUpdate = null;
  /*
   * The overlays are NOT children of the main window — deliberately, so they survive it being
   * closed to the tray. That means nothing else closes them, and a transparent always-on-top window
   * left behind after the app quits is a rectangle over somebody's game that they cannot get rid of
   * without Task Manager.
   */
  stopOverlays();
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
    applyAutoStart();

    /*
     * The overlays.
     *
     * Started before the window, because they are independent of it: the main window lives in the
     * tray and is closed almost always, which is precisely when the overlays need to be up. Nothing
     * opens unless the member has switched one on — `defaultLayout` has them all off.
     */
    /*
     * Recovers where the member is docked from the journal we have already read past. Deliberately
     * NOT awaited: it is a convenience for one form, and blocking the window on a half-megabyte
     * read would make every launch feel slower to everyone who is not posting a project.
     */
    void seedDock().then(() => push());

    /*
     * ★ THE CURRENT BUILD'S OWN CLOCK — DELIBERATELY NOT INSIDE tick() ★
     *
     * The journal poll runs only while sending is enabled; the build overlay must follow the
     * member's current build even when sending is paused, because pausing uploads is not a
     * statement about wanting the tracker dark. Sixty seconds, because the numbers move on OTHER
     * members' hauling — this machine's own deliveries arrive through the depot heartbeat, which
     * the panel already prefers when docked at the site. `refreshCurrentProject` answers without a
     * request while unpaired, so the idle cost is nothing.
     */
    setInterval(() => void refreshCurrentProject(), CURRENT_BUILD_MS);
    void refreshCurrentProject();

    /*
     * The standing orders, on the same footing and for the same reason: they change when an officer
     * changes them, never because of anything this machine did, and the faction orders panel is
     * worthless if it is showing last week's target.
     */
    setInterval(() => void refreshStandingOrders(), STANDING_ORDERS_MS);
    void refreshStandingOrders();

    /*
     * ★ THE HUB IS ASKED EVEN WHILE SENDING IS PAUSED ★
     *
     * `refreshHubSettings` was reachable only from `tick()`, and `tick()` runs only while
     * `config.enabled`. That was survivable while its answer merely populated a settings panel. It
     * is not survivable now that the same answer decides whether the window opens at all: a member
     * who had pressed Pause would never be told anything, and the Frontier gate would sit on
     * "checking" for the rest of the session with nothing on screen that could resolve it.
     *
     * Its own clock, for the same reason the current build and the standing orders have theirs —
     * pausing uploads is not a statement about wanting the rest of the app dark. TTL-guarded
     * inside, so on a machine that is also ticking this costs nothing.
     */
    setInterval(() => void refreshHubSettings(), HUB_SETTINGS_TTL_MS);
    void refreshHubSettings();

    startOverlays({
      layout: () => config.overlays,
      save: (overlays) => {
        config = { ...config, overlays };
        saveConfig(app.getPath('userData'), config);
      },
      // Re-renders the settings panel, so a panel dragged over the game updates its coordinates in
      // the app without the member having to reopen anything.
      changed: () => push(),
    });

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
     * ★ THE OVERLAY CONTROLS ★
     *
     * Squadron owner, 2026-08-02: "make nice professional editable and lockable overlays for our
     * modules etc."
     *
     * `setOverlays` carries the whole layout rather than a field at a time. The renderer edits a
     * copy and sends it back, which means there is one validation point (`normaliseLayout`) instead
     * of one per property, and no way to construct a partially-applied arrangement.
     */
    /*
     * ★ COLONISATION, PROXIED THROUGH THE MAIN PROCESS ★
     *
     * Squadron owner, 2026-08-02: "full interaction with colonization either from the website or
     * from the app."
     *
     * The renderer never sees the device token and never calls the hub itself. It asks for a
     * project list; the main process attaches the credential. That keeps the token in one place —
     * the same reasoning as the preload bridge being a named list rather than a passthrough.
     */
    const hub = (): { apiBaseUrl: string; deviceToken: string } => ({
      apiBaseUrl: apiBaseUrlFor(config, process.env),
      deviceToken: config.deviceToken,
    });

    ipcMain.handle('colonyProjects', () => colonyProjects(hub()));
    // Where the commander is, for the Status page. The hub decides it so the app and the website
    // cannot disagree — see hub-commander.ts.
    ipcMain.handle('commanderLocation', () => commanderLocation(hub()));
    ipcMain.handle('bountyBoard', () => bountyBoard(hub()));
    ipcMain.handle('bountyNoMarket', (_e, stationKey: unknown) =>
      reportNoMarket(hub(), typeof stationKey === 'string' ? stationKey : ''),
    );
    ipcMain.handle('tradeCommodity', (_e, name: unknown, query: unknown) => {
      if (typeof name !== 'string' || name === '') {
        return { ok: false as const, error: 'No commodity asked for.' };
      }
      const q = (query ?? {}) as Record<string, unknown>;
      const clean: Record<string, string> = {};
      for (const k of ['near', 'withinLy', 'carriers', 'largePad', 'minQty', 'freshDays', 'hours']) {
        const v = q[k];
        if (typeof v === 'string') clean[k] = v;
      }
      return tradeCommodity(hub(), name, clean);
    });
    /*
     * Scouting. Renderer args re-read rather than trusted, like every handler in this block: only
     * strings pass, and the hub clamps the range regardless.
     */
    ipcMain.handle('bgsOrders', () => fetchStandingOrders(hub()));
    ipcMain.handle('opsBoard', () => opsBoard(hub()));
    ipcMain.handle('opsSignUp', (_e, id: unknown, state: unknown) =>
      typeof id === 'string' && (state === 'yes' || state === 'maybe' || state === 'no')
        ? opsSignUp(hub(), id, state)
        : Promise.resolve({ ok: false as const, error: 'Say yes, maybe or no.' }),
    );
    ipcMain.handle('opsWithdraw', (_e, id: unknown) =>
      typeof id === 'string'
        ? opsWithdraw(hub(), id)
        : Promise.resolve({ ok: false as const, error: 'Which op?' }),
    );

    ipcMain.handle('scoutSearch', (_e, anchor: unknown, range: unknown, prefer: unknown) =>
      typeof anchor === 'string' && anchor.trim() !== ''
        ? scoutSystems(hub(), anchor.trim(), {
            ...(typeof range === 'string' ? { range } : {}),
            ...(typeof prefer === 'string' ? { prefer } : {}),
          })
        : Promise.resolve({ ok: false as const, error: 'Name a system to search around.' }),
    );
    ipcMain.handle('scoutSurvey', (_e, system: unknown) =>
      typeof system === 'string' && system.trim() !== ''
        ? surveySystem(hub(), system.trim())
        : Promise.resolve({ ok: false as const, error: 'Name a system to survey.' }),
    );

    /*
     * ★ THE SAME SAVED SYSTEMS AS THE WEBSITE ★
     *
     * Seven boxes in this app ask for a system and seven more do on the site. They share one table
     * and one ranking, because a member who pins something in the browser and cannot find it here
     * would rightly stop trusting the star.
     *
     * `systemsUse`, `systemsPin` and `systemsUnpin` all resolve regardless of what the hub says:
     * remembering a system must never be able to fail the search that prompted it.
     */
    ipcMain.handle('systemsSaved', () => fetchSavedSystems(hub()));
    ipcMain.handle('systemsUse', async (_e, system: unknown, id64: unknown) => {
      if (typeof system !== 'string' || system.trim() === '') return { ok: true as const };
      await recordSystemUsed(hub(), system.trim(), typeof id64 === 'string' ? id64 : null);
      return { ok: true as const };
    });
    ipcMain.handle('systemsPin', async (_e, system: unknown, label: unknown) => {
      if (typeof system !== 'string' || system.trim() === '') return { ok: true as const };
      await pinSystem(hub(), system.trim(), typeof label === 'string' ? label : null);
      return { ok: true as const };
    });
    ipcMain.handle('systemsUnpin', async (_e, system: unknown) => {
      if (typeof system !== 'string' || system.trim() === '') return { ok: true as const };
      await unpinSystem(hub(), system.trim());
      return { ok: true as const };
    });

    ipcMain.handle('shipyardShips', () => shipyardShips(hub()));
    ipcMain.handle('shipyardOutfit', (_e, shipId: unknown) =>
      typeof shipId === 'string' && shipId !== ''
        ? shipyardOutfit(hub(), shipId)
        : { ok: false as const, error: 'No ship asked for.' },
    );
    ipcMain.handle('shipyardFit', (_e, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      return shipyardFit(hub(), {
        role: typeof b['role'] === 'string' ? b['role'] : '',
        ...(typeof b['budget'] === 'number' && Number.isFinite(b['budget'])
          ? { budget: b['budget'] }
          : {}),
        ...(typeof b['shipId'] === 'string' && b['shipId'] !== '' ? { shipId: b['shipId'] } : {}),
      });
    });
    ipcMain.handle('shipyardBuilds', (_e, scope: unknown) =>
      shipyardBuilds(
        hub(),
        scope === 'mine' || scope === 'squadron' ? scope : 'public',
      ),
    );
    ipcMain.handle('shipyardBuild', (_e, token: unknown) =>
      typeof token === 'string' && token !== ''
        ? shipyardBuild(hub(), token)
        : { ok: false as const, error: 'No build asked for.' },
    );
    ipcMain.handle('shipyardSave', (_e, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      return shipyardSave(hub(), {
        build: b['build'],
        buildName: typeof b['buildName'] === 'string' && b['buildName'].trim() !== '' ? b['buildName'] : null,
        visibility: typeof b['visibility'] === 'string' ? b['visibility'] : '',
      });
    });
    ipcMain.handle('tradeCommodities', (_e, near: unknown) =>
      tradeCommodities(hub(), typeof near === 'string' ? near : undefined),
    );
    /*
     * Recruiting. No arguments and nothing to sanitise — the hub identifies the member from the
     * device token, so there is nothing the renderer could pass that would change whose link this
     * is. That is the point of routing it through the main process rather than letting a page hold
     * the token.
     */
    ipcMain.handle('recruitStatus', () => recruitStatus(hub()));
    ipcMain.handle('recruitMint', () => mintInvite(hub()));

    ipcMain.handle('tradeRoutes', (_e, query: unknown) => {
      /*
       * Re-read rather than trusted, like every renderer-supplied value: only known keys pass,
       * and only as strings — the hub does its own clamping, but a number arriving as an object
       * would still become "[object Object]" in a query string without this.
       */
      const q = (query ?? {}) as Record<string, unknown>;
      const clean: Record<string, string> = {};
      for (const k of ['near', 'cargo', 'buyWithinLy', 'sellWithinLy', 'budget', 'commodity', 'sort']) {
        const v = q[k];
        if (typeof v === 'string') clean[k] = v;
      }
      return tradeRoutes(hub(), clean as TradeQuery);
    });
    ipcMain.handle('bountyLeaderboard', (_e, month: unknown) =>
      bountyLeaderboard(hub(), typeof month === 'string' && month !== '' ? month : undefined),
    );
    /*
     * ★ THE SUPPORT CONSOLE, FOR SUPPORT_AGENT HOLDERS ★
     *
     * The hub decides who that is — the app only asks. `supportAccess` is the sidebar's
     * non-throwing question; everything else refuses in a sentence when the member's rank
     * cannot work the console. Renderer args are re-read, never trusted, like every handler
     * in this block.
     */
    ipcMain.handle('supportAccess', () => supportAccess(hub()));
    ipcMain.handle('supportBadge', () => supportBadge(hub()));
    ipcMain.handle('supportConversations', (_e, status: unknown) =>
      supportConversations(hub(), status === 'closed' ? 'closed' : 'open'),
    );
    ipcMain.handle('supportConversation', (_e, id: unknown) =>
      typeof id === 'string' && id !== ''
        ? supportConversation(hub(), id)
        : { ok: false as const, error: 'No conversation asked for.' },
    );
    ipcMain.handle('supportReply', (_e, id: unknown, body: unknown) =>
      typeof id === 'string' && id !== '' && typeof body === 'string' && body.trim() !== ''
        ? supportReply(hub(), id, body)
        : { ok: false as const, error: 'Write a message first.' },
    );
    ipcMain.handle('supportClose', (_e, id: unknown) =>
      typeof id === 'string' && id !== ''
        ? supportClose(hub(), id)
        : { ok: false as const, error: 'No conversation asked for.' },
    );
    ipcMain.handle('supportReopen', (_e, id: unknown) =>
      typeof id === 'string' && id !== ''
        ? supportReopen(hub(), id)
        : { ok: false as const, error: 'No conversation asked for.' },
    );
    /*
     * ★ THE HELP WIDGET — THE ASKING SIDE, FOR EVERY PAIRED MEMBER ★
     *
     * The website widget's member door over the device token; the hub scopes every read to the
     * member behind it. No permission gate here or on the hub — asking for help is for
     * everybody, which is the entire point of a help door. Renderer args are re-read, never
     * trusted, like every handler in this block.
     */
    ipcMain.handle('helpConversations', () => helpConversations(hub()));
    ipcMain.handle('helpStart', (_e, subject: unknown, body: unknown) =>
      typeof body === 'string' && body.trim() !== ''
        ? helpStart(hub(), typeof subject === 'string' ? subject : '', body)
        : { ok: false as const, error: 'Write your question first.' },
    );
    ipcMain.handle('helpConversation', (_e, id: unknown) =>
      typeof id === 'string' && id !== ''
        ? helpConversation(hub(), id)
        : { ok: false as const, error: 'No conversation asked for.' },
    );
    ipcMain.handle('helpSend', (_e, id: unknown, body: unknown) =>
      typeof id === 'string' && id !== '' && typeof body === 'string' && body.trim() !== ''
        ? helpSend(hub(), id, body)
        : { ok: false as const, error: 'Write a message first.' },
    );
    ipcMain.handle('helpEscalate', (_e, id: unknown) =>
      typeof id === 'string' && id !== ''
        ? helpEscalate(hub(), id)
        : { ok: false as const, error: 'No conversation asked for.' },
    );
    /*
     * The leaderboards. One channel for all three boards — the key is re-read rather than trusted,
     * like every renderer-supplied value, and an unknown key is refused in a sentence instead of
     * being forwarded to the hub as a guess.
     */
    ipcMain.handle('leaderboardBoard', (_e, board: unknown, month: unknown) =>
      // 'mining' joined the list when Deep Core shipped. A key missing HERE is the failure mode
      // this guard is prone to: the page renders, the nav works, and the board refuses in a
      // sentence that reads like the hub is out of date.
      board === 'bounties' || board === 'colony' || board === 'trade' || board === 'mining'
        ? leaderboardBoard(hub(), board, typeof month === 'string' && month !== '' ? month : undefined)
        : { ok: false as const, error: 'No board asked for.' },
    );

    /*
     * Mining. Rings and sessions are plain reads; the valuation carries the hold, which is folded
     * from the journal on THIS machine and so is known here before it is known anywhere else.
     */
    ipcMain.handle('miningRings', (_e, material: unknown, days: unknown) =>
      miningRings(
        hub(),
        typeof material === 'string' && material !== '' ? material : undefined,
        typeof days === 'number' && Number.isFinite(days) ? days : 14,
      ),
    );
    ipcMain.handle('miningSessions', () => miningSessions(hub()));
    ipcMain.handle('miningValuation', (_e, hold: unknown, system: unknown, withinLy: unknown) => {
      /*
       * Re-read rather than trusted, like every renderer-supplied value. A tonnage arriving as a
       * string would reach the hub as a hold it cannot price, and the member would be told their
       * cargo is worth nothing — an answer they would believe.
       */
      const raw = (hold ?? {}) as Record<string, unknown>;
      const clean: Record<string, number> = {};
      for (const [name, tonnes] of Object.entries(raw)) {
        if (typeof tonnes === 'number' && Number.isFinite(tonnes) && tonnes > 0) {
          clean[name] = tonnes;
        }
      }
      return miningValuation(
        hub(),
        clean,
        typeof system === 'string' && system !== '' ? system : null,
        typeof withinLy === 'number' && Number.isFinite(withinLy) ? withinLy : 100,
      );
    });
    ipcMain.handle('colonyProject', (_e, id: unknown, filters: unknown) => {
      if (typeof id !== 'string' || id === '') {
        return { ok: false as const, error: 'No project asked for.' };
      }

      /*
       * Re-read rather than trusted. The renderer is the only caller today, but it is also the
       * surface a rendering bug reaches, and a radius arriving as a string would become NaN in a
       * query the hub uses to bound a search.
       */
      const f = (filters ?? {}) as Record<string, unknown>;
      const sort = f['sort'];
      return colonyProject(hub(), id, {
        near: typeof f['near'] === 'string' ? f['near'] : '',
        withinLy:
          typeof f['withinLy'] === 'number' && Number.isFinite(f['withinLy'])
            ? f['withinLy']
            : DEFAULT_SHOPPING.withinLy,
        sort: sort === 'cheapest' || sort === 'closest' ? sort : 'local',
        largePadOnly: f['largePadOnly'] === true,
      });
    });
    ipcMain.handle('colonyAt', (_e, marketId: unknown) =>
      typeof marketId === 'string' && marketId !== ''
        ? colonyAtMarket(hub(), marketId)
        : { ok: false as const, error: 'No construction site asked for.' },
    );
    /*
     * The roster. Same shape as everything else here: the renderer names a project and the main
     * process attaches the credential, so the device token never reaches the page.
     */
    const projectId = (v: unknown): string => (typeof v === 'string' ? v : '');

    /*
     * The build catalogue. Squadron owner, 2026-08-03: "ensure the Companion app matches and has all
     * the same pages in colonization that the website has please! must be a mirror!"
     */
    ipcMain.handle('colonyBuildTypes', () => colonyBuildTypes(hub()));
    ipcMain.handle('colonyBuildType', (_e, id: unknown, near: unknown) =>
      colonyBuildType(hub(), projectId(id), typeof near === 'string' ? near : ''),
    );

    /*
     * ★ THE SHOPPING ROUTE — SQUADRON OWNER, 2026-08-10 ★
     *
     * "so we dont have people buying duplicte materials etc and showing up and they already exist".
     * Every rule that produces the route — no carriers, this build's outstanding materials only,
     * each one named at a single stop — is applied by the hub, so this app and the website cannot
     * give two answers to a question that has one.
     */
    /*
     * Station ownership. Officer-only at the hub, which is where the decision belongs — these
     * handlers pass through and let the refusal come back as a sentence rather than pre-judging it
     * from a rights flag this process may be holding a stale copy of.
     */
    ipcMain.handle('colonyStationClaims', () => colonyStationClaims(hub()));
    ipcMain.handle('colonyClaimStation', (_e, body: unknown) => {
      const raw = (body ?? {}) as Record<string, unknown>;
      return colonyClaimStation(hub(), {
        stationName: typeof raw['stationName'] === 'string' ? raw['stationName'] : '',
        systemName: typeof raw['systemName'] === 'string' ? raw['systemName'] : '',
        // Narrowed here as well as at the hub: the renderer must not be able to send a third value
        // that stores cleanly and ranks as unowned.
        ownership: raw['ownership'] === 'member' ? 'member' : 'squadron',
        ...(typeof raw['note'] === 'string' && raw['note'].trim() !== ''
          ? { note: raw['note'] }
          : {}),
      });
    });
    ipcMain.handle('colonyWithdrawStationClaim', (_e, key: unknown) =>
      colonyWithdrawStationClaim(hub(), typeof key === 'string' ? key : ''),
    );

    ipcMain.handle('colonyPurchases', (_e, id: unknown, order: unknown) =>
      /*
       * Anything that is not the string 'closest' becomes undefined, and the hub then applies its
       * own default. The renderer cannot smuggle a third ordering through here, and a stale build
       * of the window sending nothing behaves exactly as it did before the toggle existed.
       */
      colonyPurchases(hub(), projectId(id), order === 'closest' ? 'closest' : undefined),
    );
    ipcMain.handle('colonyPlanReview', (_e, id: unknown) => colonyPlanReview(hub(), projectId(id)));
    // Advice about a SYSTEM rather than a plan, so it takes a name and not an id.
    ipcMain.handle('colonySystemAdvice', (_e, systemName: unknown) =>
      colonySystemAdvice(hub(), typeof systemName === 'string' ? systemName : ''),
    );
    ipcMain.handle('colonyDraftLayout', (_e, systemName: unknown) =>
      colonyDraftLayout(hub(), typeof systemName === 'string' ? systemName : ''),
    );
    ipcMain.handle('colonyDeclarePurchase', (_e, id: unknown, body: unknown) =>
      colonyDeclarePurchase(
        hub(),
        projectId(id),
        (body ?? {}) as Parameters<typeof colonyDeclarePurchase>[2],
      ),
    );

    ipcMain.handle('colonyRoster', (_e, id: unknown) => colonyRoster(hub(), projectId(id)));
    ipcMain.handle('colonyJoin', (_e, id: unknown) => colonyJoin(hub(), projectId(id)));
    ipcMain.handle('colonyLeave', (_e, id: unknown) => colonyLeave(hub(), projectId(id)));

    /*
     * ★ THE CURRENT BUILD — SQUADRON OWNER, 2026-08-04 ★
     *
     * Marking a build as "mine right now" is what keeps the build overlay populated wherever the
     * member flies. The hub holds the choice; on success the cached copy is refreshed IMMEDIATELY
     * rather than waiting out the sixty-second clock, because a member who just pressed the toggle
     * is looking at the overlay to see it change.
     */
    ipcMain.handle('colonySetCurrent', async (_e, id: unknown) => {
      const answer = await colonySetCurrent(hub(), projectId(id));
      if (answer.ok) await refreshCurrentProject();
      return answer;
    });
    ipcMain.handle('colonyClearCurrent', async (_e, id: unknown) => {
      const answer = await colonyClearCurrent(hub(), projectId(id));
      if (answer.ok) {
        // Cleared is knowledge, not a failed fetch — dropped at once, then confirmed by a refetch
        // so a build marked from another device is picked up rather than left blank.
        currentProject = null;
        push();
        await refreshCurrentProject();
      }
      return answer;
    });

    ipcMain.handle('colonyAssign', (_e, id: unknown, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      return colonyAssign(hub(), projectId(id), {
        commodity: typeof b['commodity'] === 'string' ? b['commodity'] : '',
        // Omitted rather than sent as undefined: the hub reads a missing `userId` as "me", which is
        // the common case and one fewer value the app can get wrong about its own identity.
        ...(typeof b['tonnes'] === 'number' ? { tonnes: b['tonnes'] } : {}),
        ...(typeof b['userId'] === 'string' && b['userId'] !== '' ? { userId: b['userId'] } : {}),
      });
    });

    ipcMain.handle('colonyUnassign', (_e, id: unknown, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      return colonyUnassign(hub(), projectId(id), {
        commodity: typeof b['commodity'] === 'string' ? b['commodity'] : '',
        ...(typeof b['userId'] === 'string' && b['userId'] !== '' ? { userId: b['userId'] } : {}),
      });
    });

    ipcMain.handle('colonyPost', (_e, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      const text = (k: string): string => (typeof b[k] === 'string' ? (b[k] as string) : '');
      return postColonyProject(hub(), {
        owner: b['owner'] === 'squadron' ? 'squadron' : 'personal',
        marketId: text('marketId'),
        systemName: text('systemName'),
        stationName: text('stationName'),
        title: text('title'),
        notes: text('notes'),
      });
    });


    /*
     * ★ THE PLANNER — SQUADRON OWNER, 2026-08-03 ★
     *
     * "ensure the Companion app matches and has all the same pages in colonization that the website
     * has please! must be a mirror!"
     *
     * Every argument is re-read here rather than trusted. The renderer is the only caller today,
     * but it is also the surface a rendering bug reaches — and a body id arriving as a string would
     * become NaN in a column the tree nests by.
     */
    const asNum = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

    /*
     * Fleet carriers. Squadron owner, 2026-08-02: "we also need a way to add fleet carriers to the
     * project like raven colonial does", and "squadron carriers too".
     */
    /*
     * Closing, reopening, deleting and flagging the current effort. The hub decides whether this
     * member may — the app only asks.
     */
    ipcMain.handle('colonyClose', (_e, id: unknown) => colonyClose(hub(), projectId(id)));
    ipcMain.handle('colonyReportBuilt', (_e, id: unknown) =>
      colonyReportBuilt(hub(), projectId(id)),
    );
    ipcMain.handle('colonyReopen', (_e, id: unknown) => colonyReopen(hub(), projectId(id)));
    ipcMain.handle('colonyRemove', (_e, id: unknown) => colonyRemove(hub(), projectId(id)));
    ipcMain.handle('colonyPriority', (_e, id: unknown, on: unknown) =>
      colonyPriority(hub(), projectId(id), on === true),
    );
    ipcMain.handle('colonyAbandoned', (_e, id: unknown, on: unknown, note: unknown) =>
      colonyAbandoned(
        hub(),
        projectId(id),
        // `on === true` like the line above: anything else arriving over IPC must not read as
        // "abandon it", and a renderer bug should fail closed rather than take a build off the board.
        on === true,
        typeof note === 'string' ? note : undefined,
      ),
    );

    ipcMain.handle('colonyCarriers', (_e, id: unknown, q: unknown) =>
      colonyCarrierSearch(hub(), projectId(id), typeof q === 'string' ? q : ''),
    );
    /*
     * ★ THE COMBINED RUN — SQUADRON OWNER, 2026-08-09 ★
     *
     * Keyed on the CARRIER rather than a project, which is why it takes no project id: a carrier
     * holds one hold, and the whole point is to subtract it once across every build it serves
     * rather than once per build.
     */
    ipcMain.handle('colonyCarrierManifest', (_e, marketId: unknown, opts: unknown) => {
      const o = (opts ?? {}) as Record<string, unknown>;
      return colonyCarrierManifest(hub(), typeof marketId === 'string' ? marketId : '', {
        ...(typeof o['near'] === 'string' ? { near: o['near'] } : {}),
        ...(typeof o['withinLy'] === 'number' ? { withinLy: o['withinLy'] } : {}),
        ...(o['largePad'] === true ? { largePad: true } : {}),
        ...(typeof o['sort'] === 'string' ? { sort: o['sort'] } : {}),
      });
    });
    ipcMain.handle('colonyCarrierAdd', (_e, id: unknown, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      return attachCarrier(hub(), projectId(id), {
        marketId: typeof b['marketId'] === 'string' ? b['marketId'] : '',
        isSquadron: b['isSquadron'] === true,
      });
    });
    ipcMain.handle('colonyCarrierRemove', (_e, id: unknown, marketId: unknown) =>
      detachCarrier(hub(), projectId(id), typeof marketId === 'string' ? marketId : ''),
    );
    ipcMain.handle(
      'colonyCarrierCargoSet',
      (_e, id: unknown, marketId: unknown, body: unknown) => {
        const b = (body ?? {}) as Record<string, unknown>;
        return setCarrierCargo(hub(), projectId(id), typeof marketId === 'string' ? marketId : '', {
          commodity: typeof b['commodity'] === 'string' ? b['commodity'] : '',
          // Null clears the manual figure; zero is a real figure. The distinction is the feature.
          tonnes: typeof b['tonnes'] === 'number' ? b['tonnes'] : null,
        });
      },
    );

    ipcMain.handle('colonyPlans', () => colonyPlans(hub()));
    ipcMain.handle('colonyPlan', (_e, id: unknown) =>
      asText(id) === ''
        ? { ok: false as const, error: 'No plan asked for.' }
        : colonyPlan(hub(), asText(id)),
    );

    ipcMain.handle('colonyPlanCreate', (_e, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      return createColonyPlan(hub(), {
        owner: b['owner'] === 'squadron' ? 'squadron' : 'personal',
        title: asText(b['title']),
        systemName: asText(b['systemName']),
      });
    });

    ipcMain.handle('colonyPlanSlots', (_e, systemId64: unknown, bodyId: unknown, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      // A blank field means "we do not know", which is a real answer and must survive the trip as
      // null rather than becoming zero — zero slots is a different claim entirely.
      const count = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;
      return setPlanSlots(hub(), asText(systemId64), asNum(bodyId, -1), {
        orbital: count(b['orbital']),
        surface: count(b['surface']),
      });
    });

    ipcMain.handle('colonyPlanAddSite', (_e, id: unknown, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      return addPlanSite(hub(), asText(id), {
        version: asNum(b['version'], 0),
        bodyId: typeof b['bodyId'] === 'number' ? b['bodyId'] : null,
        location: b['location'] === 'surface' ? 'surface' : 'orbital',
        buildTypeId: asText(b['buildTypeId']) === '' ? null : asText(b['buildTypeId']),
      });
    });

    ipcMain.handle('colonyPlanRemoveSite', (_e, id: unknown, siteId: unknown, version: unknown) =>
      removePlanSite(hub(), asText(id), asText(siteId), asNum(version, 0)),
    );

    ipcMain.handle('colonyPlanReorder', (_e, id: unknown, body: unknown) => {
      const b = (body ?? {}) as Record<string, unknown>;
      const raw = Array.isArray(b['siteIds']) ? (b['siteIds'] as unknown[]) : [];
      return reorderPlan(hub(), asText(id), {
        version: asNum(b['version'], 0),
        siteIds: raw.filter((v): v is string => typeof v === 'string'),
      });
    });

    ipcMain.handle('colonyPlanRemove', (_e, id: unknown) => removeColonyPlan(hub(), asText(id)));

    /*
     * The prospector thresholds. Stored as the JSON STRING the renderer sends, because
     * `readMiningSettings` repairs whatever is on disk on every read — validating here as well
     * would be two validators, and one of them would drift from the rules the overlay obeys.
     */
    /*
     * ★ THE PICKED RUN, FROM THE WINDOW TO THE OVERLAY — SQUADRON OWNER, 2026-08-06 ★
     *
     * "add an option to choose the trade route and display them in the overlay please"
     *
     * Stored as the string the config holds rather than a parsed object, exactly like the mining
     * settings: `readTradePlan` repairs whatever is there on every read, so there is one place that
     * validates instead of two that can drift.
     */
    ipcMain.handle('setTradePlan', (_e, json: unknown) => {
      if (typeof json !== 'string') return config.tradePlan ?? null;
      config = { ...config, tradePlan: json };
      void saveConfig(app.getPath('userData'), config);
      push();
      return config.tradePlan;
    });

    ipcMain.handle('setMiningSettings', (_e, json: unknown) => {
      if (typeof json !== 'string') return config.miningSettings ?? null;
      config = { ...config, miningSettings: json };
      void saveConfig(app.getPath('userData'), config);
      push();
      return config.miningSettings;
    });

    ipcMain.handle('setOverlays', (_e, layout: unknown) => {
      const applied = setLayout(layout);
      push();
      return applied;
    });

    /*
     * Arrange mode. Deliberately not persisted — see `setEditing`. An app that crashed while
     * arranging must not come back with every overlay loose over somebody's game.
     */
    ipcMain.handle('setOverlayEditing', (_e, on: unknown) => {
      setEditing(on === true);
      push();
      return true;
    });

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

    /**
     * Starts the mandatory Frontier step.
     *
     * ★ THE APP DOES NOT DO OAUTH — SQUADRON OWNER, 2026-08-15 ★
     *
     * "the primary feature must be so that players that are playing on Geforce Now and cloud
     * platforms can use the companion app like everyone else"
     *
     * This opens the member's REAL browser at our own settings page and stops there. It is the same
     * decision `device-link.ts` argues at length for the Discord sign-in, and every word of it
     * applies again: a distributed desktop application has nowhere to keep a client secret, a
     * window the app controls asking for credentials is the habit phishing depends on, and a
     * loopback redirect can be raced by anything else on the machine.
     *
     * So the ceremony happens where the member already has a session, in a window with an address
     * bar, and the PKCE verifier, the code and both tokens live and die on the hub. The app learns
     * one boolean, afterwards, over a call it was already making.
     *
     * ★ THE WEBSITE, NOT THE API ★
     *
     * `POST /v1/me/capi/start` is session-authenticated and this app deliberately holds no session —
     * its whole identity is a device token, which is a far smaller credential than a cookie that can
     * act as the member anywhere on the site. Sending a device token at that route would be a 401,
     * so the browser goes to the page where the session already is and the WEBSITE calls it.
     *
     * `webBaseUrlFor` rather than `apiBaseUrlFor` for the reason recorded on `openHub`: one origin
     * serves both in production, but on a development machine the site is on :5000 and the API on
     * :5001, and building this from the API base opens a JSON 404.
     */
    ipcMain.handle('connectFrontier', () => {
      /*
       * ★ STRAIGHT TO FRONTIER — SQUADRON OWNER, 2026-08-16 ★
       *
       * "whe i click connect with frontier in the companion app it sends me to the suqadron website
       * not frontier!"
       *
       * It did, and there was nothing there to press: `capiStart` had no caller anywhere in the web
       * app, so /settings/privacy showed no Connect button at all. The member landed on a settings
       * page and was stuck behind a step this app makes MANDATORY.
       *
       * /connect/frontier starts the handshake on arrival and forwards to Frontier. The browser is
       * still where it has to happen — the authorisation URL carries a PKCE challenge the hub must
       * remember, so it can only come from a session-authenticated call, and this app holds no
       * session on purpose.
       */
      const url = `${webBaseUrlFor(config, process.env)}/connect/frontier`;
      void shell.openExternal(url);
      /*
       * The watch starts on the PRESS, not on the return. Whether the browser actually opened is
       * not something Electron reports usefully, and a member who copies the link out of the screen
       * and pastes it into another browser has done the same thing by a different route — the poll
       * must be running for them too.
       */
      watchFrontier();
      return { ok: true, url };
    });

    /*
     * ★ SIGNING IN, NOT PASTING A KEY — squadron owner, 2026-08-01 ★
     *
     * "COMPANION Discord login; remove key generator"
     *
     * This used to accept a `gsq_…` string the member had copied off the website. It now asks the
     * server for a link, opens their REAL browser at our approval page, and waits. They sign in
     * with Discord there — in a window with an address bar, in the session they already have — and
     * the app collects its token over a channel authenticated by a secret it never displayed.
     *
     * An OAuth window inside Electron would be simpler and worse: nowhere to keep a client secret,
     * and it teaches members to type their Discord password into whatever window asks.
     */
    ipcMain.handle('signIn', async () => {
      if (linking) return { ok: false, error: 'Already waiting for you to approve it in the browser.' };

      const base = apiBaseUrlFor(config, process.env);
      // The machine's own name, so the approval page can say WHICH device is asking.
      const label = hostname().slice(0, 60) || 'Companion app';

      let started;
      try {
        started = await startLink(base, label);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Could not reach the squadron site.' };
      }

      linking = true;
      linkCancelled = false;
      // Published BEFORE the browser is opened, so the code is on screen even if opening fails.
      activeLink = { code: started.code, verifyUrl: started.verifyUrl };
      push();

      // Their own browser, never an embedded one. See the note above.
      void shell.openExternal(started.verifyUrl);

      try {
        const outcome = await awaitApproval(base, started, { cancelled: () => linkCancelled });
        if (outcome.status !== 'approved') {
          const why =
            outcome.status === 'cancelled'
              ? 'Sign-in cancelled.'
              : 'That sign-in expired before it was approved. Try again.';
          return { ok: false, error: why };
        }

        /*
         * ★ SIGNING IN TURNS SENDING ON ★
         *
         * `enabled` defaults to false, from the days when pairing meant pasting a token — an act
         * that said nothing about intent, so a second deliberate switch was right.
         *
         * It is not right any more. The member has just opened their browser, signed in with
         * Discord, and pressed a button on a page that says in as many words that connecting lets
         * this app upload their journals. That IS the consent. Making them then find a Resume
         * button in the app is how somebody completes the whole flow and watches nothing happen —
         * which is exactly what was reported, with three successfully linked devices that had
         * never once checked in.
         *
         * What they switched off stays off: the server still drops any category they have opted
         * out of (INV-013), and Pause is one click away.
         */
        config = { ...config, deviceToken: outcome.token, enabled: true };
        saveConfig(app.getPath('userData'), config);
        lastOutcome = null;
        /*
         * ★ AND CLEAR THE FEED — REPORTED 2026-08-04 ★
         *
         * "even after unpairing and repairing the app to the web portal it still says this device is
         * no longer connected."
         *
         * `lastOutcome = null` already fixed the tray. The activity log was left holding every line
         * from the old pairing, including the refusal that sent the member here in the first place —
         * so the app went on displaying "no longer connected" about a device that had just been
         * connected. The lines belong to a session that has ended; keeping them is keeping an
         * explanation of a problem that no longer exists, at the top of the one panel a member
         * checks to find out whether it worked.
         */
        activity = [pairingLine('paired', Date.now())];
        // Registration follows consent, and consent has just been given.
        applyAutoStart();
        startPolling();
        // The freshly-paired member's current build, without waiting out the sixty-second clock.
        void refreshCurrentProject();
        refreshTray();
        return { ok: true };
      } finally {
        linking = false;
        activeLink = null;
        push();
      }
    });

    /** Opens the approval page again — the browser may have failed to open, or been closed. */
    ipcMain.handle('reopenLink', () => {
      if (activeLink === null) return { ok: false };
      void shell.openExternal(activeLink.verifyUrl);
      return { ok: true };
    });

    ipcMain.handle('cancelSignIn', () => {
      linkCancelled = true;
      return { ok: true };
    });

    /**
     * Re-send everything to this hub, from the beginning.
     *
     * ★ SQUADRON OWNER, 2026-08-05 ★
     *
     * "it appears that not all of my historical journal data was sent ... im wondering if my
     * development data is not being sent journal wise, if so i need all of my data sent to the
     * production environment so that it all gets counted"
     *
     * It was not, and the reason was structural: an offset recorded how far a FILE had been read
     * and said nothing about where those lines had been sent. A development run against localhost
     * advanced them, the events landed in the development database, and pointing the app at
     * grims-squad.com resumed from where development stopped. The production hub never saw a line
     * of it, and nothing reported a problem, because as far as the app was concerned the work was
     * done.
     *
     * Offsets are per-hub now, so this cannot happen again. It cannot un-happen what was already
     * skipped, which is what this door is for: forget this hub's positions and let the next pass
     * read every journal from the top.
     *
     * ★ SAFE TO PRESS TWICE ★
     *
     * The hub deduplicates on (device token, timestamp, event, payload), so a re-read costs
     * bandwidth and produces no duplicate rows. `sessionLive` goes with the offsets — it is a
     * per-file verdict derived while reading, and keeping it against files about to be re-read
     * from the top would be a stale answer to a question being asked again.
     */
    ipcMain.handle('resendHistory', () => {
      const hub = hubKey(apiBaseUrlFor(config, process.env));
      const remaining = { ...config.offsetsByHub };
      delete remaining[hub];

      config = { ...config, offsetsByHub: remaining, sessionLive: {} };
      saveConfig(app.getPath('userData'), config);

      activity = appendActivity(activity, [
        {
          at: Date.now(),
          level: 'info',
          text: 'Re-reading every journal from the start. The hub discards anything it already has.',
        },
      ]);
      // The window is showing a byte count and an activity feed that both just changed.
      push();
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
      // Unpaired means no startup entry: there is nothing for it to do at login.
      applyAutoStart();
      stopPolling();
      refreshTray();
      /*
       * Same reasoning as pairing: the log describes a connection that has just ended, and the
       * one line worth keeping is the one saying so — including the part members do not expect,
       * that the server still trusts the token until they revoke it on the website.
       */
      lastOutcome = null;
      activity = [pairingLine('unpaired', Date.now())];
      // An unpaired device holds no hub data: the build overlay must not keep drawing a project
      // read with a token the member has just told us to forget.
      currentProject = null;
      /*
       * ★ AND TELL THE WINDOW — SQUADRON OWNER, 2026-08-03 ★
       *
       * "nothing happens when i click unpair device."
       *
       * It worked. The token was cleared, written to disk, and the poll stopped — and the page was
       * never told, so it went on saying "Paired as …" over a config with no token in it. The
       * member sees a dead button, presses it again, and finds out only on the next restart that
       * they have been unpaired the whole time.
       *
       * One line, and it is the same line every other mutating handler already had.
       */
      push();
      return { ok: true };
    });

    ipcMain.handle('setAutoStart', (_e, autoStart: unknown) => {
      config = { ...config, autoStart: autoStart === true };
      saveConfig(app.getPath('userData'), config);
      applyAutoStart();
      push();
      return { ok: true };
    });

    ipcMain.handle('setEnabled', (_e, enabled: unknown) => {
      config = { ...config, enabled: enabled === true };
      saveConfig(app.getPath('userData'), config);
      // Startup registration follows consent — see `applyAutoStart`.
      applyAutoStart();
      if (config.enabled) startPolling();
      else stopPolling();
      refreshTray();
      // Same omission as `unpair` had: the switch moves, the page is not told, and it snaps back.
      push();
      return { ok: true };
    });

    /*
     * ★ THE SITE, NOT THE API — squadron owner, 2026-08-01 ★
     *
     * "the link on open the website should take us to the home page please. not the api."
     *
     * This built the URL from `apiBaseUrlFor`. In production that is harmless — one origin serves
     * both, with Caddy routing `/v1` to the API — but in development the API is on :5001 and the
     * site on :5000, so the button opened a JSON 404. It also went to a settings sub-page rather
     * than the front door.
     */
    ipcMain.handle('openHub', () => {
      void shell.openExternal(webBaseUrlFor(config, process.env));
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
      /*
       * Told immediately, not merely at the end of the pass. `tick()` is not awaited — it reads a
       * directory and can take a second or more — so without this the folder somebody just chose
       * does not appear until it finishes, and a dialog that closes with nothing changing on screen
       * reads as a dialog that did not work.
       *
       * Found by the IPC guard rather than by anybody using it, which is the point of the guard.
       */
      push();
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

    /*
     * ★ STARTED BY WINDOWS MEANS STAY IN THE TRAY ★
     *
     * `--hidden` is passed by the login-item registration. Without honouring it, the app that
     * starts itself every boot also throws a window in the member's face every boot — which is how
     * an auto-starting app gets removed from startup within a week.
     *
     * Polling still begins either way: the point of starting at login is to send, not to be seen.
     */
    /*
     * Auto-update. Downloads whenever, installs only once Elite is closed — see `auto-update.ts`.
     *
     * Started AFTER the tray and IPC exist, so `pendingUpdate` has somewhere to be displayed the
     * moment an update lands rather than being dropped on the floor during boot.
     */
    stopAutoUpdate = startAutoUpdate({
      gameRunning: async () => isGameRunning(platform(), listProcesses),
      // Read fresh each check: pairing after launch must not wait for a restart to start updating.
      deviceToken: () => config.deviceToken,
      onPending: (version) => {
        pendingUpdate = version;
        push();
        refreshTray();
      },
      /*
       * ★ THE ONE CASE WHERE THIS APP INTERRUPTS SOMEBODY ★
       *
       * Squadron owner, 2026-08-05: updates now install even mid-session, because the releases that
       * matter are the ones that fix how data is RECORDED — and a member in a twelve-hour session is
       * both the one whose data is wrong and the one a wait-for-the-game-to-close rule never
       * reaches.
       *
       * So they are told, in three places at once, and then it happens. The activity feed is the
       * durable record, the tray balloon is what reaches somebody with the window closed and the
       * game full-screen, and `push()` updates the panel if it is open. A restart nobody saw coming
       * is the thing that makes people uninstall a background app.
       */
      onForced: (version, graceMs) => {
        const seconds = Math.round(graceMs / 1000);
        activity = appendActivity(activity, [
          {
            at: Date.now(),
            level: 'warn',
            text:
              `Updating to ${version} in about ${seconds} seconds. This release changes how your ` +
              `data is recorded, so it cannot wait for you to finish. Your journal position is ` +
              `saved — nothing you have flown will be lost.`,
          },
        ]);
        pendingUpdate = version;
        push();
        refreshTray();

        /*
         * Best effort, and never allowed to throw: a balloon that fails on a stripped-down desktop
         * must not stop the update it was announcing.
         */
        try {
          tray?.displayBalloon?.({
            title: `Grim's Squad Companion — updating`,
            content: `Restarting in about ${seconds} seconds to finish updating to ${version}.`,
          });
        } catch {
          // No balloon on this platform. The feed and the panel still carry it.
        }
      },
      install: () => {
        /*
         * `isQuitting` first, or the window-close handler hides to tray instead of letting the
         * process go — and the installer would wait forever for an app that will not quit.
         */
        isQuitting = true;
        autoUpdaterQuitAndInstall();
      },
    });

    const launchedByStartup =
      process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;

    if (!launchedByStartup) showWindow();
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
