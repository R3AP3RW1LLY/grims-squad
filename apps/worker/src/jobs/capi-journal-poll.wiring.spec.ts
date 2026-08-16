import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The poller's store, and the three things in it that fail silently.
 *
 * ★ WHY A SOURCE SCAN ★
 *
 * Every method here is SQL against a live schema. Standing Postgres up would test Prisma, and
 * mocking it would test the mock — neither touches what actually goes wrong, which is a query that
 * runs perfectly and answers the wrong question. Each assertion below names a specific way that
 * happens, and every one of them is invisible at runtime.
 *
 * The reasoning that IS testable in isolation already is: `capi-journal-poll.ts` has 27 tests and
 * takes this store as an interface precisely so it never needs a database.
 */

const SRC = readFileSync(join(process.cwd(), 'src/jobs/capi-journal-poll.wiring.ts'), 'utf8');

describe('the token refresh, which can cost a member their link', () => {
  it('★ MANDATORY: it refreshes inside the shared lock ★', () => {
    /*
     * Frontier rotates the refresh token, and the API refreshes the same rows on demand. Without
     * this both processes send the same still-valid token, one wins, and the loser persists a token
     * Frontier has already killed — with no error, on a row that still looks healthy.
     */
    expect(SRC).toContain('withCapiRefreshLock');
  });

  it('★ MANDATORY: the lock comes from the SHARED helper, not a local copy ★', () => {
    /*
     * The lock only works if both processes compute the same key. A second implementation here
     * would produce a lock that is taken, held, and protects nothing — and it would look correct in
     * review, because the code would be right; only the key would differ.
     */
    expect(SRC).toMatch(/withCapiRefreshLock[\s\S]{0,400}from '@grims\/db'/);
  });

  it('★ MANDATORY: the row is RE-READ inside the lock ★', () => {
    /*
     * Whoever waited on the lock was waiting for somebody else's refresh to complete. That refresh
     * has already spent the refresh token this call was holding. Sending it anyway is the exact
     * failure the lock was taken to prevent — the lock alone is not enough without the re-read.
     */
    // Anchored on the CALL, not the import — the first `withCapiRefreshLock` in this file is the
    // import line, and slicing from there measured nothing about the refresh at all.
    const inside = SRC.slice(SRC.indexOf('return await withCapiRefreshLock('));

    expect(inside.slice(0, 900)).toMatch(/SELECT fdev_access_enc, fdev_refresh_enc/);
  });

  it('★ MANDATORY: only a NON-retryable failure marks the grant stale ★', () => {
    /*
     * `is_stale` takes a member out of `livePollable` permanently and nothing ever un-writes it. A
     * rate limit or a network blip must not do that — it would disconnect somebody because Frontier
     * had a bad minute, and the API's own path already draws this distinction.
     */
    expect(SRC).toContain('e instanceof CapiAuthError && !e.retryable');
  });

  it('★ MANDATORY: the lock is held on a DEDICATED connection ★', () => {
    // The lock belongs to the session. Taken on Prisma's pool it would be released the moment the
    // pool reclaimed the connection — mid-refresh, inside the window it exists to protect.
    expect(SRC).toContain('new Client(');
  });
});

describe('what the caller is told was stored', () => {
  it('★ MANDATORY: the count comes from the database, not from what we offered ★', () => {
    /*
     * `stored > 0` drives three things at once: whether the member is flying, whether a month counts
     * toward a PROMOTION, and whether to poll them faster. `ON CONFLICT DO NOTHING ... RETURNING`
     * is what makes the answer true — without RETURNING the store would report rows the unique index
     * refused, and all three would be driven off deliveries that never happened.
     */
    expect(SRC).toContain('ON CONFLICT (event_key) DO NOTHING');
    expect(SRC).toContain('RETURNING event_key');
  });
});

describe('consent and identity', () => {
  it('★ MANDATORY: opt-outs are read per member, both kinds ★', () => {
    // INV-013 at the door. This is a SECOND way into telemetry_events, and a member who declined a
    // category must not have it collected merely because it arrived from Frontier instead of their PC.
    expect(SRC).toContain('telemetry_opt_out_categories');
    expect(SRC).toContain('telemetry_opt_out_events');
  });

  it('★ MANDATORY: a revoked Frontier device is not silently recreated ★', () => {
    /*
     * Revoking that device is a member saying "stop importing this". Creating a fresh one on the
     * next poll would make the control a button that does nothing — and the member would have no way
     * to tell, because the imports would simply carry on.
     */
    expect(SRC).toContain('row.revoked_at === null ? row.id : null');
  });
});

describe('presence', () => {
  it('★ MANDATORY: last_playing_at never moves BACKWARDS ★', () => {
    /*
     * cAPI lags and a poll can return an older day than one already recorded — the companion may
     * have reported a session minutes ago while Frontier is still serving yesterday. A plain
     * assignment would walk a member's "last seen" backwards, and the roster would show somebody
     * who is flying right now as absent.
     */
    expect(SRC).toContain('GREATEST');
  });
});
