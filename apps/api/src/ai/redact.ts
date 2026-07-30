/**
 * Stripping machine detail out of anything shown in the admin log stream.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "just dont show PC file paths into this streaming logs servic please".
 *
 * ★ WHY A PATH IS WORTH REMOVING ★
 *
 * The AI runs on somebody's home PC, and its errors are full of that PC: model paths, CUDA library
 * locations, and — the actual reason — `C:\Users\<name>\…`, which is a real person's Windows
 * account name. The stream is read by officers, so that is a small disclosure to a small group,
 * and it is one nobody consented to and nobody needs.
 *
 * Server paths go too. `/srv/grims/…` in a log line tells anybody reading over a shoulder how the
 * deployment is laid out, and the layout is not interesting enough to be worth publishing.
 *
 * ★ REPLACED, NOT DELETED ★
 *
 * A redacted path leaves a marker rather than a gap. "cannot open <path>" still reads as a file
 * problem, where "cannot open" reads as a truncated log line and sends somebody looking for a bug
 * in the logger.
 */

/**
 * Patterns that name a machine rather than a problem.
 *
 * Ordered longest-first where they overlap: a Windows path inside a URL should be caught as a path
 * rather than half-matched by the drive-letter rule.
 */
const PATTERNS: ReadonlyArray<{ re: RegExp; with: string }> = [
  /*
   * Windows paths, with or without a drive letter. `[^\s"']+` stops at whitespace or a quote,
   * which is where a path ends in every log line that has one — going further swallows the message
   * that follows it and hides the error.
   */
  { re: /[A-Za-z]:\\[^\s"'<>|]+/g, with: '<path>' },
  // UNC shares: \\server\share\…
  { re: /\\\\[^\s"'<>|]+/g, with: '<path>' },
  /*
   * POSIX paths, but only ones rooted at a directory that actually names a machine. Matching every
   * `/foo/bar` would redact URL paths, our own API routes, and half the prose in an error.
   */
  { re: /\/(?:home|Users|srv|opt|var|usr|etc|root|tmp|mnt|media)\/[^\s"'<>|]*/g, with: '<path>' },
  /*
   * A bare home reference. `~/.ollama/models` names a layout without being an absolute path.
   */
  { re: /~\/[^\s"'<>|]+/g, with: '<path>' },
];

/**
 * Removes machine paths from a line destined for the admin stream.
 *
 * Deliberately conservative: it removes paths and nothing else. A redactor that also tried to guess
 * at names, hosts and ids would eventually eat the error message, and an unreadable log is worse
 * than a slightly detailed one — somebody would then go to the raw logs, which have everything.
 */
export function redactPaths(text: string): string {
  let out = text;
  for (const p of PATTERNS) out = out.replace(p.re, p.with);
  return out;
}

/**
 * The maximum length of a streamed log line.
 *
 * A model stack trace can run to kilobytes. The stream is a live view rather than an archive — the
 * full record is in `ai_calls` — and a single line that fills the panel makes the thing unusable
 * for the one job it has, which is noticing that something is wrong.
 */
export const MAX_LOG_LINE = 500;

/** Prepares any string for the stream: redacted, then bounded. */
export function forStream(text: string): string {
  const redacted = redactPaths(text);
  return redacted.length > MAX_LOG_LINE ? `${redacted.slice(0, MAX_LOG_LINE)}…` : redacted;
}
