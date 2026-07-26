import { describe, it, expect, beforeEach } from 'vitest';
import { DiscordFake } from '@grims/ed-clients';
import { createKeyring, TokenCipher } from '@grims/shared/server';
import { ErrorCode, AppError } from '@grims/shared';
import { DiscordAuthService } from './discord.service.js';
import { InMemoryIdentityStore } from './identity.store.fake.js';

/**
 * P1.1 — Discord OAuth round-trip.
 *
 * Every test here runs against `DiscordFake` and an in-memory store: no network,
 * no database. That is the point of the port/adapter split (ADR-013) — the login
 * flow's LOGIC is testable without credentials we do not yet hold.
 *
 * What this cannot prove is the CONTRACT: that Discord's real payloads match the
 * fake's. That is why the real adapter is tagged `@unverified` in STATUS.md and
 * why P1 exit requires one live round-trip. A fake proves the abstraction, never
 * the integration.
 */

const GUILD = '801929816596152320';
const KEY = `k1:${Buffer.alloc(32, 3).toString('base64')}`;

let discord: DiscordFake;
let store: InMemoryIdentityStore;
let svc: DiscordAuthService;

beforeEach(() => {
  discord = new DiscordFake({ guildId: GUILD });
  store = new InMemoryIdentityStore();
  svc = new DiscordAuthService(discord, store, new TokenCipher(createKeyring(KEY)), {
    guildId: GUILD,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://grims-squad.com/v1/auth/discord/callback',
    stateSecret: 'state-secret-at-least-32-bytes-long!!',
  });
});

