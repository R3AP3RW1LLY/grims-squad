import { describe, expect, it } from 'vitest';
import { fetchCarrier } from './capi-carrier.js';
import { CapiAuthError } from './capi-token.js';

/**
 * What a member's fleet carrier is actually holding, from Frontier.
 *
 * ★ SQUADRON OWNER ★
 *
 * Part of the cAPI work: the build overlay and the project pages show what is on the squadron's
 * carriers, and until now every one of those figures came from somebody typing it in or from a
 * journal event caught in passing.
 *
 * ★ WHY FRONTIER'S ANSWER IS DIFFERENT IN KIND ★
 *
 * A journal tells us what changed while somebody was watching. This is the carrier's whole manifest,
 * whether or not anybody has docked, flown past, or run the app this week — including for a
 * commander on a cloud platform who cannot run it at all.
 *
 * It is also the only source that can say a hold is EMPTY. A journal that has not mentioned Titanium
 * for a fortnight cannot distinguish "sold" from "nobody looked", and the board has been guessing
 * between those two for as long as carriers have been on it.
 */

const ok = (body: unknown): typeof fetch =>
  (async () =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response) as unknown as typeof fetch;

const status = (code: number): typeof fetch =>
  (async () =>
    ({ ok: false, status: code, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;

const input = (fetchImpl: typeof fetch) => ({
  apiBase: 'https://companion.orerve.net',
  accessToken: 'token',
  fetchImpl,
});

describe('reading the manifest', () => {
  it('★ MANDATORY: cargo is returned with its commodity and tonnage ★', async () => {
    const out = await fetchCarrier(
      input(
        ok({
          name: { callsign: 'K7Q-B4T' },
          cargo: [
            { commodity: 'Titanium', qty: 480 },
            { commodity: 'Steel', qty: 1_200 },
          ],
        }),
      ),
    );

    expect(out).not.toBeNull();
    expect(out?.callsign).toBe('K7Q-B4T');
    expect(out?.cargo).toEqual([
      { commodity: 'Titanium', tonnes: 480 },
      { commodity: 'Steel', tonnes: 1_200 },
    ]);
  });

  it('★ MANDATORY: an EMPTY hold is a fact, not a failure ★', () => {
    /*
     * The thing no other source can say. A journal that has not mentioned a commodity for a
     * fortnight cannot tell "sold" from "nobody looked", and the board has been guessing between
     * those two. An empty manifest means empty.
     */
    return expect(fetchCarrier(input(ok({ name: { callsign: 'K7Q-B4T' }, cargo: [] })))).resolves.toEqual(
      { callsign: 'K7Q-B4T', cargo: [] },
    );
  });

  it('★ MANDATORY: the same commodity in several stacks is added up ★', async () => {
    /*
     * Frontier reports cargo per STACK, and a carrier holding 800 t of Titanium bought in three lots
     * comes back as three rows. Listing them separately would show a member three Titanium lines and
     * make them work out the total themselves — on a panel that exists to save exactly that.
     */
    const out = await fetchCarrier(
      input(
        ok({
          name: { callsign: 'K7Q-B4T' },
          cargo: [
            { commodity: 'Titanium', qty: 300 },
            { commodity: 'Titanium', qty: 500 },
          ],
        }),
      ),
    );

    expect(out?.cargo).toEqual([{ commodity: 'Titanium', tonnes: 800 }]);
  });

  it('stolen and mission cargo is counted, because it is still aboard', async () => {
    // The question the board asks is "is it on the carrier", not "how did it get there".
    const out = await fetchCarrier(
      input(ok({ name: { callsign: 'X' }, cargo: [{ commodity: 'Gold', qty: 5, stolen: true }] })),
    );

    expect(out?.cargo).toEqual([{ commodity: 'Gold', tonnes: 5 }]);
  });
});

describe('when Frontier will not answer', () => {
  it('★ MANDATORY: a member with NO carrier is not an error ★', () => {
    /*
     * Most members do not own one, and Frontier answers 404. Raising would fill the log with
     * failures from perfectly healthy members and bury the one that matters — the same reasoning
     * the journal client already applies to a day nobody played.
     */
    return expect(fetchCarrier(input(status(404)))).resolves.toBeNull();
  });

  it('★ MANDATORY: a dead grant is NOT retryable ★', () => {
    // Retrying for ever against a revoked token is how a member disconnects in silence.
    return expect(fetchCarrier(input(status(401)))).rejects.toMatchObject({
      kind: 'invalid_grant',
      retryable: false,
    });
  });

  it('★ MANDATORY: a rate limit IS retryable, and says so ★', () => {
    // The limit is shared across the squadron. Confusing it with a dead grant would either spend the
    // budget proving it is spent, or disconnect somebody for Frontier being busy.
    return expect(fetchCarrier(input(status(429)))).rejects.toMatchObject({
      kind: 'rate_limited',
      retryable: true,
    });
  });

  it('a 500 is raised rather than read as an empty carrier', () => {
    /*
     * The dangerous one. "Frontier is broken" and "the carrier is empty" are indistinguishable
     * downstream — both would clear the board's carrier column — and that is how this platform has
     * already presented a stale figure as current under other names.
     */
    return expect(fetchCarrier(input(status(500)))).rejects.toBeInstanceOf(CapiAuthError);
  });

  it('a manifest that is not JSON is malformed, not empty', () => {
    const broken = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      }) as unknown as Response) as unknown as typeof fetch;

    return expect(fetchCarrier(input(broken))).rejects.toMatchObject({ kind: 'malformed' });
  });
});
