/**
 * What the hub says is being collected, and how much it holds.
 *
 * ★ WHY THE APP ASKS INSTEAD OF KNOWING ★
 *
 * Since telemetry became opt-out (INV-013, amended 2026-07-29) the app sends
 * everything it reads and the SERVER decides what to keep. So the app genuinely
 * does not know what is being stored about the member — and the panel that used
 * to claim it did was, by then, simply wrong: it still told members that their
 * credit balance was never collected and that filtering happened on their own
 * PC, and neither had been true since the change.
 *
 * Asking is the only way to be right, and being right about this is the whole
 * point of showing it.
 *
 * ★ READ ONLY ★
 *
 * The app can see what has been switched off; it cannot change it. Settings are
 * changed on the website behind a real sign-in, because a device token pasted
 * into the wrong place must never be able to alter what is collected about
 * somebody.
 */

export interface CatalogueEntry {
  readonly event: string;
  readonly label: string;
  readonly reveals: string;
}

export interface CatalogueGroup {
  readonly category: string;
  readonly label: string;
  readonly purpose: string;
  readonly required: boolean;
  readonly entries: readonly CatalogueEntry[];
}

export interface HubSettings {
  readonly optOutCategories: readonly string[];
  readonly optOutEvents: readonly string[];
  readonly catalogue: readonly CatalogueGroup[];
  readonly requiredCategory: string;
  /** Rows the hub actually holds for this member, across every device. */
  readonly storedEvents: number;
  readonly firstEventAt: string | null;
  /**
   * The newest version published on the hub, or null.
   *
   * Rides on this call rather than an endpoint of its own — the app already
   * makes it every five minutes with its device token, so the update check
   * costs no extra request and no second authentication path.
   */
  readonly latestVersion: string | null;
}

export interface FetchSettingsOptions {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export async function fetchHubSettings(
  opts: FetchSettingsOptions,
): Promise<{ ok: true; settings: HubSettings } | { ok: false; error: string }> {
  if (opts.deviceToken === '') return { ok: false, error: 'Not paired yet.' };

  const doFetch = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 15_000);

  try {
    const res = await doFetch(`${opts.apiBaseUrl.replace(/\/+$/, '')}/v1/telemetry/settings`, {
      headers: { authorization: `Bearer ${opts.deviceToken}` },
      signal: ac.signal,
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'This device is no longer paired.' };
    }
    if (!res.ok) return { ok: false, error: `The hub answered ${res.status}.` };

    const body = (await res.json().catch(() => null)) as Partial<HubSettings> | null;
    if (body === null || !Array.isArray(body.catalogue)) {
      return { ok: false, error: 'The hub sent something we could not read.' };
    }

    return {
      ok: true,
      settings: {
        optOutCategories: Array.isArray(body.optOutCategories) ? body.optOutCategories : [],
        optOutEvents: Array.isArray(body.optOutEvents) ? body.optOutEvents : [],
        catalogue: body.catalogue,
        /*
         * Defaulted to `session` rather than to nothing. If this were empty the
         * UI would show the one category a member cannot decline as though they
         * could — offering a choice that does not exist is worse than offering
         * none.
         */
        requiredCategory:
          typeof body.requiredCategory === 'string' && body.requiredCategory !== ''
            ? body.requiredCategory
            : 'session',
        storedEvents: typeof body.storedEvents === 'number' ? body.storedEvents : 0,
        firstEventAt: typeof body.firstEventAt === 'string' ? body.firstEventAt : null,
        // Null on anything unexpected. A malformed value must not become a
        // banner pointing at a release that does not exist.
        latestVersion: typeof body.latestVersion === 'string' ? body.latestVersion : null,
      },
    };
  } catch {
    return {
      ok: false,
      error: ac.signal.aborted ? 'The hub took too long to answer.' : 'Could not reach the hub.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this category being collected right now?
 *
 * The required category is always yes, whatever a stale opt-out list says. That
 * belt-and-braces exists because the list is data from over the network, and a
 * UI that told somebody their session data was switched off would be telling
 * them their promotions had stopped counting — which would be false and
 * alarming in the same breath.
 */
export function categorySending(
  category: string,
  settings: Pick<HubSettings, 'optOutCategories' | 'requiredCategory'>,
): boolean {
  if (category === settings.requiredCategory) return true;
  return !settings.optOutCategories.includes(category);
}

/** Is this individual event being collected? */
export function eventSending(
  group: CatalogueGroup,
  event: string,
  settings: Pick<HubSettings, 'optOutCategories' | 'optOutEvents' | 'requiredCategory'>,
): boolean {
  // A declined CATEGORY takes everything in it with it, so an event inside one
  // is off regardless of whether it was named individually.
  if (!categorySending(group.category, settings)) return false;
  return !settings.optOutEvents.includes(event);
}
