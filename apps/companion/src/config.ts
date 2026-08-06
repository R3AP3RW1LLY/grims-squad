import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultLayout, normaliseLayout, type OverlayLayout } from './overlay-config.js';

/**
 * The companion's own settings, on disk.
 *
 * ★ THE DEVICE TOKEN LIVES HERE, AND THAT IS A DECISION ★
 *
 * It is a long-lived credential sitting in a file on somebody's PC. There is no
 * honest way to make that secret from someone who already controls the machine
 * — an "encryption" key we also ship is decoration, and OS keychains are a
 * different mess on each of the three platforms we support.
 *
 * So the mitigations are the ones that actually hold:
 *
 *  - The token is scoped to `telemetry:write` and can do nothing else. Stealing
 *    it buys the ability to submit journal events as that member, not access
 *    to their account.
 *  - It is revocable per device from the website, so a lost laptop costs one
 *    token.
 *  - The file is written with 0600 where the platform honours it.
 *
 * Pretending otherwise would be worse than saying it plainly.
 */

export interface CompanionConfig {
  /**
   * The member's prospector thresholds, stored as JSON.
   *
   * A STRING rather than a nested object, deliberately: `readMiningSettings` repairs whatever is on
   * disk on every read, so a hand-edited or older-version file cannot put a NaN into the comparison
   * that decides whether a rock is worth shooting. Parsing it here would mean two places that
   * validate, and one of them would drift.
   */
  miningSettings?: string;
  /** Base URL of the hub. Configurable so a member can point at a test server. */
  apiBaseUrl: string;
  /** The pairing token. Empty until the member pairs. */
  deviceToken: string;
  /** Overrides the detected journal folder. The escape hatch for odd setups. */
  journalPathOverride: string | null;
  /**
   * Per-file byte offsets, so a restart re-reads nothing.
   *
   * ★ THEY BELONG TO A HUB, AND USED NOT TO — REPORTED 2026-08-05 ★
   *
   * "it appears that not all of my historical journal data was sent ... im wondering if my
   * development data is not being sent journal wise"
   *
   * It was not, and this field is why. An offset records how far we have read a FILE; it said
   * nothing about where those lines were sent. So a development run against localhost read the
   * journals, advanced these numbers, and delivered every event to the development database —
   * and when the app was later pointed at grims-squad.com it resumed from where development had
   * left off. The production hub never saw a line of it, and nothing anywhere reported a problem,
   * because from the app's point of view the work was done.
   *
   * (Before `productName` was set, the packaged app and a `pnpm start` run also SHARED this file,
   * which is how one member's development session could advance the offsets of their real
   * install.)
   *
   * `offsetsByHub` is the corrected shape: reading is tracked per destination, so pointing the app
   * at a different hub starts that hub from the beginning and it receives the whole history. The
   * hub deduplicates on (device token, timestamp, event, payload), so re-reading costs bandwidth
   * and never a duplicate row.
   *
   * `resetOffsets` in `main.ts` is the manual door for anybody whose history was already skipped
   * this way — the fix above prevents it happening again, and cannot undo what was missed.
   */
  offsetsByHub: Record<string, Record<string, number>>;
  /**
   * Per-file verdict on whether it is the LIVE galaxy.
   *
   * Fileheader is the first line, so a later chunk of the same file has no clue
   * which galaxy it belongs to. Persisted rather than held in memory, because a
   * restart mid-session would otherwise start sending a Legacy file's events.
   */
  sessionLive: Record<string, boolean>;
  /** Whether the member has agreed to send anything at all. */
  enabled: boolean;
  /**
   * Where the deep search found the journals, once it has run.
   *
   * Cached because the search costs seconds and the answer does not move. `null`
   * means it has not run; a path means it has and this is what it found.
   */
  discoveredJournalPath: string | null;
  /** True once the search has run and found nothing, so it is not repeated every launch. */
  searchedAndFoundNothing: boolean;
  /**
   * Start with Windows, minimised to the tray.
   *
   * ★ WHY THIS DEFAULTS ON, WHEN `enabled` DEFAULTS OFF ★
   *
   * They are different questions. `enabled` asks "may we send anything at all", and being
   * installed is not consent — so it stays off until asked. This asks "when you have said yes,
   * should you have to remember to launch it", and the honest answer is no: the whole point is an
   * app you install once and never think about again.
   *
   * It is still only ACTED ON once the member has paired and enabled sending, so an app that has
   * never been given permission does not quietly add itself to startup.
   */
  autoStart: boolean;
  /**
   * What this machine has done, for as long as it has been paired.
   *
   * ★ WHY THE APP KEEPS ITS OWN TALLY AT ALL ★
   *
   * The panel used to show the LAST PASS, which is almost always zero: the app
   * polls every twenty seconds and the game writes nothing most of those. A
   * member glancing at three zeroes concluded, reasonably, that it was broken.
   *
   * These answer "has this thing ever done anything", which is the question
   * somebody actually has. They are cumulative and survive restarts.
   *
   * ★ AND WHY IT IS NOT THE WHOLE STORY ★
   *
   * This counts what THIS PC sent. It misses a second machine, it counts an
   * event twice if a failed upload is retried, and it resets if the config is
   * lost. The authoritative number — rows actually held for the member — comes
   * from the hub, and both are shown because they answer different questions.
   */
  totals: CompanionTotals;
  /**
   * How the member has arranged their overlays.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "make nice professional editable and lockable overlays for our modules etc."
   *
   * Kept in the same file as everything else so an arrangement survives a restart, an update and a
   * machine that was switched off mid-game. The shape, the clamping and the rescue from an
   * unplugged monitor all live in `overlay-config.ts`, which is pure and tested — this file only
   * has to store it.
   */
  overlays: OverlayLayout;
  /**
   * Set ONLY when the settings file could not be read and the app started on defaults.
   *
   * Absent in the normal case, which is almost always — so the UI can treat its presence as "tell
   * the member what happened" without asking any further questions.
   *
   * ★ NEVER PERSISTED ★
   *
   * `saveConfig` strips it. It describes one startup, not a setting, and writing it back would mean
   * an app that reported a corruption it had already recovered from, for ever.
   */
  restoredFrom?: {
    readonly reason: string;
    /** True when the unreadable file was successfully moved aside and can still be recovered. */
    readonly quarantined: boolean;
  };
}

