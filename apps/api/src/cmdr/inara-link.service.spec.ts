import { describe, it, expect, beforeEach } from 'vitest';
import { InaraLinkService, type InaraLinkStore, type LinkRecord } from './inara-link.service.js';

/**
 * P1.8b — verification by the member's OWN Inara API key.
 *
 * ★ THE ONE PROPERTY THAT MAKES THIS VERIFICATION ★
 *
 * The commander name comes back FROM INARA. It is never a name the member
 * typed. Calling Inara with their key returns the commander bound to that
 * account, so holding the key is the proof — and the name is a consequence of
 * it rather than an assertion alongside it.
 *
 * If this ever accepts a caller-supplied name, the whole thing silently
 * degrades to self-declaration while still reporting trust tier 2, which is
 * worse than not having it: an officer would trust a claim nobody checked.
 *
 * ★ AND THE KEY ITSELF NEVER LEAVES ★
 *
 * It is a credential for the member's Inara account. Encrypted at rest, never
 * in a response, never in an error message (INV-012).
 */

const NOW = new Date('2026-07-27T12:00:00Z');

class FakeStore implements InaraLinkStore {
  links = new Map<string, LinkRecord>();
  saved: Array<{ userId: string; key: string; source: string }> = [];
  verifications: Array<{ userId: string; cmdrName: string; tier: number }> = [];
  audit: Array<Record<string, unknown>> = [];
  holderOf = new Map<string, string>();

  async get(userId: string): Promise<LinkRecord | null> {
    return this.links.get(userId) ?? null;
  }
  async saveKey(userId: string, apiKey: string, source: string): Promise<void> {
    this.saved.push({ userId, key: apiKey, source });
    this.links.set(userId, {
      userId,
      apiKey,
      cmdrName: null,
      verifiedAt: null,
      lastCheckedAt: null,
      lastError: null,
      source,
    });
  }
  async recordSuccess(userId: string, cmdrName: string, at: Date): Promise<void> {
    const l = this.links.get(userId);
    if (l !== undefined) {
      this.links.set(userId, { ...l, cmdrName, verifiedAt: at, lastCheckedAt: at, lastError: null });
    }
  }
  async recordFailure(userId: string, error: string, at: Date): Promise<void> {
    const l = this.links.get(userId);
    if (l !== undefined) this.links.set(userId, { ...l, lastCheckedAt: at, lastError: error });
  }
  async remove(userId: string): Promise<void> {
    this.links.delete(userId);
  }
  async verifiedHolderOf(cmdrName: string): Promise<string | null> {
    return this.holderOf.get(cmdrName.toLowerCase()) ?? null;
  }
  async upsertVerification(userId: string, cmdrName: string, tier: number): Promise<void> {
    this.verifications.push({ userId, cmdrName, tier });
  }

  /** What Inara said about each member's squadron, in call order. */
  squadrons: Array<{ userId: string; reported: string | null; matched: boolean }> = [];
  claims: string[] = [];

  async recordSquadron(
    userId: string,
    reported: string | null,
    matched: boolean,
  ): Promise<void> {
    this.squadrons.push({ userId, reported, matched });
  }
  async claimSquadron(userId: string): Promise<void> {
    this.claims.push(userId);
  }
  async squadronState(userId: string) {
    const v = this.verifications.filter((x) => x.userId === userId).at(-1);
    if (v === undefined) return null;
    const s = this.squadrons.filter((x) => x.userId === userId).at(-1);
    return {
      cmdrName: v.cmdrName,
      isVerified: true,
      inaraSquadron: s?.reported ?? null,
      squadronVerifiedAt: s?.matched === true ? new Date() : null,
      squadronClaimedAt: this.claims.includes(userId) ? new Date() : null,
      squadronCheckedAt: s === undefined ? null : new Date(),
    };
  }
  async writeAudit(e: Record<string, unknown>): Promise<void> {
    this.audit.push(e);
  }
}

/** Stands in for the Inara adapter. Returns the name for whichever key it is given. */
function fakeInara(byKey: Record<string, string | Error>) {
  return {
    getOwnCommanderName: async (apiKey: string): Promise<string | null> => {
      const r = byKey[apiKey];
      if (r instanceof Error) throw r;
      return r ?? null;
    },
  } as never;
}

let store: FakeStore;
let svc: InaraLinkService;

beforeEach(() => {
  store = new FakeStore();
  svc = new InaraLinkService(store, fakeInara({ 'good-key': 'GRIM', 'other-key': 'AVA' }));
});