// ------------------------------------------------------------ authorize step
describe('DiscordAuthService.beginLogin', () => {
  it('requests exactly identify and guilds.members.read — never email', () => {
    const { url } = svc.beginLogin('/forum');
    const scope = new URL(url).searchParams.get('scope') ?? '';
    expect(scope.split(' ').sort()).toEqual(['guilds.members.read', 'identify']);
    expect(scope).not.toContain('email');
  });

  it('points at Discord with our client id and redirect uri', () => {
    const u = new URL(svc.beginLogin('/forum').url);
    expect(u.origin).toBe('https://discord.com');
    expect(u.searchParams.get('client_id')).toBe('client-id');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('prompt')).toBe('none');
  });

  it('never puts the client secret in the authorize URL', () => {
    expect(svc.beginLogin('/forum').url).not.toContain('client-secret');
  });

  it('sanitises the redirect before it is ever embedded in state', () => {
    // The open-redirect guard runs at MINT time, not just at consume time, so a
    // hostile value never survives long enough to be reflected anywhere.
    const { state } = svc.beginLogin('//evil.tld');
    expect(svc.peekRedirect(state)).toBe('/');
  });

  it('issues a distinct state and nonce per attempt', () => {
    const a = svc.beginLogin('/forum');
    const b = svc.beginLogin('/forum');
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

// -------------------------------------------------------------- state safety
describe('DiscordAuthService state validation', () => {
  it('rejects a state whose signature does not verify', async () => {
    const { state, nonce } = svc.beginLogin('/forum');
    const forged = `${state.split('.')[0]}.${Buffer.from('forged').toString('base64url')}`;
    await expect(svc.completeLogin({ code: 'ok', state: forged, nonce })).rejects.toThrow(AppError);
  });

  it('rejects a state whose payload was edited to change the redirect', async () => {
    const { state, nonce } = svc.beginLogin('/forum');
    const [body, sig] = state.split('.');
    const edited = JSON.parse(Buffer.from(body as string, 'base64url').toString());
    edited.r = 'https://evil.tld';
    const tampered = `${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}`;
    await expect(svc.completeLogin({ code: 'ok', state: tampered, nonce })).rejects.toThrow(
      AppError,
    );
  });

  it('rejects an expired state', async () => {
    const { state, nonce } = svc.beginLogin('/forum', Date.now() - 20 * 60_000);
    await expect(svc.completeLogin({ code: 'ok', state, nonce })).rejects.toThrow(/expired/i);
  });

  it('MANDATORY: rejects a state not bound to the caller nonce cookie (login CSRF)', async () => {
    // Without this binding an attacker mints their own authorize URL, feeds the
    // victim the resulting callback link, and the victim silently ends up logged
    // in AS THE ATTACKER — then files their journal and cAPI data into the
    // attacker's account. Binding state to a cookie the attacker cannot set on
    // our origin makes the swap fail.
    const { state } = svc.beginLogin('/forum');
    const other = svc.beginLogin('/forum');
    await expect(svc.completeLogin({ code: 'ok', state, nonce: other.nonce })).rejects.toThrow(
      AppError,
    );
    await expect(svc.completeLogin({ code: 'ok', state, nonce: '' })).rejects.toThrow(AppError);
  });

  it('refuses to reuse a state that already completed a login', async () => {
    discord.addMember('7', {});
    const { state, nonce } = svc.beginLogin('/forum');
    await svc.completeLogin({ code: 'code-for-7', state, nonce });
    await expect(svc.completeLogin({ code: 'code-for-7', state, nonce })).rejects.toThrow(
      /replay|used/i,
    );
  });

  it('consumes the state even when the login is REFUSED', async () => {
    // The state is burned before the exchange, not after a successful one. A
    // captured callback URL is therefore single-use whatever its outcome —
    // otherwise an attacker who intercepts one could keep retrying it until a
    // transient Discord failure or a role change made it succeed.
    discord.addOutsider('999');
    const { state, nonce } = svc.beginLogin('/');
    await expect(svc.completeLogin({ code: 'code-for-999', state, nonce })).rejects.toMatchObject({
      code: ErrorCode.DISCORD_GUILD_MEMBERSHIP_REQUIRED,
    });
    await expect(svc.completeLogin({ code: 'code-for-999', state, nonce })).rejects.toThrow(
      /replay|used/i,
    );
  });
});

// ------------------------------------------------------------- the happy path
describe('DiscordAuthService.completeLogin', () => {
  it('creates a users row and a discord_identities row', async () => {
    discord.addMember('4242', {
      username: 'grim',
      globalName: 'Grim',
      roles: ['r-officer'],
      joinedAt: '2023-01-05T00:00:00.000Z',
    });
    const { state, nonce } = svc.beginLogin('/forum');
    const r = await svc.completeLogin({ code: 'code-for-4242', state, nonce });

    expect(store.users).toHaveLength(1);
    expect(store.identities).toHaveLength(1);
    expect(r.userId).toBe(store.users[0]?.id);
    expect(store.identities[0]?.discordUserId).toBe('4242');
    expect(store.users[0]?.displayName).toBe('Grim');
  });

  it('populates guild_roles from the guild member endpoint (INV-008)', async () => {
    discord.addMember('7', { roles: ['r-a', 'r-b', 'r-c'] });
    const { state, nonce } = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', state, nonce });
    expect(store.identities[0]?.guildRoles).toEqual(['r-a', 'r-b', 'r-c']);
  });

  it('stores guildJoinedAt, the sole input to tenure rank (INV-047)', async () => {
    discord.addMember('7', { joinedAt: '2022-06-01T12:00:00.000Z' });
    const { state, nonce } = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', state, nonce });
    expect(store.identities[0]?.guildJoinedAt?.toISOString()).toBe('2022-06-01T12:00:00.000Z');
    // Tenure is COMPUTED, never a column on users.
    expect(store.users[0]).not.toHaveProperty('tenureRank');
  });

  it('returns the sanitised redirect for the caller to honour', async () => {
    discord.addMember('7', {});
    const a = svc.beginLogin('/fleet/carriers');
    expect((await svc.completeLogin({ code: 'code-for-7', ...a })).redirectTo).toBe(
      '/fleet/carriers',
    );
  });

  it('is idempotent on a second login — no duplicate user is created', async () => {
    discord.addMember('7', { username: 'first' });
    for (const name of ['first', 'renamed']) {
      discord.addMember('7', { username: name, globalName: null });
      const a = svc.beginLogin('/');
      await svc.completeLogin({ code: 'code-for-7', ...a });
    }
    expect(store.users).toHaveLength(1);
    expect(store.identities).toHaveLength(1);
    // A Discord rename propagates rather than forking the account.
    expect(store.identities[0]?.username).toBe('renamed');
  });

  it('refreshes guild roles on every login, so a removed role does not persist', async () => {
    discord.addMember('7', { roles: ['r-officer', 'r-member'] });
    let a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', ...a });

    discord.addMember('7', { roles: ['r-member'] }); // demoted in Discord
    a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', ...a });
    expect(store.identities[0]?.guildRoles).toEqual(['r-member']);
  });
});

// ------------------------------------------------------------ membership gate
describe('guild membership gate', () => {
  it('refuses a user who is not in our guild', async () => {
    discord.addOutsider('999');
    const { state, nonce } = svc.beginLogin('/');
    await expect(svc.completeLogin({ code: 'code-for-999', state, nonce })).rejects.toMatchObject({
      code: ErrorCode.DISCORD_GUILD_MEMBERSHIP_REQUIRED,
    });
  });

  it('creates NOTHING when membership is refused', async () => {
    discord.addOutsider('999');
    const { state, nonce } = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-999', state, nonce }).catch(() => {});
    expect(store.users).toHaveLength(0);
    expect(store.identities).toHaveLength(0);
  });

  it('FAILS CLOSED when Discord errors, rather than treating it as not-a-member', async () => {
    // The dangerous confusion runs the other way too: if a 500 were read as
    // "no roles", a Discord outage would silently strip every officer's
    // permissions instead of refusing the login.
    discord.addMember('7', { roles: ['r-officer'] });
    discord.failGuildLookup(new Error('discord 500'));
    const { state, nonce } = svc.beginLogin('/');
    await expect(svc.completeLogin({ code: 'code-for-7', state, nonce })).rejects.not.toMatchObject(
      { code: ErrorCode.DISCORD_GUILD_MEMBERSHIP_REQUIRED },
    );
    expect(store.identities).toHaveLength(0);
  });
});

// ------------------------------------------------------------ token handling
describe('token storage @INV-012', () => {
  it('persists OAuth tokens AES-256-GCM encrypted — no plaintext in any column', async () => {
    discord.addMember('7', {});
    const { state, nonce } = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', state, nonce });

    const row = store.identities[0];
    const plaintextAccess = discord.lastIssued?.accessToken ?? '';
    const plaintextRefresh = discord.lastIssued?.refreshToken ?? '';
    expect(plaintextRefresh).not.toBe('');

    const dump = JSON.stringify(row);
    expect(dump).not.toContain(plaintextAccess);
    expect(dump).not.toContain(plaintextRefresh);
    expect(row?.accessTokenEnc?.startsWith('v1.k1.')).toBe(true);
    expect(row?.refreshTokenEnc?.startsWith('v1.k1.')).toBe(true);
  });

  it('binds each stored token to its own subject, so a row copy cannot be replayed', async () => {
    discord.addMember('1', {});
    discord.addMember('2', {});
    const a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-1', ...a });
    const b = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-2', ...b });

    const victim = store.identities[0]!;
    const attacker = store.identities[1]!;
    // Attacker pastes the victim's ciphertext into their own row.
    attacker.refreshTokenEnc = victim.refreshTokenEnc;
    await expect(svc.getRefreshToken(attacker.userId)).rejects.toThrow();
  });

  it('never returns a token, encrypted or otherwise, from the login result', async () => {
    discord.addMember('7', {});
    const { state, nonce } = svc.beginLogin('/');
    const r = await svc.completeLogin({ code: 'code-for-7', state, nonce });
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(discord.lastIssued?.refreshToken ?? 'x');
    expect(dump).not.toMatch(/v1\.k1\./);
    expect(Object.keys(r).sort()).toEqual(['discordUserId', 'isNewUser', 'redirectTo', 'userId']);
  });

  it('records the token expiry so a worker can refresh before it lapses', async () => {
    discord.addMember('7', {});
    const { state, nonce } = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', state, nonce });
    expect(store.identities[0]?.tokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------- no network
describe('offline guarantee', () => {
  it('completes an entire login without a single network call', async () => {
    discord.addMember('7', {});
    const { state, nonce } = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', state, nonce });
    expect(discord.networkCalls).toBe(0);
  });
});

// ---------------------------------------------------------- display identity
describe('display name', () => {
  it('prefers the SERVER NICKNAME over the global name', async () => {
    // Members are asked to set their server nickname to their CMDR name, so it
    // is the most accurate identity available to us.
    discord.addMember('7', { username: 'r3ap3r_22545', globalName: 'Shawn Wilson' });
    discord.setNick('7', 'PEBBLEMERCHANT');
    const a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', ...a });
    expect(store.users[0]?.displayName).toBe('PEBBLEMERCHANT');
    expect(store.identities[0]?.guildNick).toBe('PEBBLEMERCHANT');
  });

  it('does NOT publish the global name when a nickname exists', async () => {
    // A Discord global name is frequently the member REAL NAME. Putting it on a
    // roster because it happened to be the first field we reached for is a
    // privacy regression nobody asked for.
    discord.addMember('7', { username: 'cmdr_x', globalName: 'Jane Q Realname' });
    discord.setNick('7', 'HELLFIRE');
    const a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', ...a });
    expect(JSON.stringify(store.users)).not.toContain('Realname');
  });

  it('falls back to global name, then username, when no nickname is set', async () => {
    discord.addMember('8', { username: 'plain_user', globalName: 'Global Name' });
    let a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-8', ...a });
    expect(store.users[0]?.displayName).toBe('Global Name');

    discord.addMember('9', { username: 'only_username', globalName: null });
    a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-9', ...a });
    expect(store.users[1]?.displayName).toBe('only_username');
  });

  it('updates the display name when the member changes their nickname', async () => {
    discord.addMember('7', { username: 'u' });
    discord.setNick('7', 'OLD NAME');
    let a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', ...a });

    discord.setNick('7', 'NEW NAME');
    a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', ...a });
    // Discord is the source of truth; a rename there must propagate here.
    expect(store.users[0]?.displayName).toBe('NEW NAME');
    expect(store.users).toHaveLength(1);
  });

  it('reverts to the global name if the nickname is cleared', async () => {
    discord.addMember('7', { username: 'u', globalName: 'Global' });
    discord.setNick('7', 'NICK');
    let a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', ...a });
    discord.setNick('7', null);
    a = svc.beginLogin('/');
    await svc.completeLogin({ code: 'code-for-7', ...a });
    expect(store.users[0]?.displayName).toBe('Global');
    expect(store.identities[0]?.guildNick).toBeNull();
  });
});
