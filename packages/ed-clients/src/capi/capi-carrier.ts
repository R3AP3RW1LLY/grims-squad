import { CapiAuthError } from './capi-token.js';

/**
 * What a member's fleet carrier is holding, from Frontier itself.
 *
 * ★ WHY THIS IS DIFFERENT IN KIND FROM WHAT WE HAD ★
 *
 * Every carrier figure on the boards until now came from somebody typing it in, or from a journal
 * event caught while an app happened to be running. A journal reports what CHANGED while somebody
 * was watching; this is the whole manifest, whether or not anybody has docked, flown past, or run
 * the companion this week — including for a commander on a cloud platform who cannot run it at all.
 *
 * ★ AND IT IS THE ONLY SOURCE THAT CAN SAY "EMPTY" ★
 *
 * A journal that has not mentioned Titanium for a fortnight cannot tell "sold" from "nobody looked".
 * The board has been guessing between those two for as long as carriers have been on it, and an
 * empty manifest here settles it.
 */

export interface CarrierHoldLine {
  readonly commodity: string;
  readonly tonnes: number;
}

export interface CarrierManifest {
  readonly callsign: string;
  /** Everything aboard, one line per commodity. Empty means empty — see the header. */
  readonly cargo: readonly CarrierHoldLine[];
}

interface RawCarrier {
  name?: { callsign?: unknown } | null;
  cargo?: unknown;
  /**
   * The carrier's own market. Its `commodities` carry a `stock` — cargo LISTED FOR SALE.
   *
   * ★ SQUADRON OWNER, 2026-08-17 ★
   *
   * "Titanium is wrong but the aluminum is right, we need to make sure every commodity is correct"
   *
   * Measured on the owner's carrier: Frontier reported Aluminium 10,241 t and Titanium 1,639 t,
   * while the journal — older — had 7,601 t and 2,959 t. Aluminium HIGHER than the journal, Titanium
   * LOWER. A source that were simply stale would be wrong in one direction, not both.
   *
   * The asymmetry is the answer: `cargo` holds what is in the hold and NOT on the market. Anything
   * the owner has listed for sale moves into `market.commodities`, and reading `cargo` alone reports
   * a carrier as empty of exactly the commodities it is trying to sell — which, on a build, is the
   * cargo the squadron most wants to know about.
   */
  market?: { commodities?: unknown } | null;
}

export interface CarrierInput {
  readonly apiBase: string;
  readonly accessToken: string;
  readonly fetchImpl?: typeof fetch | undefined;
}

/**
 * Fetches the carrier, or null when the member has none.
 *
 * ★ 404 IS THE COMMON CASE, NOT A FAULT ★
 *
 * Most members do not own a carrier and Frontier answers 404. Raising for that would fill the log
 * with failures from perfectly healthy members and bury the one that matters — the same reasoning
 * `fetchJournalDay` already applies to a day nobody played.
 *
 * A 500 is the opposite and must never be quiet: "Frontier is broken" and "the carrier is empty"
 * are indistinguishable downstream, and both would clear the board's carrier column.
 */
export async function fetchCarrier(input: CarrierInput): Promise<CarrierManifest | null> {
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(new URL('/fleetcarrier', input.apiBase).toString(), {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    });
  } catch (e) {
    throw new CapiAuthError('network', `could not reach Frontier: ${(e as Error).message}`);
  }

  if (res.status === 404) return null;

  if (res.status === 401 || res.status === 403) {
    throw new CapiAuthError('invalid_grant', 'Frontier rejected the token', res.status);
  }
  if (res.status === 429) {
    throw new CapiAuthError('rate_limited', 'Frontier is rate limiting us', res.status);
  }
  if (!res.ok) {
    throw new CapiAuthError('refused', `Frontier returned http ${res.status}`, res.status);
  }

  let raw: RawCarrier;
  try {
    raw = (await res.json()) as RawCarrier;
  } catch {
    throw new CapiAuthError('malformed', 'Frontier returned something that was not JSON', res.status);
  }

  const callsign = typeof raw.name?.callsign === 'string' ? raw.name.callsign.trim() : '';

  /*
   * ★ STACKS ARE ADDED UP ★
   *
   * Frontier reports cargo per STACK, so 800 t of Titanium bought in three lots comes back as three
   * rows. Passing those through would show a member three Titanium lines and leave them to add up
   * the total — on a panel whose entire job is to have added it up already.
   *
   * A Map keeps first-seen order, so the manifest reads in the order Frontier listed it rather than
   * being re-sorted into something nobody asked for.
   */
  const totals = new Map<string, number>();
  for (const line of Array.isArray(raw.cargo) ? raw.cargo : []) {
    const row = line as { commodity?: unknown; qty?: unknown };
    const commodity = typeof row.commodity === 'string' ? row.commodity.trim() : '';
    const qty = Number(row.qty);

    // Stolen and mission cargo counts: the board asks whether it is ABOARD, not how it got there.
    if (commodity === '' || !Number.isFinite(qty) || qty <= 0) continue;
    totals.set(commodity, (totals.get(commodity) ?? 0) + qty);
  }

  /*
   * ★ AND WHAT IS ON THE MARKET IS STILL ABOARD ★
   *
   * See the note on `market` above. Cargo the owner has listed for sale leaves `cargo` and appears
   * here instead, so reading one without the other reports a carrier as empty of precisely the
   * commodities it is selling.
   *
   * ADDED, not maxed: a carrier can hold 2,000 t of Titanium with 500 t of it listed, and those are
   * different tonnes in the same hold. `stock` is what it HAS; `demand` is what it wants to buy and
   * is somebody else's cargo until it arrives.
   *
   * Frontier names the commodity `name` here and `commodity` in `cargo`, and the market form is
   * sometimes the localisation key — so both spellings are unwrapped to the display name the rest of
   * the platform joins on.
   */
  for (const line of Array.isArray(raw.market?.commodities) ? raw.market.commodities : []) {
    const row = line as { name?: unknown; locName?: unknown; stock?: unknown };
    const wrapped = typeof row.name === 'string' ? row.name.trim() : '';
    const localised = typeof row.locName === 'string' ? row.locName.trim() : '';
    const commodity =
      localised !== ''
        ? localised
        : wrapped
            .replace(/^\$/, '')
            .replace(/_name;?$/i, '')
            .split(/([\s_-]+)/)
            .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
            .join('');

    const stock = Number(row.stock);
    if (commodity === '' || !Number.isFinite(stock) || stock <= 0) continue;
    totals.set(commodity, (totals.get(commodity) ?? 0) + stock);
  }

  return {
    callsign,
    cargo: [...totals].map(([commodity, tonnes]) => ({ commodity, tonnes })),
  };
}
