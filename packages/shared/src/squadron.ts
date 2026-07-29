/**
 * Which squadron is ours, and does a reported name mean it?
 *
 * ★ WHY THIS LIVES IN SHARED AND NOT IN EITHER APP ★
 *
 * Two things ask the question: the website, when a member links an Inara key,
 * and the worker, on its twenty-minute re-check. If each carried its own
 * comparison they would drift — and the drift here is a member the website
 * accepts and the sweep rejects, flickering between partially and fully
 * verified with nothing in any log to explain it.
 *
 * There WERE two: this file replaces a normaliser in the link service and a
 * second one written for the re-check job.
 */

/**
 * Our squadron's name on Inara.
 *
 * ★ CONFIGURATION, NOT A CONSTANT TO EDIT ★
 *
 * Read from the environment so a test guild, a rename, or a second squadron
 * needs no code change. The default is the real name: getting this silently
 * wrong marks every genuine member as an outsider, and a BLANK default would do
 * exactly that on any deployment that forgot to set it.
 */
export function expectedSquadronName(env: NodeJS.ProcessEnv = process.env): string {
  const v = env['INARA_SQUADRON_NAME'];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : "Grim's Squad";
}

/**
 * Do these two name the same squadron?
 *
 * ★ THE APOSTROPHE IS THE WHOLE PROBLEM ★
 *
 * "Grim's Squad" exists in this system with a straight quote, with a typographic
 * one (U+2019 — which is what the Discord role uses), and with whatever Inara
 * happens to store after a member typed it by hand. A plain equality check
 * matches one of the three and silently rejects real members, with a failure
 * that looks like Inara being wrong rather than like a character encoding.
 *
 * Case and internal whitespace are normalised for the same reason. Punctuation
 * is stripped rather than mapped, so "Grims Squad" — which somebody will
 * eventually type — still matches.
 */
export function sameSquadron(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;

  /*
   * Punctuation and spacing are REMOVED, not replaced with a space.
   *
   * Replacing turns "Grim's Squad" into "grim s squad" and "Grims Squad" into
   * "grims squad" — which do not match, so the very case this normaliser exists
   * for still fails. Stripping gives "grimssquad" for both, and for the
   * typographic apostrophe too.
   *
   * It stays discriminating: "Grim Squadron" normalises to "grimsquadron",
   * which is not "grimssquad".
   */
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  const left = norm(a);
  return left !== '' && left === norm(b);
}

/** One Inara answer, read. */
export interface SquadronCheckOutcome {
  readonly matched: boolean;
  /** What Inara said, whatever it was. Null when Inara had nothing. */
  readonly reported: string | null;
}

/**
 * Reads one Inara answer and decides what it means.
 *
 * Separated from the fetching so the decision can be tested against every shape
 * Inara returns without a network — which is where the apostrophe and
 * empty-string cases actually live.
 */
export function evaluateSquadron(
  reported: string | null | undefined,
  expected: string,
): SquadronCheckOutcome {
  const value = typeof reported === 'string' && reported.trim() !== '' ? reported.trim() : null;
  return { matched: sameSquadron(value, expected), reported: value };
}
