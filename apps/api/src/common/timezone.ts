/**
 * Which timezone a member reads times in.
 *
 * ★ WHY WE ASK RATHER THAN DETECT ★
 *
 * Discord's OAuth scopes carry no timezone — not in the user object, not in the
 * guild member object. There is nothing to import, so the choice is between
 * guessing from the browser and asking.
 *
 * Guessing is what most sites do, and it is wrong often enough to matter here:
 * a squadron that flies together across Europe and North America has members on
 * a laptop in one place and a phone in another, and `Intl.DateTimeFormat()`
 * follows the device rather than the person. It also cannot be used on the
 * server, so every rendered time would have to be filled in after the page
 * loaded — a visible flicker on every timestamp on the site.
 *
 * A stored preference is known before the first byte of HTML, so the server
 * renders the right time first go and there is nothing to correct.
 */

/** Falls back to UTC, which is also what the column defaults to. */
export const DEFAULT_TIMEZONE = 'UTC';

/**
 * Is this a real IANA zone?
 *
 * Checked against the RUNTIME's own database rather than a list we maintain.
 * A hand-written list goes stale — zones are added and renamed by the IANA
 * every few years — and a member whose city was added last year would be told
 * their timezone does not exist.
 */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;

  try {
    // Throws RangeError on an unknown zone. There is no cheaper check that is
    // also correct: the set is large, versioned, and platform-specific.
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every zone this runtime knows, for the picker.
 *
 * `supportedValuesOf` is Node 18+. Guarded anyway: on a runtime without it the
 * picker falls back to a short list rather than rendering empty, because a
 * select with no options is indistinguishable from a broken page.
 */
export function knownTimezones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;

  if (typeof supported === 'function') {
    try {
      return supported('timeZone');
    } catch {
      /* fall through */
    }
  }

  return [
    'UTC',
    'Europe/London',
    'Europe/Dublin',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Madrid',
    'Europe/Warsaw',
    'Europe/Helsinki',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
}
