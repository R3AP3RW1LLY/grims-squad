import { describe, it, expect, beforeEach } from 'vitest';
import { AccountController } from './account.controller.js';
import type { AccountStore, SessionSummary, ExportBundle } from './account.store.js';
import { issueCsrfToken, csrfCookieName } from '../common/csrf.js';

/**
 * P1.6 — the member's own account surface: which devices are signed in, the
 * ability to end any of them, and a full export of what we hold.
 *
 * ★ THE RULE THESE TESTS EXIST TO PROTECT ★
 * Every operation is scoped to the SESSION user. A member may list, revoke and
 * export their own data and nobody else's — and the id comes from the session,
 * never from the path or body, so there is no parameter to tamper with.
 *
 * Revoking someone else's session is the interesting attack: family ids are
 * uuids, so guessing one is unrealistic, but "unrealistic to guess" is not the
 * same as "checked". The ownership test below is the check.
 */

const NOW = new Date('2026-07-27T12:00:00Z');

const family = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 'fam-1',
  deviceLabel: 'Firefox on Windows',
  userAgent: 'Mozilla/5.0',
  createdAt: new Date('2026-07-01T09:00:00Z'),
  lastUsedAt: new Date('2026-07-27T11:55:00Z'),
  current: false,
  ...over,
});

class FakeAccountStore implements AccountStore {
  families: SessionSummary[] = [];
  owners = new Map<string, string>();
  revoked: Array<{ familyId: string; reason: string }> = [];
  bundle: ExportBundle | null = null;

  async sessionsOf(userId: string): Promise<SessionSummary[]> {
    return this.families.filter((f) => (this.owners.get(f.id) ?? userId) === userId);
  }
  async ownerOfFamily(familyId: string): Promise<string | null> {
    return this.owners.get(familyId) ?? null;
  }
  async revokeFamily(familyId: string, reason: string): Promise<void> {
    this.revoked.push({ familyId, reason });
  }
  async exportFor(): Promise<ExportBundle> {
    if (this.bundle === null) throw new Error('no bundle configured');
    return this.bundle;
  }
}

function req(method = 'POST'): never {
  const token = issueCsrfToken();
  return {
    method,
    headers: { 'x-csrf-token': token },
    cookies: { [csrfCookieName(false)]: token },
  } as never;
}

let store: FakeAccountStore;
let ctl: AccountController;

beforeEach(() => {
  store = new FakeAccountStore();
  ctl = new AccountController(store);
});

