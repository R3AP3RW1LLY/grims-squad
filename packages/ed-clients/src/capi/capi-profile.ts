import { CapiAuthError } from './capi-token.js';

/**
 * Who Frontier says this member is.
 *
 * ★ THE ONE CALL THAT TURNS A TOKEN INTO A VERIFIED COMMANDER ★
 *
 * Everything else cAPI offers is data about a commander we have already identified. This is the
 * call that identifies them — and it is Frontier answering directly, which is why the schema ranks
 * it tier 3, above a nonce in an Inara bio (tier 2) and an officer approving a screenshot (tier 1).
 *
 * ★ IT REUSES THE TOKEN CLIENT'S FAILURE VOCABULARY ON PURPOSE ★
 *
 * A profile call fails the same three ways a token call does, and they still mean opposite things:
 * unreachable is worth retrying, a 401 means the grant died and retrying is the bug, a 429 means
 * back off. A poller that flattens them loses a member's data silently — the failure this codebase
 * has already had through two other doors.
 */

export interface CapiProfile {
  /** The commander name exactly as Frontier spells it. Never normalised here. */
  readonly commanderName: string;
  /** Where they were when Frontier last wrote the profile. Null when it says nothing. */
  readonly systemName: string | null;
  /** The station they are docked at, or null when in space. */
  readonly stationName: string | null;
}

interface RawProfile {
  commander?: { name?: unknown } | null;
  lastSystem?: { name?: unknown } | null;
  lastStarport?: { name?: unknown } | null;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

export interface ProfileInput {
  readonly apiBase: string;
  readonly accessToken: string;
  readonly fetchImpl?: typeof fetch | undefined;
}

/**
 * Fetches the commander profile.
 *
 * ★ A PROFILE WITHOUT A NAME IS A FAILURE, NOT AN EMPTY SUCCESS ★
 *
 * The name is the entire reason for this call. Returning a blank one would write an empty
 * `cmdrName`, and empty is exactly what the row already holds while waiting to be filled — so the
 * member would sit "linked but unverified" for ever with nothing reporting a problem, which is the
 * worst state this codebase keeps rediscovering.
 */
export async function fetchProfile(input: ProfileInput): Promise<CapiProfile> {
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(new URL('/profile', input.apiBase).toString(), {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    });
  } catch (e) {
    throw new CapiAuthError('network', `could not reach Frontier: ${(e as Error).message}`);
  }

  if (res.status === 401 || res.status === 403) {
    // The grant is gone. Retrying forever against a dead token is how a member disconnects
    // silently, so this is deliberately the non-retryable kind.
    throw new CapiAuthError('invalid_grant', 'Frontier rejected the token', res.status);
  }
  if (res.status === 429) {
    throw new CapiAuthError('rate_limited', 'Frontier is rate limiting us', res.status);
  }
  if (!res.ok) {
    throw new CapiAuthError('refused', `Frontier returned http ${res.status}`, res.status);
  }

  let raw: RawProfile;
  try {
    raw = (await res.json()) as RawProfile;
  } catch {
    throw new CapiAuthError('malformed', 'Frontier returned something that was not JSON', res.status);
  }

  const commanderName = str(raw.commander?.name);
  if (commanderName === null) {
    throw new CapiAuthError('malformed', 'Frontier returned a profile with no commander name', res.status);
  }

  return {
    commanderName,
    systemName: str(raw.lastSystem?.name),
    stationName: str(raw.lastStarport?.name),
  };
}
