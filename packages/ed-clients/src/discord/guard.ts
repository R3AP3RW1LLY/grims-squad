import { DiscordApiError } from './types.js';

/**
 * A hard stop on destructive Discord operations, enforced in OUR code.
 *
 * WHY THIS EXISTS
 * The bot's effective permissions on the live guild include ADMINISTRATOR, via
 * a role the server owner deliberately assigns, and it sits ABOVE every
 * leadership role in the hierarchy. Discord will therefore happily let this
 * token delete every channel, ban every member, or hand out Galactic Admiral.
 * The server-side permission boundary is not available to us — the owner wants
 * that role where it is — so the boundary is built here instead.
 *
 * This is a LAST line of defence, not the only one. It cannot stop someone who
 * steals the token and uses it directly against Discord's API. What it does stop
 * is this application ever making such a call: a future feature, a copy-pasted
 * snippet, a compromised dependency reaching for the adapter, or a prompt
 * injection that talks the AI layer into "cleaning up" a channel. Those are the
 * realistic paths, and they all go through this function.
 *
 * One thing worth knowing: a bot CANNOT delete a Discord server. `DELETE
 * /guilds/{id}` requires guild OWNERSHIP, which a bot cannot hold. The literal
 * worst case is mass vandalism, not deletion — but mass vandalism is quite bad
 * enough to be worth refusing.
 */

export interface GuardedRequest {
  readonly method: string;
  /** Path relative to the API root, e.g. `/guilds/123/channels/456`. */
  readonly path: string;
}

interface Rule {
  readonly methods: readonly string[];
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * Everything this application is forbidden to do, whatever permissions the token
 * happens to carry. Written as an explicit blocklist of DESTRUCTIVE operations
 * rather than an allowlist of safe ones, because the read surface is large and
 * grows, while the set of things that can ruin a server is small and stable.
 */
const FORBIDDEN: readonly Rule[] = [
  {
    methods: ['DELETE'],
    pattern: /^\/guilds\/\d+$/,
    why: 'delete the guild',
  },
  {
    methods: ['DELETE', 'PATCH'],
    pattern: /^\/channels\/\d+$/,
    why: 'delete or modify a channel',
  },
  {
    methods: ['POST', 'PATCH'],
    pattern: /^\/guilds\/\d+\/channels$/,
    why: 'create or reorder channels',
  },
  {
    methods: ['PUT', 'DELETE'],
    pattern: /^\/guilds\/\d+\/bans\/\d+$/,
    why: 'ban or unban a member',
  },
  {
    methods: ['DELETE'],
    pattern: /^\/guilds\/\d+\/members\/\d+$/,
    why: 'kick a member',
  },
  {
    methods: ['POST'],
    pattern: /^\/guilds\/\d+\/prune$/,
    why: 'mass-prune members',
  },
  {
    methods: ['DELETE', 'PATCH', 'POST'],
    pattern: /^\/guilds\/\d+\/roles/,
    why: 'create, edit, reorder or delete roles',
  },
  {
    methods: ['PATCH'],
    pattern: /^\/guilds\/\d+$/,
    why: 'modify guild settings',
  },
  {
    methods: ['POST', 'PATCH', 'DELETE'],
    pattern: /^\/channels\/\d+\/webhooks|^\/webhooks\//,
    why: 'manage webhooks',
  },
  {
    // Covers a single message delete as well as bulk-delete. The bot has no
    // reason to remove anyone's message today; if moderation ever needs it,
    // that should be a deliberate change to this list rather than a gap in it.
    methods: ['DELETE'],
    pattern: /^\/channels\/\d+\/messages(\/|$)/,
    why: 'delete messages',
  },
  {
    methods: ['DELETE', 'PATCH'],
    pattern: /^\/guilds\/\d+\/(emojis|stickers)/,
    why: 'delete or modify emojis and stickers',
  },
  {
    methods: ['POST', 'PATCH', 'DELETE'],
    pattern: /^\/guilds\/\d+\/integrations/,
    why: 'manage integrations',
  },
  {
    methods: ['PATCH'],
    pattern: /^\/guilds\/\d+\/members\/@me/,
    why: 'modify its own guild profile',
  },
];

export class ForbiddenOperationError extends DiscordApiError {
  constructor(method: string, path: string, why: string) {
    super(
      `Refused: this application is not permitted to ${why}. ` +
        `Blocked ${method} ${path} at the adapter guard.`,
      403,
      false,
    );
    this.name = 'ForbiddenOperationError';
  }
}

/**
 * Throws if the request would perform a destructive operation.
 *
 * Path is normalised first: query strings dropped, duplicate slashes collapsed,
 * and a single percent-decode applied. Without that, `/guilds/1%2F..%2Fx` or a
 * trailing `?` slips past a pattern that only ever saw clean input — the same
 * class of bypass that the redirect allowlist guards against.
 */
export function assertNotDestructive(req: GuardedRequest): void {
  const method = req.method.toUpperCase();

  let path = req.path.split('?')[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    throw new ForbiddenOperationError(method, req.path, 'issue a malformed request path');
  }
  path = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!path.startsWith('/')) path = `/${path}`;

  // Path traversal cannot be allowed to walk out of a checked prefix.
  if (path.includes('..')) {
    throw new ForbiddenOperationError(method, req.path, 'issue a request containing path traversal');
  }

  for (const rule of FORBIDDEN) {
    if (rule.methods.includes(method) && rule.pattern.test(path)) {
      throw new ForbiddenOperationError(method, path, rule.why);
    }
  }
}

/**
 * Roles this application may ever grant, by id.
 *
 * Separate from the operation guard because the danger is different: adding a
 * role is not destructive, but adding the WRONG role is a privilege escalation.
 * Discord's own hierarchy check does not help here — the bot sits above every
 * leadership role — so the ceiling has to be ours.
 */
export function assertRoleGrantAllowed(roleId: string, allowed: readonly string[]): void {
  if (!allowed.includes(roleId)) {
    throw new ForbiddenOperationError(
      'PUT',
      `/roles/${roleId}`,
      `grant role ${roleId} — it is not on the grantable allowlist`,
    );
  }
}
