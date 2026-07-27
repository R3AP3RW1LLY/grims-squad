import { describe, it, expect, beforeEach } from 'vitest';
import { DiscordFake } from '@grims/ed-clients';
import { AppError, ErrorCode } from '@grims/shared';
import {
  OnboardingService,
  ONBOARDING_INTENTS,
  resolveIntent,
  type OnboardingIntent,
} from './onboarding.service.js';

/**
 * Join-the-server onboarding.
 *
 * A visitor who is NOT yet in the Discord guild picks an intent on the website
 * and is added to the guild with the matching role already applied, in one
 * atomic call (`PUT /guilds/{id}/members/{user}` with `roles`). That avoids the
 * alternative — invite them, then race a gateway event to apply the role — which
 * loses the intent entirely if the process restarts at the wrong moment.
 *
 * ★ THE SECURITY PROPERTY THIS FILE EXISTS FOR ★
 * The role granted is resolved from a server-side ALLOWLIST, and the intent
 * travels inside the HMAC-signed OAuth state. If the role id were taken from the
 * request — even indirectly — editing one parameter would self-assign Galactic
 * Admiral. Most of the tests below are that single attack, approached from
 * different directions.
 */

const GUILD = '801929816596152320';
const MEMBERS_ROLE = '804027821986807860';
const ALLIES_ROLE = '892493916530671657';
const ADMIRAL_ROLE = '804027885081591818'; // must NEVER be reachable

let discord: DiscordFake;
let svc: OnboardingService;

beforeEach(() => {
  discord = new DiscordFake({ guildId: GUILD });
  svc = new OnboardingService(discord, {
    // Role ids are CONFIGURATION, not source (INV-008) — so the test supplies
    // them exactly as the module does from the environment.
    roleIds: [
      { intent: 'squadron', roleId: MEMBERS_ROLE },
      { intent: 'ally', roleId: ALLIES_ROLE },
    ],
    guildId: GUILD,
    clientId: 'cid',
    clientSecret: 'csecret',
    redirectUri: 'https://example.test/v1/auth/discord/join/callback',
    stateSecret: 'state-secret-at-least-32-bytes-long!!',
  });
});

// ---------------------------------------------------------------- allowlist
describe('intent allowlist', () => {
  it('offers exactly two intents', () => {
    expect(ONBOARDING_INTENTS.map((i) => i.intent).sort()).toEqual(['ally', 'squadron']);
  });

  it('carries NO role id in source — they come from configuration', () => {
    // INV-008: a snowflake in source means renaming or recreating a role needs
    // a code change and a deploy.
    for (const o of ONBOARDING_INTENTS) {
      expect(o).not.toHaveProperty('roleId');
    }
    expect(JSON.stringify(ONBOARDING_INTENTS)).not.toMatch(/\d{17,20}/);
  });

  it('NEVER resolves anything outside the allowlist', () => {
    for (const bad of [
      'admiral',
      'officer',
      'webmaster',
      ADMIRAL_ROLE,
      '',
      '__proto__',
      'constructor',
      'SQUADRON',
      ' squadron ',
    ]) {
      expect(resolveIntent(bad as OnboardingIntent)).toBeUndefined();
    }
  });

  it('cannot be reached through prototype pollution', () => {
    // A lookup implemented as `MAP[intent]` on a plain object answers to
    // `constructor` and `__proto__` with something truthy, and a truthy answer
    // is all an escalation needs.
    expect(resolveIntent('toString' as OnboardingIntent)).toBeUndefined();
    expect(resolveIntent('hasOwnProperty' as OnboardingIntent)).toBeUndefined();
  });

  it('refuses an intent that configuration has no role for', async () => {
    // A half-configured deployment must refuse, not silently add someone to the
    // guild with no role at all.
    const half = new OnboardingService(discord, {
      roleIds: [{ intent: 'squadron', roleId: MEMBERS_ROLE }],
      guildId: GUILD,
      clientId: 'cid',
      clientSecret: 'csecret',
      redirectUri: 'https://example.test/cb',
      stateSecret: 'state-secret-at-least-32-bytes-long!!',
    });
    expect(() => half.beginJoin('ally')).toThrow(AppError);
  });
});

// ------------------------------------------------------------------- begin
describe('beginJoin', () => {
  it('requests guilds.join in addition to identify', () => {
    const scope = new URL(svc.beginJoin('squadron').url).searchParams.get('scope') ?? '';
    expect(scope.split(' ').sort()).toEqual(['guilds.join', 'identify']);
  });

  it('does NOT request guilds.members.read — this flow reads nothing', () => {
    // Least privilege: joining needs the ability to add the user to a guild,
    // not the ability to read their membership of it.
    expect(svc.beginJoin('ally').url).not.toContain('members.read');
  });

  it('refuses an intent that is not on the allowlist', () => {
    expect(() => svc.beginJoin('admiral' as OnboardingIntent)).toThrow(AppError);
  });

  it('puts the intent in the SIGNED state, not in a query parameter', () => {
    const { url, state } = svc.beginJoin('squadron');
    const params = new URL(url).searchParams;
    // Nothing outside `state` carries the choice, so nothing outside `state`
    // can be edited to change it.
    expect(params.get('intent')).toBeNull();
    expect(params.get('role')).toBeNull();
    expect(params.get('roleId')).toBeNull();
    expect(state).toContain('.');
  });

  it('never puts a role id in the authorize URL at all', () => {
    for (const i of ['squadron', 'ally'] as const) {
      const url = svc.beginJoin(i).url;
      expect(url).not.toContain(MEMBERS_ROLE);
      expect(url).not.toContain(ALLIES_ROLE);
    }
  });
});

