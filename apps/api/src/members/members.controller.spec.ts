import { describe, it, expect, beforeEach } from 'vitest';
import { MembersController } from './members.controller.js';
import type { MembersStore, MemberRow, DiscordRoleInfo } from './members.store.js';
import type { SnapshotEvent } from './commander-snapshot.js';
import type { PrivacySettings, ProfileSource } from './profile.serializer.js';
import { issueCsrfToken, csrfCookieName } from '../common/csrf.js';

/**
 * @INV-027 at the ENDPOINT, not just in the serializer.
 *
 * The serializer spec proves the shape is right. These prove the endpoints
 * actually use it — a controller that built its own object, or passed
 * `audience: 'self'` to everyone, would sail past the serializer suite while
 * leaking every field in production.
 */

const base = (over: Partial<ProfileSource> = {}): ProfileSource => ({
  id: 'u-1',
  handle: 'grim',
  displayName: 'Grim',
  avatarUrl: null,
  bio: null,
  timezone: 'UTC',
  joinedAt: new Date('2006-04-01T00:00:00Z'),
  status: 'active',
  ranks: [],
  cmdrName: 'GRIM',
  location: { system: 'Shinrarta Dezhra', station: null },
  credits: 900n,
  fleet: [{ shipType: 'Anaconda', name: null }],
  ...over,
});

const PRIVATE: PrivacySettings = {
  showLocation: false,
  showCredits: false,
  showFleet: false,
  showActivity: false,
  showOnPublicRoster: false,
  showOnLeaderboard: false,
};
const ROSTER_ONLY: PrivacySettings = { ...PRIVATE, showOnPublicRoster: true };

class FakeStore implements MembersStore {
  rows: MemberRow[] = [];
  saved: Array<{ userId: string; patch: Partial<PrivacySettings> }> = [];
  stored: Partial<PrivacySettings> | null = null;

  async byHandle(handle: string): Promise<MemberRow | null> {
    return this.rows.find((r) => r.source.handle === handle) ?? null;
  }
  async roster(): Promise<MemberRow[]> {
    return this.rows;
  }
  async privacyOf(): Promise<Partial<PrivacySettings> | null> {
    return this.stored;
  }
  async savePrivacy(userId: string, patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    this.saved.push({ userId, patch });
    return { ...PRIVATE, ...patch };
  }
  async handleOf(): Promise<string | null> {
    return 'grim';
  }

  /** Journal events the roster reads. Empty unless a test sets them. */
  snapshots: SnapshotEvent[] = [];

  async snapshotEvents(userIds: readonly string[]): Promise<SnapshotEvent[]> {
    return this.snapshots.filter((e) => userIds.includes(e.userId));
  }

  /** Guild role names and colours. Empty unless a test sets them. */
  catalogue = new Map<string, DiscordRoleInfo>();

  async discordRoleCatalogue(): Promise<Map<string, DiscordRoleInfo>> {
    return this.catalogue;
  }
}

/** A request carrying a valid CSRF pair, so write tests exercise the real path. */
function req(method = 'PATCH'): never {
  const token = issueCsrfToken();
  return {
    method,
    headers: { 'x-csrf-token': token },
    cookies: { [csrfCookieName(false)]: token },
  } as never;
}

let store: FakeStore;
let ctl: MembersController;

beforeEach(() => {
  store = new FakeStore();
  ctl = new MembersController(store);
});

describe('GET /v1/members/:handle @INV-027', () => {
  it('MANDATORY: an anonymous caller gets no location, credits or fleet', async () => {
    store.rows = [{ source: base(), privacy: PRIVATE }];
    const out = await ctl.profile('grim', undefined);
    expect(out).not.toHaveProperty('location');
    expect(out).not.toHaveProperty('credits');
    expect(out).not.toHaveProperty('fleet');
  });

  it('MANDATORY: a DIFFERENT signed-in member gets the public shape', async () => {
    // Being signed in is not the same as being the subject. Getting this wrong
    // would expose every member's data to every other member.
    store.rows = [{ source: base(), privacy: PRIVATE }];
    const out = await ctl.profile('grim', { userId: 'someone-else' });
    expect(out).not.toHaveProperty('location');
    expect(out).not.toHaveProperty('credits');
  });

  it('the member THEMSELVES sees their own hidden fields', async () => {
    store.rows = [{ source: base(), privacy: PRIVATE }];
    const out = await ctl.profile('grim', { userId: 'u-1' });
    expect(out).toHaveProperty('location');
    expect(out).toHaveProperty('credits');
  });

  it('a member with no privacy row is fully private', async () => {
    store.rows = [{ source: base(), privacy: null }];
    const out = await ctl.profile('grim', undefined);
    expect(out).not.toHaveProperty('location');
  });

  it('404s for an unknown handle', async () => {
    await expect(ctl.profile('nobody', undefined)).rejects.toThrow(/no such member/i);
  });
});

