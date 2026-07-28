import { Controller, Get, Delete, Param, Req, Res, Inject } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ revoked: true; signedOut: boolean }> {
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

    /*
     * ★ ENDING YOUR OWN SESSION MUST SIGN YOU OUT, HERE, ON THE SERVER ★
     *
     * Revoking the family removes the REFRESH side. It does nothing to the
     * access token, which is a JWT carrying no authorization data and therefore
     * never consulted against the database — so a member who ended "this
     * device" stayed fully signed in for up to fifteen minutes on the very
     * device they had just revoked.
     *
     * That is the opposite of what the button says, and it is worst in the
     * exact situation the button exists for: somebody on a shared or borrowed
     * machine clicking "Sign out" and walking away.
     *
     * The cookies are cleared in the RESPONSE rather than by the page, because
     * a client-side sign-out is a request that can fail, be blocked, or simply
     * not be made by a caller that is not our UI. The server decides.
     */
    const signedOut = currentFamilyId(req) === familyId;
    if (signedOut) clearSessionCookies(reply);

    return { revoked: true, signedOut };
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

/**
 * Clears the session cookies on the way out.
 *
 * ★ EVERY NAME, BOTH PREFIXES ★
 *
 * The API chooses `__Host-` from NODE_ENV rather than from the request, so a
 * response that clears only the name this process would have SET leaves the
 * other one in the browser. Behind a proxy that is the difference between
 * signing somebody out and appearing to.
 *
 * The CSRF cookie goes too. It is not a credential on its own, but leaving a
 * token behind that pairs with cookies that are gone produces confusing 403s on
 * the next sign-in rather than a clean start.
 */
function clearSessionCookies(reply: FastifyReply): void {
  const jar = reply as unknown as {
    clearCookie?: (name: string, opts?: Record<string, unknown>) => unknown;
  };
  if (typeof jar.clearCookie !== 'function') return;

  for (const base of ['gs_at', 'gs_rt', 'gs_csrf']) {
    for (const name of [base, `__Host-${base}`]) {
      // Path must match the one they were set with, or the browser keeps them.
      jar.clearCookie(name, { path: '/' });
    }
  }
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