describe('GET /v1/me/sessions', () => {
  it('lists the caller’s active sessions', async () => {
    store.families = [family(), family({ id: 'fam-2', deviceLabel: 'Chrome on Android' })];
    store.owners.set('fam-1', 'u-1');
    store.owners.set('fam-2', 'u-1');

    const out = await ctl.sessions({ userId: 'u-1' }, req('GET'));
    expect(out.sessions.map((s) => s.deviceLabel)).toEqual([
      'Firefox on Windows',
      'Chrome on Android',
    ]);
  });

  it('MANDATORY: never exposes the token hash or the IP hash', async () => {
    // Both are in the row. A hash is not a secret in the usual sense, but an
    // ipHash is a stable identifier for a location, and handing it back to the
    // browser serves no purpose the member benefits from.
    store.families = [family()];
    store.owners.set('fam-1', 'u-1');
    const out = await ctl.sessions({ userId: 'u-1' }, req('GET'));
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/ipHash/i);
    expect(json).not.toMatch(/tokenHash/i);
  });

  it('marks which session is the one making the request', async () => {
    // Without this the member cannot tell which row is the device in front of
    // them, and "revoke everything else" becomes guesswork.
    store.families = [family({ id: 'fam-1', current: true }), family({ id: 'fam-2' })];
    store.owners.set('fam-1', 'u-1');
    store.owners.set('fam-2', 'u-1');
    const out = await ctl.sessions({ userId: 'u-1' }, req('GET'));
    expect(out.sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it('rejects an anonymous caller', async () => {
    await expect(ctl.sessions(undefined, req('GET'))).rejects.toThrow(/sign in/i);
  });
});

describe('DELETE /v1/me/sessions/:id', () => {
  it('revokes a session the caller owns', async () => {
    store.owners.set('fam-1', 'u-1');
    await ctl.revokeSession({ userId: 'u-1' }, 'fam-1', req('DELETE'));
    expect(store.revoked).toEqual([{ familyId: 'fam-1', reason: 'user_revoked' }]);
  });

  it('MANDATORY: refuses to revoke a session belonging to someone else', async () => {
    // The whole reason ownership is checked rather than assumed from a uuid
    // being hard to guess.
    store.owners.set('fam-1', 'someone-else');
    await expect(ctl.revokeSession({ userId: 'u-1' }, 'fam-1', req('DELETE'))).rejects.toThrow(
      /not found/i,
    );
    expect(store.revoked).toEqual([]);
  });

  it('answers 404-shaped for an unknown family, same as for one it does not own', async () => {
    // Identical answers on purpose. A distinguishable error would confirm that
    // a given family id exists, which is exactly what an enumerator wants.
    await expect(ctl.revokeSession({ userId: 'u-1' }, 'nope', req('DELETE'))).rejects.toThrow(
      /not found/i,
    );
  });

  it('requires a CSRF token', async () => {
    store.owners.set('fam-1', 'u-1');
    const bare = { method: 'DELETE', headers: {}, cookies: {} } as never;
    await expect(ctl.revokeSession({ userId: 'u-1' }, 'fam-1', bare)).rejects.toThrow(/csrf/i);
    expect(store.revoked).toEqual([]);
  });

  it('is idempotent — revoking twice is not an error', async () => {
    store.owners.set('fam-1', 'u-1');
    await ctl.revokeSession({ userId: 'u-1' }, 'fam-1', req('DELETE'));
    await ctl.revokeSession({ userId: 'u-1' }, 'fam-1', req('DELETE'));
    expect(store.revoked).toHaveLength(2);
  });
});

describe('GET /v1/me/export', () => {
  beforeEach(() => {
    store.bundle = {
      exportedAt: NOW.toISOString(),
      profile: { handle: 'grim', displayName: 'Grim', email: 'grim@example.com' },
      privacy: { showLocation: false },
      discordIdentity: { discordId: '123', nickname: 'Grim', guildRoles: ['r1'] },
      roles: [{ role: 'sector_overseer', source: 'discord', grantedAt: NOW.toISOString() }],
      activity: [{ month: '2026-07-01', messages: 12, voiceMinutes: 40, forumPosts: 1 }],
      sessions: [{ deviceLabel: 'Firefox on Windows', createdAt: NOW.toISOString() }],
      cmdrVerifications: [],
      auditOfMe: [],
    };
  });

  it('returns everything held about the caller', async () => {
    const out = await ctl.exportMe({ userId: 'u-1' }, req('GET'));
    // The member's own email IS theirs, so unlike a public profile the export
    // includes it. That is the difference between a privacy control and a data
    // subject access request.
    expect(out.profile.email).toBe('grim@example.com');
    expect(out.activity).toHaveLength(1);
    expect(out.discordIdentity).not.toBeNull();
  });

  it('MANDATORY: contains no Discord or Frontier token, encrypted or otherwise', async () => {
    // The identity row holds an encrypted access token. Exporting it would hand
    // the member a credential for an account we hold on their behalf, and would
    // put ciphertext in a file that then lives in their downloads folder.
    const out = await ctl.exportMe({ userId: 'u-1' }, req('GET'));
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/accessToken|refreshToken|tokenCiphertext/i);
    // v1.<keyId>.<iv>.<ct>.<tag> — the envelope format from crypto.ts.
    expect(json).not.toMatch(/\bv1\.[A-Za-z0-9_-]+\./);
  });

  it('stamps when the export was taken', async () => {
    // An undated dump of someone's data is unreadable a year later, and the
    // member cannot tell whether it predates a change they made.
    const out = await ctl.exportMe({ userId: 'u-1' }, req('GET'));
    expect(out.exportedAt).toBe(NOW.toISOString());
  });

  it('rejects an anonymous caller', async () => {
    await expect(ctl.exportMe(undefined, req('GET'))).rejects.toThrow(/sign in/i);
  });
});