describe('linking a key', () => {
  it('stores the key and records the name INARA returned', async () => {
    const r = await svc.link('u1', 'good-key', 'web', NOW);

    expect(r.cmdrName).toBe('GRIM');
    expect(r.verified).toBe(true);
    expect(store.verifications).toEqual([{ userId: 'u1', cmdrName: 'GRIM', tier: 2 }]);
  });

  it('MANDATORY: there is no way to supply the commander name', async () => {
    // The signature itself is the guarantee. If a name could be passed, this
    // would quietly become self-declaration while still reporting tier 2 — an
    // officer would then trust a claim nobody had checked.
    expect(svc.link.length).toBeLessThanOrEqual(4);
    const r = await svc.link('u1', 'other-key', 'web', NOW);
    // The name follows the KEY, not anything the caller wanted.
    expect(r.cmdrName).toBe('AVA');
  });

  it('MANDATORY: rejects a key Inara does not recognise, and stores nothing', async () => {
    await expect(svc.link('u1', 'nonsense-key', 'web', NOW)).rejects.toThrow(/did not recognise|invalid/i);
    expect(store.links.has('u1')).toBe(false);
    expect(store.verifications).toEqual([]);
  });

  it('MANDATORY: refuses when another member already holds that commander', async () => {
    // Two people cannot both be CMDR GRIM. The Inara key proves control of an
    // account, not exclusive right to a name that somebody else verified first.
    store.holderOf.set('grim', 'someone-else');
    await expect(svc.link('u1', 'good-key', 'web', NOW)).rejects.toThrow(/already/i);
    expect(store.links.has('u1')).toBe(false);
  });

  it('allows re-linking when the SAME member already holds that commander', async () => {
    store.holderOf.set('grim', 'u1');
    await expect(svc.link('u1', 'good-key', 'web', NOW)).resolves.toMatchObject({ cmdrName: 'GRIM' });
  });

  it('records which surface the key arrived from', async () => {
    // A key added in the desktop app appears on the website with no action from
    // the member. Six months later somebody will ask how it got there.
    await svc.link('u1', 'good-key', 'app', NOW);
    expect(store.saved[0]?.source).toBe('app');
  });

  it('rejects an empty key without calling Inara', async () => {
    await expect(svc.link('u1', '   ', 'web', NOW)).rejects.toThrow(/key/i);
  });
});

describe('@INV-012 the key never leaves', () => {
  it('MANDATORY: the link response contains no API key', async () => {
    const r = await svc.link('u1', 'good-key', 'web', NOW);
    expect(JSON.stringify(r)).not.toContain('good-key');
  });

  it('MANDATORY: the status response contains no API key', async () => {
    await svc.link('u1', 'good-key', 'web', NOW);
    const status = await svc.status('u1');
    expect(JSON.stringify(status)).not.toContain('good-key');
    // It says a key EXISTS, which the member needs to know, without disclosing it.
    expect(status.linked).toBe(true);
    expect(status.cmdrName).toBe('GRIM');
  });

  it('MANDATORY: an Inara failure message never carries the key', async () => {
    const boom = new Error('Inara rejected key good-key');
    const s = new InaraLinkService(store, fakeInara({ 'good-key': boom }));
    const err = await s.link('u1', 'good-key', 'web', NOW).catch((e: Error) => e);
    expect(String(err)).not.toContain('good-key');
  });
});

describe('re-checking an existing link', () => {
  beforeEach(async () => {
    await svc.link('u1', 'good-key', 'web', NOW);
  });

  it('updates the name when the commander was renamed on Inara', async () => {
    const s = new InaraLinkService(store, fakeInara({ 'good-key': 'GRIMLIER' }));
    const r = await s.refresh('u1', NOW);
    expect(r.cmdrName).toBe('GRIMLIER');
    expect(store.verifications.at(-1)).toEqual({ userId: 'u1', cmdrName: 'GRIMLIER', tier: 2 });
  });

  it('MANDATORY: a failed re-check does NOT revoke an existing verification', async () => {
    // Inara being down is not evidence that a member is lying. Dropping their
    // verified status on a transient failure would demote people for someone
    // else's outage.
    const s = new InaraLinkService(store, fakeInara({ 'good-key': new Error('503') }));
    const r = await s.refresh('u1', NOW);

    expect(r.verified).toBe(true);
    expect(r.cmdrName).toBe('GRIM');
    expect(r.error).toMatch(/could not/i);
    expect((await store.get('u1'))?.lastError).not.toBeNull();
  });

  it('reports no link rather than throwing when there is none', async () => {
    expect((await svc.status('nobody')).linked).toBe(false);
  });
});

describe('unlinking', () => {
  it('removes the key', async () => {
    await svc.link('u1', 'good-key', 'web', NOW);
    await svc.unlink('u1', NOW);
    expect(store.links.has('u1')).toBe(false);
  });

  it('MANDATORY: unlinking does NOT un-verify the commander name', async () => {
    // The member proved it. Removing the stored credential is a privacy choice
    // — "stop calling Inara on my behalf" — not a retraction of the proof, and
    // it must not silently demote them to unverified.
    await svc.link('u1', 'good-key', 'web', NOW);
    const before = store.verifications.length;
    await svc.unlink('u1', NOW);

    expect(store.verifications).toHaveLength(before);
    expect(JSON.stringify(store.audit.at(-1))).toMatch(/unlink/i);
  });
});
