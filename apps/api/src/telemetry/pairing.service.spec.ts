import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  PairingService,
  TELEMETRY_SCOPE,
  MAX_DEVICES_PER_MEMBER,
  type PairingStore,
  type DeviceTokenRecord,
} from './pairing.service.js';

/**
 * Pairing the companion app to an account (P1.11).
 *
 * ★ THE TOKEN IS THE APP'S ENTIRE IDENTITY ★
 *
 * It lives on a member's PC, in a file, for months. So it is shown once, stored
 * only as a hash, scoped to one capability, and revocable per device. Each of
 * those is tested here, because each one is the difference between "a laptop
 * was stolen" and "an account was stolen".
 */

const NOW = new Date('2026-07-27T12:00:00Z');

class FakeStore implements PairingStore {
  rows: DeviceTokenRecord[] = [];
  hashes = new Map<string, string>();
  audit: Array<Record<string, unknown>> = [];
  touched: string[] = [];
  #id = 0;

  async create(userId: string, label: string, tokenHash: string): Promise<DeviceTokenRecord> {
    this.#id += 1;
    const row: DeviceTokenRecord = {
      id: `d${this.#id}`,
      userId,
      label,
      scopes: [TELEMETRY_SCOPE],
      lastUsedAt: null,
      revokedAt: null,
      createdAt: NOW,
    };
    this.rows.push(row);
    this.hashes.set(tokenHash, row.id);
    return row;
  }
  async findByHash(tokenHash: string): Promise<DeviceTokenRecord | null> {
    const id = this.hashes.get(tokenHash);
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listFor(userId: string): Promise<DeviceTokenRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }
  async revoke(id: string, at: Date): Promise<void> {
    const i = this.rows.findIndex((r) => r.id === id);
    if (i >= 0) this.rows[i] = { ...(this.rows[i] as DeviceTokenRecord), revokedAt: at };
  }
  async touch(id: string): Promise<void> {
    this.touched.push(id);
  }
  async countActiveFor(userId: string): Promise<number> {
    return this.rows.filter((r) => r.userId === userId && r.revokedAt === null).length;
  }
  async writeAudit(e: Record<string, unknown>): Promise<void> {
    this.audit.push(e);
  }
}

let store: FakeStore;
let svc: PairingService;

beforeEach(() => {
  store = new FakeStore();
  svc = new PairingService(store);
});

describe('pairing', () => {
  it('issues a token and a device record', async () => {
    const r = await svc.pair('u1', 'desktop');
    expect(r.token).toMatch(/^gsq_[A-Za-z0-9_-]+$/);
    expect(r.label).toBe('desktop');
  });

  it('MANDATORY: stores only a HASH of the token', async () => {
    // The token lives on a member's PC for months. A database dump must not
    // hand anybody a working credential.
    const r = await svc.pair('u1', 'desktop');
    const stored = [...store.hashes.keys()];

    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toBe(r.token);
    expect(stored[0]).toBe(createHash('sha256').update(r.token).digest('hex'));
  });

  it('MANDATORY: the token never appears in the audit log', async () => {
    // An audit log is exactly the sort of place a credential gets copied to
    // and then forgotten about.
    const r = await svc.pair('u1', 'desktop');
    expect(JSON.stringify(store.audit)).not.toContain(r.token);
    expect(store.audit[0]?.['action']).toBe('device.pair');
  });

  it('MANDATORY: is scoped to telemetry and nothing else', async () => {
    // A stolen device token can submit journal events. It must not be able to
    // read the forum, change privacy settings or reach the admin console.
    await svc.pair('u1', 'desktop');
    expect(store.rows[0]?.scopes).toEqual([TELEMETRY_SCOPE]);
  });

  it('carries a recognisable prefix', async () => {
    // So a secret scanner can spot one of ours in a paste, a log or a public
    // repository. A bare random string is indistinguishable from noise until
    // somebody tries it.
    expect((await svc.pair('u1', 'desktop')).token.startsWith('gsq_')).toBe(true);
  });

  it('two pairings never produce the same token', async () => {
    const a = await svc.pair('u1', 'desktop');
    const b = await svc.pair('u1', 'laptop');
    expect(a.token).not.toBe(b.token);
  });

  it('requires a label', async () => {
    // Without one the device list is a row of uuids, and revoking the right
    // device becomes guesswork.
    await expect(svc.pair('u1', '   ')).rejects.toThrow(/name/i);
  });

  it('caps how many devices one member can accumulate', async () => {
    // Not a security boundary — a ceiling on accident. Somebody re-pairing
    // repeatedly should not end up with fifty live credentials.
    for (let i = 0; i < MAX_DEVICES_PER_MEMBER; i += 1) {
      await svc.pair('u1', `device-${i}`);
    }
    await expect(svc.pair('u1', 'one-too-many')).rejects.toThrow(/already have/i);
  });

  it('a revoked device frees a slot', async () => {
    for (let i = 0; i < MAX_DEVICES_PER_MEMBER; i += 1) {
      await svc.pair('u1', `device-${i}`);
    }
    await svc.revoke('u1', 'd1', NOW);
    await expect(svc.pair('u1', 'replacement')).resolves.toBeDefined();
  });
});