export interface CompanionTotals {
  /** Events handed to the hub, successfully, ever. */
  sent: number;
  /** Events the hub already had. Normal, and not a failure. */
  duplicates: number;
  /** DISTINCT journal files this machine has read at least one line from. */
  journalsRead: number;
  /**
   * Bytes of journal data this machine has sent and received, for all time.
   *
   * The size of the JSON bodies themselves — not headers, TLS or TCP overhead,
   * none of which is observable from inside `fetch`. See `UploadResult`.
   */
  txBytes: number;
  rxBytes: number;
  /** ISO instant of the first successful upload, or null. */
  since: string | null;
}

export const EMPTY_TOTALS: CompanionTotals = {
  sent: 0,
  duplicates: 0,
  journalsRead: 0,
  txBytes: 0,
  rxBytes: 0,
  since: null,
};

export const DEFAULT_CONFIG: CompanionConfig = {
  /*
   * ★ THE SQUADRON'S OWN ADDRESS, SINCE THE 2026-08-05 CUTOVER ★
   *
   * This was the sslip.io address the site launched on, and it kept working after the domain moved
   * because that origin is still served. But it is the wrong answer to give a member installing the
   * app today: the address they were sent to, the one on their screen, and the one the app talks to
   * should be the same, or the first confusing moment has no explanation.
   *
   * An existing install keeps whatever is in its own config file — this default is only consulted
   * when there is none, so upgrading does not move anybody.
   */
  apiBaseUrl: 'https://grims-squad.com',
  deviceToken: '',
  journalPathOverride: null,
  offsetsByHub: {},
  sessionLive: {},
  // OFF until the member turns it on. An app that starts transmitting the
  // moment it is installed has not asked, and being installed is not consent.
  enabled: false,
  discoveredJournalPath: null,
  searchedAndFoundNothing: false,
  autoStart: true,
  totals: EMPTY_TOTALS,
  // Every overlay off and locked. See `defaultLayout` for why both of those are the safe start.
  overlays: defaultLayout(),
};

export function configPath(userDataDir: string): string {
  return join(userDataDir, 'companion-config.json');
}

/**
 * Strips a UTF-8 byte order mark.
 *
 * ★ THIS COST A REAL PAIRING, AND IT WOULD HAVE COST MEMBERS THEIRS ★
 *
 * `JSON.parse` throws on a leading BOM: U+FEFF is not whitespace and is not legal JSON. Node
 * does not remove it for you when you read as `utf8`; you get the character.
 *
 * That matters because of who writes one. PowerShell's `Set-Content -Encoding utf8` adds a BOM by
 * default, as do Notepad and a good number of editors on Windows. So a member who opens this file
 * to check their token, or a support answer that says "edit this line", corrupts it just by saving
 * — and on 2026-08-02 that is exactly what happened here, by accident, while testing overlays.
 *
 * Stripping it costs one line and makes the file readable by anything a member is likely to use.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfe_ff ? text.slice(1) : text;
}

/** Where an unreadable config is put aside, rather than lost. */
export function quarantinePath(userDataDir: string): string {
  return join(userDataDir, 'companion-config.unreadable.json');
}

