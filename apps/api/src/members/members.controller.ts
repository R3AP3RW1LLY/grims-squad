import { Controller, Get, Patch, Param, Body, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { MEMBERS_STORE, type MembersStore } from './members.tokens.js';
import {
  serializeProfile,
  resolvePrivacy,
  visibleOnRoster,
  DEFAULT_PRIVACY,
  type PrivacySettings,
  type PublicProfile,
} from './profile.serializer.js';

const TOGGLES = Object.keys(DEFAULT_PRIVACY) as Array<keyof PrivacySettings>;

/**
 * Reads a privacy patch out of an untrusted body.
 *
 * Only the six known toggles are read, and only when the value is a real
 * boolean. A string "false" is rejected rather than coerced: it arrives from a
 * form that forgot to parse its own checkbox, and coercing it would silently
 * turn a member's OFF into an ON — the exact direction INV-027 cares about.
 */
function readPatch(body: unknown): Partial<PrivacySettings> {
  if (typeof body !== 'object' || body === null) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Expected an object of privacy toggles.');
  }
  const src = body as Record<string, unknown>;
  const patch: Record<string, boolean> = {};
  for (const key of TOGGLES) {
    const v = src[key];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${key} must be true or false.`);
    }
    patch[key] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'No recognised privacy toggle in the body.');
  }
  return patch as Partial<PrivacySettings>;
}

@Controller('v1')
export class MembersController {
  constructor(@Inject(MEMBERS_STORE) private readonly store: MembersStore) {}

  /**
   * The public roster.
   *
   * Filtered by `showOnPublicRoster` BEFORE anything is serialised, so a member
   * who has not opted in is not on the page at all — stronger than hiding their
   * individual fields, and the roster is our highest-traffic public surface.
   */
  @Public()
  @Get('members')
  async roster(): Promise<{ members: PublicProfile[]; total: number }> {
    const rows = await this.store.roster();
    const visible = visibleOnRoster(rows);
    return {
      members: visible.map((r) => serializeProfile(r.source, r.privacy, { audience: 'public' })),
      // The COUNT of active members is not private — it is the squadron's size,
      // which is public on Inara anyway. Who they are is the private part.
      total: rows.length,
    };
  }

  /**
   * One member's profile.
   *
   * `audience: 'self'` only when the caller IS this member. There is no officer
   * branch and there must not be one: INV-027 is a promise to the member, not a
   * permission level.
   */
  @Public()
  @Get('members/:handle')
  async profile(
    @Param('handle') handle: string,
    @User() caller: CurrentUser | undefined,
  ): Promise<PublicProfile> {
    const row = await this.store.byHandle(handle);
    if (row === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such member.');
    }
    const isSelf = caller !== undefined && caller.userId === row.source.id;
    return serializeProfile(row.source, row.privacy, {
      audience: isSelf ? 'self' : 'public',
    });
  }

  /** The caller's own toggles, for the settings page. */
  @Get('me/privacy')
  async myPrivacy(@User() caller: CurrentUser | undefined): Promise<PrivacySettings> {
    const userId = requireUser(caller);
    // Resolved rather than returned raw, so a member with no row sees the
    // conservative defaults instead of a null the UI has to interpret.
    return resolvePrivacy(await this.store.privacyOf(userId));
  }

  @Patch('me/privacy')
  async updatePrivacy(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<PrivacySettings> {
    const userId = requireUser(caller);
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);

    // A member may only ever change their OWN settings. The user id comes from
    // the session and is never read from the body or the path, so there is no
    // parameter here for anyone to tamper with.
    return this.store.savePrivacy(userId, readPatch(body));
  }
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to manage your privacy settings.');
  }
  return caller.userId;
}
