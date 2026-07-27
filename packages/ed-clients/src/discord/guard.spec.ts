import { describe, it, expect } from 'vitest';
import { assertNotDestructive, assertRoleGrantAllowed, ForbiddenOperationError } from './guard.js';

/**
 * The bot's live permissions include ADMINISTRATOR at a hierarchy position above
 * every leadership role. Discord will therefore allow anything. These tests pin
 * the boundary we enforce ourselves, because there is no server-side one left.
 */
const G = '801929816596152320';
const U = '1262447044337864850';

describe('destructive operations are refused', () => {
  const CASES: Array<[string, string, string]> = [
    ['DELETE', `/guilds/${G}`, 'delete the guild'],
    ['PATCH', `/guilds/${G}`, 'modify guild settings'],
    ['DELETE', '/channels/123456789012345678', 'delete a channel'],
    ['PATCH', '/channels/123456789012345678', 'modify a channel'],
    ['POST', `/guilds/${G}/channels`, 'create channels'],
    ['PUT', `/guilds/${G}/bans/${U}`, 'ban a member'],
    ['DELETE', `/guilds/${G}/bans/${U}`, 'unban a member'],
    ['DELETE', `/guilds/${G}/members/${U}`, 'kick a member'],
    ['POST', `/guilds/${G}/prune`, 'mass-prune'],
    ['DELETE', `/guilds/${G}/roles/123456789012345678`, 'delete a role'],
    ['PATCH', `/guilds/${G}/roles/123456789012345678`, 'edit a role'],
    ['POST', `/guilds/${G}/roles`, 'create a role'],
    ['POST', '/channels/123456789012345678/webhooks', 'create a webhook'],
    ['DELETE', '/channels/123456789012345678/messages/987654321098765432', 'delete messages'],
    ['DELETE', `/guilds/${G}/emojis/123456789012345678`, 'delete an emoji'],
    ['POST', `/guilds/${G}/integrations`, 'manage integrations'],
  ];

  for (const [method, path, what] of CASES) {
    it(`refuses ${method} ${path} (${what})`, () => {
      expect(() => assertNotDestructive({ method, path })).toThrow(ForbiddenOperationError);
    });
  }

  it('refuses regardless of method casing', () => {
    expect(() => assertNotDestructive({ method: 'delete', path: `/guilds/${G}` })).toThrow();
  });

  it('refuses despite a trailing slash or query string', () => {
    // A pattern that only ever saw clean input is bypassed by punctuation.
    expect(() => assertNotDestructive({ method: 'DELETE', path: `/guilds/${G}/` })).toThrow();
    expect(() => assertNotDestructive({ method: 'DELETE', path: `/guilds/${G}?x=1` })).toThrow();
  });

  it('refuses despite duplicated slashes', () => {
    expect(() => assertNotDestructive({ method: 'DELETE', path: `//guilds//${G}` })).toThrow();
  });

  it('refuses percent-encoded attempts to disguise the path', () => {
    expect(() =>
      assertNotDestructive({ method: 'DELETE', path: `/guilds%2F${G}` }),
    ).toThrow();
  });

  it('refuses anything containing path traversal', () => {
    expect(() =>
      assertNotDestructive({ method: 'GET', path: `/guilds/${G}/members/../../guilds/${G}` }),
    ).toThrow(/traversal/i);
  });

  it('names WHAT was refused, so the log is actionable', () => {
    try {
      assertNotDestructive({ method: 'PUT', path: `/guilds/${G}/bans/${U}` });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/ban or unban/);
      expect((e as Error).message).toMatch(/adapter guard/);
    }
  });
});

describe('legitimate operations still pass', () => {
  const ALLOWED: Array<[string, string]> = [
    ['GET', '/users/@me'],
    ['GET', `/guilds/${G}/roles`],
    ['GET', `/guilds/${G}/members/${U}`],
    ['GET', `/users/@me/guilds/${G}/member`],
    ['POST', '/oauth2/token'],
    ['PUT', `/guilds/${G}/members/${U}`],
    ['PUT', `/guilds/${G}/members/${U}/roles/804027821986807860`],
    ['GET', `/guilds/${G}/members?limit=100`],
  ];

  for (const [method, path] of ALLOWED) {
    it(`allows ${method} ${path}`, () => {
      expect(() => assertNotDestructive({ method, path })).not.toThrow();
    });
  }

  it('allows ADDING a role but not DELETING one', () => {
    // The distinction the whole join flow depends on.
    expect(() =>
      assertNotDestructive({ method: 'PUT', path: `/guilds/${G}/members/${U}/roles/1` }),
    ).not.toThrow();
    expect(() =>
      assertNotDestructive({ method: 'DELETE', path: `/guilds/${G}/roles/1` }),
    ).toThrow();
  });
});

describe('role grant ceiling', () => {
  const ALLOWLIST = ['804027821986807860', '892493916530671657'];

  it('permits a role on the allowlist', () => {
    expect(() => assertRoleGrantAllowed('804027821986807860', ALLOWLIST)).not.toThrow();
  });

  it('REFUSES Galactic Admiral even though Discord would permit it', () => {
    // The bot sits above that role in the hierarchy, so Discord raises no
    // objection whatsoever. This is the only thing standing in the way.
    expect(() => assertRoleGrantAllowed('804027885081591818', ALLOWLIST)).toThrow(
      ForbiddenOperationError,
    );
  });

  it('refuses every leadership and reserved role', () => {
    for (const id of [
      '804027885081591818', // Galactic Admiral
      '1512912541771235601', // Prime Legate
      '1512912750416760892', // Chief Fleet Commander
      '1513748632963387523', // First Commander
      '1513749464458723469', // Sector Overseer
      '1513669809756311593', // Squadron Leader
    ]) {
      expect(() => assertRoleGrantAllowed(id, ALLOWLIST)).toThrow();
    }
  });

  it('refuses when the allowlist is empty rather than defaulting to permissive', () => {
    expect(() => assertRoleGrantAllowed('804027821986807860', [])).toThrow();
  });
});
