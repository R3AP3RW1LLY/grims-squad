import { describe, it, expect, beforeEach } from 'vitest';
import { NonceService, formatNonce, type NonceStore, type NonceClaim } from './nonce.service.js';

/**
 * P1.8b — CMDR verification by Inara nonce (trust tier 2).
 *
 * The member puts a short code in their Inara profile; the worker reads the
 * profile and confirms it. That proves they control the Inara account, which is
 * bound to a CMDR name — weaker than Frontier's cAPI, much stronger than an
 * officer taking their word for it.
 *
 * ★ THE RULE THAT SHAPES THIS WHOLE FILE ★
 *
 * "Nonce-not-found-yet is a NORMAL in-progress state, not an error."
 *
 * The member has to go to another website and edit their profile. Between
 * issuing the nonce and them doing that, EVERY poll finds nothing — that is the
 * expected case, not a failure. Treating it as an error fills the log with
 * alarms about the system working correctly, and buries the one poll that
 * genuinely broke.
 *
 * ★ AND INV-005, RED-TEAM R7 ★
 *
 * A pending claim takes NO lock on the CMDR name, and expires. Otherwise any
 * member could permanently deny any name — including every officer's — by
 * opening a claim and walking away.
 */

const NOW = new Date('2026-07-27T12:00:00Z');
const TTL_MS = 24 * 60 * 60 * 1000;

class FakeNonceStore implements NonceStore {
  claims: NonceClaim[] = [];
  verified: Array<{ id: string; tier: number }> = [];
  audit: Array<Record<string, unknown>> = [];
  #id = 0;

  async pendingFor(userId: string): Promise<NonceClaim | null> {
    return this.claims.find((c) => c.userId === userId && c.revokedAt === null) ?? null;
  }
  async byId(id: string): Promise<NonceClaim | null> {
    return this.claims.find((c) => c.id === id) ?? null;
  }
  async listPollable(): Promise<NonceClaim[]> {
    return this.claims.filter((c) => c.revokedAt === null && !c.isVerified);
  }
  async verifiedHolderOf(cmdrName: string): Promise<NonceClaim | null> {
    return (
      this.claims.find(
        (c) => c.cmdrName.toLowerCase() === cmdrName.toLowerCase() && c.isVerified && c.revokedAt === null,
      ) ?? null
    );
  }
  async createPending(
    userId: string,
    cmdrName: string,
    nonce: string,
    expiresAt: Date,
    at: Date,
  ): Promise<NonceClaim> {
    this.#id += 1;
    const row: NonceClaim = {
      id: `n${this.#id}`,
      userId,
      cmdrName,
      claimNonce: nonce,
      nonceExpiresAt: expiresAt,
      isVerified: false,
      revokedAt: null,
      createdAt: at,
    };
    this.claims.push(row);
    return row;
  }
  async markVerified(id: string, tier: number, at: Date): Promise<void> {
    this.verified.push({ id, tier });
    const c = this.claims.find((x) => x.id === id);
    if (c !== undefined) (c as { isVerified: boolean }).isVerified = true;
    void at;
  }
  async revoke(id: string, at: Date): Promise<void> {
    const c = this.claims.find((x) => x.id === id);
    if (c !== undefined) (c as { revokedAt: Date | null }).revokedAt = at;
  }
  async writeAudit(e: Record<string, unknown>): Promise<void> {
    this.audit.push(e);
  }
}

let store: FakeNonceStore;
let svc: NonceService;

beforeEach(() => {
  store = new FakeNonceStore();
  svc = new NonceService(store);
});

describe('issuing a nonce', () => {
  it('issues a claim with a nonce and a TTL', async () => {
    const c = await svc.issue('u1', 'GRIM', NOW);
    expect(c.claimNonce).toMatch(/^GRIMS-[A-Z0-9]{6}$/);
    expect(c.nonceExpiresAt.getTime()).toBe(NOW.getTime() + TTL_MS);
    expect(c.isVerified).toBe(false);
  });

  it('MANDATORY: a pending claim does NOT lock the name against anyone else', async () => {
    // RED-TEAM R7. If it did, any member could deny every officer their own
    // CMDR name by opening a claim and never finishing it.
    await svc.issue('squatter', 'GRIM', NOW);
    await expect(svc.issue('u1', 'GRIM', NOW)).resolves.toMatchObject({ userId: 'u1' });
  });

  it('refuses a name another member has already VERIFIED', async () => {
    await svc.issue('u1', 'GRIM', NOW);
    await svc.recordFound('n1', NOW);
    await expect(svc.issue('u2', 'GRIM', NOW)).rejects.toThrow(/already/i);
  });

  it('replaces the member’s own earlier pending claim', async () => {
    await svc.issue('u1', 'GRMI', NOW);
    await svc.issue('u1', 'GRIM', NOW);
    expect((await store.listPollable()).filter((c) => c.revokedAt === null)).toHaveLength(1);
  });

  it('the nonce is unguessable, not sequential', async () => {
    // A predictable nonce would let someone put SOMEONE ELSE's pending nonce in
    // their own Inara bio and be verified as that commander.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add((await svc.issue(`u${i}`, `CMDR${i}`, NOW)).claimNonce);
    }
    expect(seen.size).toBe(50);
  });

  it('formats with a recognisable prefix', () => {
    expect(formatNonce('ABC234')).toBe('GRIMS-ABC234');
  });

  it('MANDATORY: the GENERATED part contains no ambiguous glyphs', async () => {
    // Somebody reads this off one screen and types it into another. O/0, I/1
    // and L turn "the code does not work" into a support conversation where
    // neither party can see what the other typed.
    //
    // The rule applies to the generated BODY — the fixed "GRIMS-" prefix has an
    // I in it and is never mistyped, because it is the same every time.
    for (let i = 0; i < 200; i += 1) {
      const body = (await svc.issue(`u${i}`, `CMDR${i}`, NOW)).claimNonce.slice('GRIMS-'.length);
      expect(body, body).not.toMatch(/[OIL01]/);
      expect(body).toMatch(/^[A-Z2-9]{6}$/);
    }
  });
});