/**
 * Reads the config, falling back to defaults on anything unreadable.
 *
 * A corrupt file must not stop the app starting — the member would have no way to fix it except
 * deleting a file they cannot find. Defaults mean it comes up unpaired and disabled, which is safe
 * and obvious.
 *
 * ★ BUT THE OLD FILE IS KEPT, BECAUSE "SAFE AND OBVIOUS" WAS NEITHER ★
 *
 * Falling back was only half the behaviour. The app writes its config constantly — every poll
 * updates the journal offsets — so within seconds of starting on defaults it SAVED those defaults
 * over the file it could not read. The member's device token, their offsets and their overlay
 * arrangement were gone, permanently, and nothing anywhere said so. The visible symptom is an app
 * that has quietly forgotten it was ever paired.
 *
 * So an unreadable file is moved aside first. The app still starts on defaults, the original is
 * still on disk next to it, and `restoredFrom` tells the UI to say what happened instead of
 * presenting a fresh install as though nothing had.
 */
/**
 * Normalises a hub URL into a key.
 *
 * Trailing slashes and case differences are the same destination to a member and would be two
 * separate reading positions here — which is the exact class of mistake this field exists to stop.
 */
export function hubKey(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Reads the per-hub offsets, migrating a pre-2026-08-05 flat map onto the hub it was pointed at.
 *
 * Both shapes are tolerated because a member can downgrade, and a config written by the older
 * build must not lose a member's reading position and re-upload a year of journals.
 */
function readOffsetsByHub(
  parsed: Partial<CompanionConfig> & { offsets?: unknown },
  apiBaseUrl: string,
): Record<string, Record<string, number>> {
  const stored = (parsed as { offsetsByHub?: unknown }).offsetsByHub;
  if (typeof stored === 'object' && stored !== null) {
    const out: Record<string, Record<string, number>> = {};
    for (const [hub, files] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof files === 'object' && files !== null) {
        out[hubKey(hub)] = files as Record<string, number>;
      }
    }
    return out;
  }

  const legacy = parsed.offsets;
  if (typeof legacy === 'object' && legacy !== null) {
    return { [hubKey(apiBaseUrl)]: legacy as Record<string, number> };
  }
  return {};
}

export function loadConfig(userDataDir: string): CompanionConfig {
  const path = configPath(userDataDir);
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    const parsed = JSON.parse(stripBom(readFileSync(path, 'utf8'))) as Partial<CompanionConfig>;
    return {
      apiBaseUrl: typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : DEFAULT_CONFIG.apiBaseUrl,
      deviceToken: typeof parsed.deviceToken === 'string' ? parsed.deviceToken : '',
      journalPathOverride:
        typeof parsed.journalPathOverride === 'string' ? parsed.journalPathOverride : null,
      /*
       * ★ MIGRATING THE FLAT MAP ★
       *
       * A config written before this change has one offsets map and no record of where it was
       * sending. Attributed to the hub it is currently pointed at, which is right for the
       * overwhelming majority — one install, one hub, never moved — and keeps their next launch
       * from re-uploading months of journals to a hub that already has them.
       *
       * It is wrong for exactly the member this bug happened to, and it cannot be right for them:
       * the file simply does not record where those lines went. That is what the re-send control
       * exists for, and why this migration does not try to be clever.
       */
      offsetsByHub: readOffsetsByHub(
        parsed,
        typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : DEFAULT_CONFIG.apiBaseUrl,
      ),
      sessionLive:
        typeof parsed.sessionLive === 'object' && parsed.sessionLive !== null
          ? parsed.sessionLive
          : {},
      // Explicitly `=== true`. A truthy string from a hand-edited file must not
      // switch transmission on.
      enabled: parsed.enabled === true,
      discoveredJournalPath:
        typeof parsed.discoveredJournalPath === 'string' ? parsed.discoveredJournalPath : null,
      searchedAndFoundNothing: parsed.searchedAndFoundNothing === true,
      /*
       * `!== false`, not `=== true`. This one defaults ON, so an older config written before the
       * field existed must read as on rather than silently opting everybody out of the behaviour
       * they were promised.
       */
      autoStart: parsed.autoStart !== false,
      totals: readTotals(parsed.totals),
      /*
       * Normalised rather than trusted. This is a JSON file in the member's own profile — hand
       * edited, half-written by a crash, or produced by a version with different fields — and an
       * out-of-range opacity or a placement on a monitor that no longer exists is a panel they can
       * neither see nor reach.
       */
      overlays: normaliseLayout(parsed.overlays),
    };
  } catch (error) {
    /*
     * ★ PUT ASIDE, NOT OVERWRITTEN ★
     *
     * The next `saveConfig` — which happens within seconds, because journal offsets are written on
     * every poll — would otherwise destroy the only copy of the member's pairing. Renaming costs
     * nothing and turns "your app forgot everything" into "your app could not read your settings,
     * they are in this file".
     *
     * Best effort. If the rename fails the app must still start: refusing to launch because a
     * backup could not be taken is a worse outcome than the one being guarded against, and the
     * member would have no way to act on it either.
     */
    let quarantined = false;
    try {
      renameSync(path, quarantinePath(userDataDir));
      quarantined = true;
    } catch {
      quarantined = false;
    }

    return {
      ...DEFAULT_CONFIG,
      /*
       * Carried so the app can SAY so. Silence here is what made the original failure invisible:
       * every symptom pointed at a fresh install, and nothing pointed at a file that could not be
       * parsed.
       */
      restoredFrom: {
        reason: error instanceof Error ? error.message : 'The settings file could not be read.',
        quarantined,
      },
    };
  }
}

