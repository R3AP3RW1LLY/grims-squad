/**
 * Rendering times.
 *
 * ★ TWO RULES, AND THEY DIFFER ON PURPOSE ★
 *
 * The AUDIT LOG is always UTC, always labelled, always to the second. It is the
 * one surface where several officers compare notes about the same event — often
 * from different countries — and a log in each reader's own timezone makes
 * "which happened first" a question nobody can answer from a screenshot.
 * Seconds because privileged actions arrive in bursts: a role change and the
 * grant it caused land in the same minute, and minute resolution loses the
 * order between them.
 *
 * EVERYTHING ELSE renders in the member's own timezone, because "when did my
 * device last upload" is a question about their evening, not about UTC.
 *
 * ★ FORMATTED ON THE SERVER, BOTH TIMES ★
 *
 * The member's zone is stored, so `Intl` can be given it explicitly rather than
 * inferring one from the browser. That makes the output identical on server and
 * client — no hydration mismatch, and no flicker as every timestamp on the page
 * corrects itself after load.
 */

/**
 * `YYYY-MM-DD HH:MM:SS UTC`.
 *
 * Built from the ISO string's own parts rather than through Intl. The value
 * arrives from the API already in UTC, so slicing it cannot drift — whereas a
 * formatter given the wrong zone would produce a plausible, wrong answer, and
 * that is exactly the failure an audit log cannot afford.
 */
export function formatUtcSeconds(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/**
 * The same instant in the member's own timezone.
 *
 * Falls back to UTC on an unknown zone rather than throwing. A stored zone that
 * this runtime does not recognise — retired between Node versions, say — should
 * cost a slightly wrong label, not a page that fails to render.
 */
export function formatLocal(
  iso: string,
  timeZone: string,
  options: { withTime?: boolean } = {},
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;

  const withTime = options.withTime ?? true;

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' as const } : {}),
    }).format(at);
  } catch {
    return `${at.toISOString().slice(0, withTime ? 16 : 10).replace('T', ' ')} UTC`;
  }
}

/**
 * A short label for the zone itself, e.g. `GMT+1`.
 *
 * Shown beside a local time so a member reading their own screen knows which
 * offset it is in — which matters when they are about to quote it to somebody
 * in another country.
 */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return 'UTC';
  }
}