describe('GET /v1/members', () => {
  it('MANDATORY: lists EVERY member, whatever their privacy settings', () => {
    /*
     * ★ PRESENCE STOPPED BEING OPTIONAL ON 2026-07-28 ★
     *
     * The roster is behind the sign-in now, and it is the squadron's own
     * directory — the answer to "who is in this squadron and who do I fly
     * with". Opt-in defaulting to OFF meant it could never answer that, because
     * the default is what most people leave alone.
     */
    store.rows = [
      { source: base({ id: 'a', handle: 'private' }), privacy: PRIVATE },
      { source: base({ id: 'b', handle: 'sharing' }), privacy: ROSTER_ONLY },
      { source: base({ id: 'c', handle: 'norow' }), privacy: null },
    ];

    return ctl.roster().then((out) => {
      expect(out.members.map((m) => m.handle).sort()).toEqual(['norow', 'private', 'sharing']);
    });
  });

  it('MANDATORY: a member who shares NOTHING still appears, as a name', async () => {
    /*
     * The line this change draws. Being on a team roster means being named on
     * it; it does not mean handing over your position and your bank balance.
     */
    store.rows = [{ source: base({ handle: 'private' }), privacy: PRIVATE }];
    const out = await ctl.roster();

    expect(out.members).toHaveLength(1);
    expect(out.members[0]?.handle).toBe('private');
    expect(out.members[0]).not.toHaveProperty('location');
    expect(out.members[0]).not.toHaveProperty('credits');
    expect(out.members[0]).not.toHaveProperty('fleet');
  });

  it('MANDATORY: a member with NO privacy row is listed and still private', async () => {
    // Somebody who has never opened their settings. They belong on the roster
    // and they have consented to nothing, and both must hold at once.
    store.rows = [{ source: base({ handle: 'norow' }), privacy: null }];
    const out = await ctl.roster();

    expect(out.members).toHaveLength(1);
    expect(out.members[0]).not.toHaveProperty('location');
  });

  it('the total matches what is listed', async () => {
    // These used to differ, because most members were filtered out. Now that
    // everybody is listed, a mismatch would mean something was dropped.
    store.rows = [
      { source: base({ id: 'a', handle: 'one' }), privacy: PRIVATE },
      { source: base({ id: 'b', handle: 'two' }), privacy: ROSTER_ONLY },
    ];
    const out = await ctl.roster();

    expect(out.total).toBe(2);
    expect(out.members).toHaveLength(2);
  });

  it('a rostered member still hides fields they did not opt into', async () => {
    store.rows = [{ source: base({ handle: 'shown' }), privacy: ROSTER_ONLY }];
    const out = await ctl.roster();
    expect(out.members[0]).not.toHaveProperty('credits');
  });
});

describe('privacy settings', () => {
  it('returns conservative defaults when no row exists', async () => {
    store.stored = null;
    expect(await ctl.myPrivacy({ userId: 'u-1' })).toEqual(PRIVATE);
  });

  it('MANDATORY: writes against the SESSION user, never a body-supplied id', async () => {
    // The tampering attempt: name someone else in the body. The id must come
    // from the session, so the extra key is simply not read.
    await ctl.updatePrivacy({ userId: 'u-1' }, { userId: 'victim', showLocation: true }, req());
    expect(store.saved).toEqual([{ userId: 'u-1', patch: { showLocation: true } }]);
  });

  it('rejects an anonymous caller', async () => {
    await expect(ctl.updatePrivacy(undefined, { showLocation: true }, req())).rejects.toThrow(
      /sign in/i,
    );
  });

  it('rejects a request with no CSRF token', async () => {
    const bad = { method: 'PATCH', headers: {}, cookies: {} } as never;
    await expect(ctl.updatePrivacy({ userId: 'u-1' }, { showLocation: true }, bad)).rejects.toThrow(
      /csrf/i,
    );
  });

  it('MANDATORY: refuses a non-boolean rather than coercing it', async () => {
    // "false" is truthy. Coercing it would flip a member's OFF to ON, which is
    // the one direction that matters here.
    await expect(
      ctl.updatePrivacy({ userId: 'u-1' }, { showCredits: 'false' }, req()),
    ).rejects.toThrow(/true or false/i);
    expect(store.saved).toEqual([]);
  });

  it('ignores unknown keys instead of storing them', async () => {
    await ctl.updatePrivacy({ userId: 'u-1' }, { showFleet: true, isAdmin: true }, req());
    expect(store.saved[0]?.patch).toEqual({ showFleet: true });
  });

  it('rejects a body with nothing recognisable in it', async () => {
    await expect(ctl.updatePrivacy({ userId: 'u-1' }, { nonsense: true }, req())).rejects.toThrow(
      /no recognised/i,
    );
  });

  it('accepts a partial patch and leaves the other toggles alone', async () => {
    await ctl.updatePrivacy({ userId: 'u-1' }, { showLocation: true }, req());
    expect(store.saved[0]?.patch).toEqual({ showLocation: true });
  });
});