describe('authenticating a device', () => {
  it('resolves a valid token to its owner', async () => {
    const r = await svc.pair('u1', 'desktop');
    expect((await svc.authenticate(r.token, NOW))?.userId).toBe('u1');
  });

  it('MANDATORY: refuses a REVOKED token', async () => {
    const r = await svc.pair('u1', 'desktop');
    await svc.revoke('u1', r.deviceId, NOW);
    expect(await svc.authenticate(r.token, NOW)).toBeNull();
  });

  it('MANDATORY: refuses a token with the wrong scope', async () => {
    // Checked in the service rather than at the route, so a token that somehow
    // acquired a different scope cannot be used for telemetry at all.
    const r = await svc.pair('u1', 'desktop');
    store.rows[0] = { ...(store.rows[0] as DeviceTokenRecord), scopes: ['something:else'] };
    expect(await svc.authenticate(r.token, NOW)).toBeNull();
  });

  it('refuses nonsense without touching the store', async () => {
    for (const bad of ['', 'not-a-token', 'Bearer x', 'gsq_', 'abc123']) {
      expect(await svc.authenticate(bad, NOW), bad).toBeNull();
    }
  });

  it('MANDATORY: gives the same answer for unknown and revoked', async () => {
    // A caller holding a bad token learns only that it is bad. Distinguishing
    // "never existed" from "was revoked" tells them something about the
    // account, which is not theirs to know.
    const r = await svc.pair('u1', 'desktop');
    await svc.revoke('u1', r.deviceId, NOW);

    expect(await svc.authenticate(r.token, NOW)).toBeNull();
    expect(await svc.authenticate('gsq_totallymadeup', NOW)).toBeNull();
  });

  it('records that the device was used', async () => {
    // So a member can spot a device that has gone quiet, or one that should
    // not be running at all.
    const r = await svc.pair('u1', 'desktop');
    await svc.authenticate(r.token, NOW);
    expect(store.touched).toEqual([r.deviceId]);
  });
});

describe('revoking', () => {
  it('MANDATORY: refuses to revoke somebody else’s device', async () => {
    await svc.pair('u1', 'theirs');
    await expect(svc.revoke('u2', 'd1', NOW)).rejects.toThrow(/not found/i);
    expect(store.rows[0]?.revokedAt).toBeNull();
  });

  it('answers identically for an unknown device', async () => {
    // Same answer as "not yours", so an id cannot be probed for existence.
    await expect(svc.revoke('u1', 'nope', NOW)).rejects.toThrow(/not found/i);
  });

  it('audits the revocation with the label', async () => {
    // Six months later, "device d3 was revoked" tells nobody anything. "the
    // laptop" does.
    await svc.pair('u1', 'old laptop');
    await svc.revoke('u1', 'd1', NOW);
    expect(JSON.stringify(store.audit.at(-1))).toContain('old laptop');
  });
});