/**
 * Totals from a file that may predate them, or have been edited by hand.
 *
 * ★ EVERY FIELD CHECKED SEPARATELY ★
 *
 * A config written before totals existed has no key at all, and one somebody
 * has edited may have a string where a number belongs. `Number.isFinite`
 * rejects NaN and Infinity as well as the wrong type — and a NaN here would
 * propagate into every subsequent addition and render as "NaN sent" forever,
 * with nothing to explain it.
 */
function readTotals(value: unknown): CompanionTotals {
  const t = (typeof value === 'object' && value !== null ? value : {}) as Partial<CompanionTotals>;
  const count = (n: unknown): number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;

  return {
    sent: count(t.sent),
    duplicates: count(t.duplicates),
    journalsRead: count(t.journalsRead),
    txBytes: count(t.txBytes),
    rxBytes: count(t.rxBytes),
    since: typeof t.since === 'string' && t.since !== '' ? t.since : null,
  };
}

/**
 * A development override for the hub address.
 *
 * There is deliberately no UI for this. A field labelled "server address" on a
 * member's screen is a field somebody can be talked into changing, and the
 * result would be their journals going somewhere else entirely. Anyone who
 * needs to point at a test server can set an environment variable, which is a
 * thing you do on purpose.
 */
export function apiBaseUrlFor(config: CompanionConfig, env: NodeJS.ProcessEnv): string {
  const override = env['GRIMS_API_URL'];
  return typeof override === 'string' && override !== '' ? override : config.apiBaseUrl;
}

/**
 * Where the WEBSITE lives, as opposed to the API.
 *
 * ★ THE SAME ORIGIN IN PRODUCTION, TWO PORTS IN DEVELOPMENT ★
 *
 * On the server one origin serves both — Caddy routes `/v1` to the API and everything else to the
 * site — so the api base is the right answer there and no second setting is needed.
 *
 * On a development machine they are different ports, and building a website link from the API base
 * opened a JSON 404. `GRIMS_WEB_URL` exists for that, set by `dev.mjs`, exactly as `GRIMS_API_URL`
 * already is. There is deliberately no UI for either — see the note above.
 */
export function webBaseUrlFor(config: CompanionConfig, env: NodeJS.ProcessEnv): string {
  const override = env['GRIMS_WEB_URL'];
  if (typeof override === 'string' && override !== '') return override.replace(/\/+$/, '');
  return apiBaseUrlFor(config, env).replace(/\/+$/, '');
}

export function saveConfig(userDataDir: string, config: CompanionConfig): void {
  const path = configPath(userDataDir);
  mkdirSync(dirname(path), { recursive: true });

  /*
   * `restoredFrom` describes ONE STARTUP, not a setting. Writing it back would leave an app
   * reporting a corruption it had already recovered from, at every launch, for ever.
   */
  const { restoredFrom: _transient, ...persisted } = config;

  /*
   * ★ WRITTEN TO A TEMPORARY FILE AND RENAMED ★
   *
   * `writeFileSync` truncates first and then writes. Lose power, run out of disk, or get killed
   * between those two and the file on disk is a valid, empty, ZERO-BYTE settings file — which
   * parses as nothing and reads as an app that has forgotten it was paired.
   *
   * That is not hypothetical here: this file is rewritten every polling pass, so it is being
   * truncated and rewritten hundreds of times an hour on a machine somebody is also gaming on.
   * Rename is atomic on every platform we ship to, so a reader sees either the old file or the new
   * one and never a half-written one.
   *
   * The temporary file sits beside the real one so the rename stays on the same filesystem —
   * across devices it degrades to a copy, which is exactly the non-atomic write being avoided.
   */
  const temporary = `${path}.tmp`;
  // 0600 where the platform honours it. Windows ignores the mode, which is why it is a mitigation
  // rather than the protection.
  writeFileSync(temporary, JSON.stringify(persisted, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

/**
 * Redacts the token for display or logging.
 *
 * Shows enough to tell two devices apart and not enough to use. The app has a
 * status window and a log file, and both are places a member might screenshot.
 */
export function redactToken(token: string): string {
  if (token === '') return '(not paired)';
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}
