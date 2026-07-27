import { Controller, Get, Delete, Param, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { ACCOUNT_STORE } from './members.tokens.js';
import type { AccountStore, SessionSummary, ExportBundle } from './account.store.js';

/**
 * A member's own account: signed-in devices, and everything we hold about them.
 *
 * Every operation is scoped to the SESSION user. The id is never read from a
 * path or a body, so there is no parameter for anyone to change — the only
 * thing that varies per request is which family id is being acted on, and that
 * is ownership-checked.
 */
@Controller('v1/me')
export class AccountController {
  constructor(@Inject(ACCOUNT_STORE) private readonly store: AccountStore) {}

  @Get('sessions')
  async sessions(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
  ): Promise<{ sessions: SessionSummary[] }> {
    const userId = requireUser(caller);
    return { sessions: await this.store.sessionsOf(userId, currentFamilyId(req)) };
  }

  /**
   * Ends one session.
   *
   * A family the caller does not own answers exactly as an unknown family does.
   * Distinguishing the two would confirm that a given id exists, which is the
   * only thing an enumerator needs.
   */
  @Delete('sessions/:familyId')
  async revokeSession(
    @User() caller: CurrentUser | undefined,
    @Param('familyId') familyId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ revoked: true }> {
    const userId = requireUser(caller);
    csrf(req);

    const owner = await this.store.ownerOfFamily(familyId);
    if (owner !== userId) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Session not found.');
    }

    // Revoking an already-revoked family is not an error. The member's intent
    // is "this device should not be signed in", and it already is not — failing
    // here would make a double-click look like a problem.
    await this.store.revokeFamily(familyId, 'user_revoked');
    return { revoked: true };
  }

  /** Everything we hold, as JSON. */
  @Get('export')
  async exportMe(
    @User() caller: CurrentUser | undefined,
    _req: FastifyRequest,
  ): Promise<ExportBundle> {
    const userId = requireUser(caller);
    return this.store.exportFor(userId, new Date());
  }
}

/**
 * The family id behind the request's own session, so the list can mark it.
 *
 * Read from the request rather than derived from the access token: the access
 * token carries no family id by design (it carries no authorization data at
 * all), and adding one to it purely for a UI label would weaken it.
 */
function currentFamilyId(req: FastifyRequest): string | null {
  const v = (req as unknown as { sessionFamilyId?: string }).sessionFamilyId;
  return typeof v === 'string' && v !== '' ? v : null;
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to manage your account.');
  }
  return caller.userId;
}