describe('polling — the in-progress state', () => {
  beforeEach(async () => {
    await svc.issue('u1', 'GRIM', NOW);
  });

  it('MANDATORY: a bio without the nonce is IN PROGRESS, not an error', async () => {
    // The expected case for as long as it takes the member to go and edit their
    // profile. Treating it as an error means alarms about the system working.
    const r = await svc.checkBio('n1', 'Just a normal Elite player.', NOW);
    expect(r.outcome).toBe('pending');
    expect(store.verified).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('verifies at trust tier 2 when the nonce IS in the bio', async () => {
    const claim = await store.byId('n1');
    const r = await svc.checkBio('n1', `Flying with Grim's Squad. ${claim?.claimNonce}`, NOW);
    expect(r.outcome).toBe('verified');
    expect(store.verified).toEqual([{ id: 'n1', tier: 2 }]);
  });

  it('matches the nonce case-insensitively and ignoring surrounding text', async () => {
    // People paste it into a sentence, and Inara lower-cases nothing reliably.
    const claim = await store.byId('n1');
    const r = await svc.checkBio(
      'n1',
      `verification code: ${claim?.claimNonce.toLowerCase()} — thanks!`,
      NOW,
    );
    expect(r.outcome).toBe('verified');
  });

  it('MANDATORY: an EXPIRED nonce reports expired and does not verify', async () => {
    const past = new Date(NOW.getTime() + TTL_MS + 1);
    const claim = await store.byId('n1');
    const r = await svc.checkBio('n1', `${claim?.claimNonce}`, past);

    expect(r.outcome).toBe('expired');
    expect(store.verified).toEqual([]);
    // And the claim is revoked, so the NAME IS FREE again — an abandoned claim
    // must never hold a name hostage (INV-005).
    expect((await store.byId('n1'))?.revokedAt).not.toBeNull();
  });

  it('MANDATORY: refuses if another member verified the name meanwhile', async () => {
    // Two members can both hold a pending claim, because pending takes no lock.
    // The conflict is only decidable at the moment one of them becomes real.
    await svc.issue('u2', 'GRIM', NOW);
    await svc.recordFound('n1', NOW);

    const claim2 = await store.byId('n2');
    const r = await svc.checkBio('n2', `${claim2?.claimNonce}`, NOW);
    expect(r.outcome).toBe('conflict');
    expect(store.verified).toEqual([{ id: 'n1', tier: 2 }]);
  });

  it('audits a verification, and only a verification', async () => {
    const claim = await store.byId('n1');
    await svc.checkBio('n1', 'nothing here', NOW);
    expect(store.audit).toEqual([]);

    await svc.checkBio('n1', `${claim?.claimNonce}`, NOW);
    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]?.['action']).toBe('cmdr.verify.inara');
    // No actor — nobody approved this, a poll observed it.
    expect(store.audit[0]?.['actorId']).toBeNull();
  });

  it('is idempotent — a second successful check does not re-verify', async () => {
    const claim = await store.byId('n1');
    await svc.checkBio('n1', `${claim?.claimNonce}`, NOW);
    await svc.checkBio('n1', `${claim?.claimNonce}`, NOW);
    expect(store.verified).toHaveLength(1);
  });
});

describe('what is pollable', () => {
  it('MANDATORY: an expired claim is not polled again', async () => {
    // Otherwise abandoned claims consume the 2-per-minute Inara budget forever
    // and starve the members who are actually waiting.
    await svc.issue('u1', 'GRIM', NOW);
    const later = new Date(NOW.getTime() + TTL_MS + 1);

    const due = await svc.duePolls(later);
    expect(due).toEqual([]);
  });

  it('returns claims that are still within their TTL', async () => {
    await svc.issue('u1', 'GRIM', NOW);
    expect(await svc.duePolls(NOW)).toHaveLength(1);
  });
});
