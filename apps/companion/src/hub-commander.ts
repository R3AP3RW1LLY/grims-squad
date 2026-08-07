/**
 * Where the commander is, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "can we also add the location to the companion app status page, and show it like it is shown in
 * the web app please."
 *
 * ★ THE HUB ANSWERS, EVEN THOUGH THIS APP READ THE JOURNALS ★
 *
 * The app already parses the events this is derived from — it tracks `dockedAt` for the
 * colonisation panels — so working it out locally would be fewer moving parts and no network call.
 * It deliberately does not.
 *
 * `hub-colony.ts` states the rule for this whole surface: a second copy that could disagree with
 * the website is exactly the bug a member reports as "the app says something different" and nobody
 * can reproduce. Location has the worst history of precisely that — it has been wrong twice, and
 * both times because two places decided it and only one of them was fixed.
 *
 * One implementation, `buildCommanderProfile`, on the hub. "Show it like the web app" is then true
 * by construction rather than by care.
 */

export interface CommanderLocation {
  /** The system, from the newer of the last jump and the last load-in. Null until one arrives. */
  readonly currentSystem: string | null;
  readonly systemSeenAt: string | null;
  /**
   * Station, settlement or body — whatever the journal last named inside the system.
   *
   * Null is not missing data: it is a commander in supercruise or between stars, which is why the
   * page says "In open space" rather than "Unknown", exactly as the website does.
   */
  readonly currentLocation: string | null;
  readonly locationSeenAt: string | null;
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

export interface HubCall {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * One GET to the commander surface.
 *
 * Failures become a sentence rather than an exception, for the same reason the colonisation calls
 * do: the renderer draws whatever comes back, and a thrown error there is a blank panel that
 * cannot tell a member "you are not paired" from "your internet is down".
 */
export async function commanderLocation(call: HubCall): Promise<Answer<CommanderLocation>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 15_000);

  try {
    const res = await doFetch(
      `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/commander/location`,
      { headers: { authorization: `Bearer ${call.deviceToken}` }, signal: ac.signal },
    );

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: body?.error?.message ?? `The hub answered ${res.status}.` };
    }

    const data = (await res.json().catch(() => null)) as CommanderLocation | null;
    if (data === null) return { ok: false, error: 'The hub sent something we could not read.' };

    return { ok: true, data };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'The hub did not answer in time.'
        : 'Could not reach the hub. Check your connection.',
    };
  } finally {
    clearTimeout(timer);
  }
}
