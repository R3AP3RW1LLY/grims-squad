import { describe, it, expect, beforeEach } from 'vitest';
import { InaraNotApprovedError, InaraApiError } from '@grims/ed-clients';
import { NonceService, type NonceStore, type NonceClaim } from '@grims/shared';
import { pollInaraNonces } from './inara-nonce-poll.js';

/**
 * P1.8b — the Inara poll job.
 *
 * ★ THE ACCEPTANCE CRITERION THESE TESTS ARE FOR ★
 *
 * "Inara being unavailable or unapproved degrades THIS PATH ONLY — nothing else
 * breaks."
 *
 * Inara is an upgrade over asking an officer, never a dependency. Every failure
 * below has to stop this job and touch nothing: officer-manual verification,
 * role sync, promotions and the site all keep working regardless.
 *
 * And the other one: "nonce-not-found-yet is a NORMAL in-progress state, not an
 * error." Most polls find nothing, because the member has not got round to
 * editing their profile yet.
 */

const NOW = new Date('2026-07-27T12:00:00Z');

class FakeStore implements NonceStore {
  claims: NonceClaim[] = [];
  verified: string[] = [];
  revoked: string[] = [];
  audit: unknown[] = [];

  async pendingFor(): Promise<NonceClaim | null> {
    return null;
  }
  async byId(id: string): Promise<NonceClaim | null> {
    return this.claims.find((c) => c.id === id) ?? null;
  }
  async listPollable(): Promise<NonceClaim[]> {
    return this.claims.filter((c) => !c.isVerified && c.revokedAt === null);
  }
  async verifiedHolderOf(): Promise<NonceClaim | null> {
    return null;
  }
  async createPending(): Promise<NonceClaim> {
    throw new Error('not used');
  }
  async markVerified(id: string): Promise<void> {
    this.verified.push(id);
    const c = this.claims.find((x) => x.id === id);
    if (c !== undefined) (c as { isVerified: boolean }).isVerified = true;
  }
  async revoke(id: string): Promise<void> {
    this.revoked.push(id);
  }
  async writeAudit(e: unknown): Promise<void> {
    this.audit.push(e);
  }
}

const claim = (over: Partial<NonceClaim> = {}): NonceClaim => ({
  id: 'c1',
  userId: 'u1',
  cmdrName: 'GRIM',
  claimNonce: 'GRIMS-ABC234',
  nonceExpiresAt: new Date(NOW.getTime() + 3_600_000),
  isVerified: false,
  revokedAt: null,
  createdAt: NOW,
  ...over,
});

/** A stand-in for the adapter — the adapter's own behaviour is tested separately. */
function fakeInara(behaviour: (name: string) => Promise<{ bio: string } | null>) {
  return { getCommanderProfile: behaviour } as never;
}

let store: FakeStore;
let nonce: NonceService;

beforeEach(() => {
  store = new FakeStore();
  nonce = new NonceService(store);
});

describe('the normal cases', () => {
  it('verifies a claim whose nonce is in the bio', async () => {
    store.claims = [claim()];
    const r = await pollInaraNonces(
      nonce,
      fakeInara(async () => ({ bio: 'CMDR GRIM — GRIMS-ABC234' })),
      NOW,
    );

    expect(r.verified).toBe(1);
    expect(store.verified).toEqual(['c1']);
  });

  it('MANDATORY: a bio without the nonce is counted as PENDING, not an error', async () => {
    // The common case, for as long as it takes the member to edit their
    // profile. Counting it as an error would fill the log with alarms about
    // the system working correctly.
    store.claims = [claim()];
    const r = await pollInaraNonces(nonce, fakeInara(async () => ({ bio: 'nothing here' })), NOW);

    expect(r.stillPending).toBe(1);
    expect(r.errors).toBe(0);
    expect(store.verified).toEqual([]);
  });

  it('treats an unknown commander as pending, not as a failure', async () => {
    // Almost always a typo in the name, and indistinguishable from a profile
    // not created yet. The claim expires on its own and they start again.
    store.claims = [claim()];
    const r = await pollInaraNonces(nonce, fakeInara(async () => null), NOW);

    expect(r.stillPending).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('does nothing when there is nothing to poll', async () => {
    const r = await pollInaraNonces(nonce, fakeInara(async () => ({ bio: '' })), NOW);
    expect(r.checked).toBe(0);
    expect(r.abandoned).toBe(false);
  });

  it('MANDATORY: never polls an expired claim', async () => {
    // Inara allows two calls a MINUTE globally. Abandoned claims would consume
    // that budget forever and starve the members actually waiting.
    let calls = 0;
    store.claims = [claim({ nonceExpiresAt: new Date(NOW.getTime() - 1) })];
    await pollInaraNonces(
      nonce,
      fakeInara(async () => {
        calls += 1;
        return { bio: '' };
      }),
      NOW,
    );
    expect(calls).toBe(0);
  });
});

describe('degrading alone', () => {
  it('MANDATORY: a rejected API key ABANDONS the run and says why', async () => {
    // Every remaining claim would fail identically, so continuing burns the
    // whole rate-limit budget proving it. This is the failure that needs a
    // human, and it is otherwise completely silent.
    store.claims = [claim({ id: 'c1' }), claim({ id: 'c2' })];
    const r = await pollInaraNonces(
      nonce,
      fakeInara(async () => {
        throw new InaraNotApprovedError(401, 'Access denied');
      }),
      NOW,
    );

    expect(r.abandoned).toBe(true);
    expect(r.note).toMatch(/api key/i);
    // And it says the other path still works, because that is the thing a
    // reader needs to know before they start worrying.
    expect(r.note).toMatch(/officer-manual/i);
  });

  it('MANDATORY: a transient failure leaves the claim ALONE for the next run', async () => {
    // Nothing is revoked and nothing is verified. The claim has a 24-hour TTL,
    // so there is plenty of room to simply be patient.
    store.claims = [claim()];
    const r = await pollInaraNonces(
      nonce,
      fakeInara(async () => {
        throw new InaraApiError('Inara request timed out.', 0, true);
      }),
      NOW,
    );

    expect(r.errors).toBe(1);
    expect(r.abandoned).toBe(false);
    expect(store.verified).toEqual([]);
    expect(store.revoked).toEqual([]);
  });

  it('one claim failing does not stop the others', async () => {
    // A single bad commander name must not block everyone behind it in the
    // queue — that would make one member's typo everybody's outage.
    store.claims = [claim({ id: 'c1', cmdrName: 'BAD' }), claim({ id: 'c2', cmdrName: 'GRIM' })];
    const r = await pollInaraNonces(
      nonce,
      fakeInara(async (name) => {
        if (name === 'BAD') throw new InaraApiError('boom', 500, true);
        return { bio: 'GRIMS-ABC234' };
      }),
      NOW,
    );

    expect(r.errors).toBe(1);
    expect(r.verified).toBe(1);
    expect(store.verified).toEqual(['c2']);
  });
});
