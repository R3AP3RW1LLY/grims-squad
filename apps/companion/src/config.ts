import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
  /** Base URL of the hub. Configurable so a member can point at a test server. */
  apiBaseUrl: string;
  /** The pairing token. Empty until the member pairs. */
  deviceToken: string;
  /** Overrides the detected journal folder. The escape hatch for odd setups. */
  journalPathOverride: string | null;
  /** Per-file byte offsets, so a restart re-reads nothing. */
  offsets: Record<string, number>;
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
}

export interface CompanionTotals {
  /** Events handed to the hub, successfully, ever. */
  sent: number;
  /** Events the hub already had. Normal, and not a failure. */
  duplicates: number;
  /** DISTINCT journal files this machine has read at least one line from. */
  journalsRead: number;
  /** ISO instant of the first successful upload, or null. */
  since: string | null;
}

export const EMPTY_TOTALS: CompanionTotals = {
  sent: 0,
  duplicates: 0,
  journalsRead: 0,
  since: null,
};

export const DEFAULT_CONFIG: CompanionConfig = {
  apiBaseUrl: 'https://45-63-35-93.sslip.io',
  deviceToken: '',
  journalPathOverride: null,
  offsets: {},
  sessionLive: {},
  // OFF until the member turns it on. An app that starts transmitting the
  // moment it is installed has not asked, and being installed is not consent.
  enabled: false,
  discoveredJournalPath: null,
  searchedAndFoundNothing: false,
  totals: EMPTY_TOTALS,
};

export function configPath(userDataDir: string): string {
  return join(userDataDir, 'companion-config.json');
}

/**
 * Reads the config, falling back to defaults on anything unreadable.
 *
 * A corrupt file must not stop the app starting — the member would have no way
 * to fix it except deleting a file they cannot find. Defaults mean it comes up
 * unpaired and disabled, which is safe and obvious.
 */
export function loadConfig(userDataDir: string): CompanionConfig {
  const path = configPath(userDataDir);
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<CompanionConfig>;
    return {
      apiBaseUrl: typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : DEFAULT_CONFIG.apiBaseUrl,
      deviceToken: typeof parsed.deviceToken === 'string' ? parsed.deviceToken : '',
      journalPathOverride:
        typeof parsed.journalPathOverride === 'string' ? parsed.journalPathOverride : null,
      offsets: typeof parsed.offsets === 'object' && parsed.offsets !== null ? parsed.offsets : {},
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
      totals: readTotals(parsed.totals),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
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

export function saveConfig(userDataDir: string, config: CompanionConfig): void {
  const path = configPath(userDataDir);
  mkdirSync(dirname(path), { recursive: true });
  // 0600 where the platform honours it. Windows ignores the mode, which is why
  // it is a mitigation rather than the protection.
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
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