// ---------------------------------------------------------------- complete
describe('completeJoin', () => {
  it('adds the user to the guild with the squadron role applied', async () => {
    discord.addOutsider('55');
    const { state, nonce } = svc.beginJoin('squadron');
    const r = await svc.completeJoin({ code: 'code-for-55', state, nonce });

    expect(r.joined).toBe(true);
    expect(r.roleId).toBe(MEMBERS_ROLE);
    expect(discord.addedMembers).toContainEqual({
      guildId: GUILD,
      userId: '55',
      roles: [MEMBERS_ROLE],
    });
  });

  it('applies the Allies role for the ally intent', async () => {
    discord.addOutsider('56');
    const { state, nonce } = svc.beginJoin('ally');
    await svc.completeJoin({ code: 'code-for-56', state, nonce });
    expect(discord.addedMembers[0]?.roles).toEqual([ALLIES_ROLE]);
  });

  it('MANDATORY: a tampered state cannot change which role is granted', async () => {
    // The whole attack in one test. Re-sign is impossible without the secret, so
    // the edited payload must be rejected outright rather than merely ignored.
    const { state, nonce } = svc.beginJoin('ally');
    const [body, sig] = state.split('.');
    const payload = JSON.parse(Buffer.from(body as string, 'base64url').toString());
    payload.i = 'squadron';
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;

    discord.addOutsider('57');
    await expect(svc.completeJoin({ code: 'code-for-57', state: forged, nonce })).rejects.toThrow(
      AppError,
    );
    expect(discord.addedMembers).toHaveLength(0);
  });

  it('MANDATORY: an intent naming a leadership role id is refused', async () => {
    const { nonce } = svc.beginJoin('ally');
    // Even a correctly SIGNED state is re-validated against the allowlist on the
    // way out, so a signing bug alone is not enough to escalate.
    const forged = svc.signStateForTest({ i: ADMIRAL_ROLE, n: nonce });
    discord.addOutsider('58');
    await expect(svc.completeJoin({ code: 'code-for-58', state: forged, nonce })).rejects.toThrow();
    expect(discord.addedMembers).toHaveLength(0);
  });

  it('is safe when the user is ALREADY in the guild', async () => {
    // Discord answers 204 with no body. Treating that as failure would show an
    // error to someone whose join actually worked.
    discord.addMember('59', { roles: [] });
    const { state, nonce } = svc.beginJoin('squadron');
    const r = await svc.completeJoin({ code: 'code-for-59', state, nonce });
    expect(r.alreadyMember).toBe(true);
    expect(r.roleId).toBe(MEMBERS_ROLE);
  });

  it('does not strip roles an existing member already holds', async () => {
    // `PUT /members` with a roles array REPLACES the member's roles. Applying it
    // to an existing member would silently demote them to just the one role.
    discord.addMember('60', { roles: ['1513158621549297785', '1528252058380144740'] });
    const { state, nonce } = svc.beginJoin('squadron');
    await svc.completeJoin({ code: 'code-for-60', state, nonce });
    const roles = discord.rolesOf('60');
    expect(roles).toContain('1513158621549297785');
    expect(roles).toContain('1528252058380144740');
    expect(roles).toContain(MEMBERS_ROLE);
  });

  it('rejects a replayed state', async () => {
    discord.addOutsider('61');
    const { state, nonce } = svc.beginJoin('ally');
    await svc.completeJoin({ code: 'code-for-61', state, nonce });
    await expect(svc.completeJoin({ code: 'code-for-61', state, nonce })).rejects.toThrow(
      /replay|used/i,
    );
  });

  it('rejects a state not bound to the caller nonce', async () => {
    discord.addOutsider('62');
    const a = svc.beginJoin('squadron');
    const b = svc.beginJoin('ally');
    await expect(
      svc.completeJoin({ code: 'code-for-62', state: a.state, nonce: b.nonce }),
    ).rejects.toThrow(AppError);
  });

  it('surfaces a clear error when the bot cannot add members', async () => {
    // Missing CREATE_INSTANT_INVITE is the likely first failure in production,
    // and "something went wrong" would send someone hunting in the wrong place.
    discord.addOutsider('63');
    discord.failAddMember(new Error('Missing Permissions'));
    const { state, nonce } = svc.beginJoin('squadron');
    await expect(svc.completeJoin({ code: 'code-for-63', state, nonce })).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
    });
  });

  it('completes without a single network call in tests', async () => {
    discord.addOutsider('64');
    const { state, nonce } = svc.beginJoin('ally');
    await svc.completeJoin({ code: 'code-for-64', state, nonce });
    expect(discord.networkCalls).toBe(0);
  });
});
