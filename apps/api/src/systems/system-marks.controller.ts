import { Body, Controller, Delete, Get, Inject, Post, Query } from '@nestjs/common';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { SystemMarksService } from './system-marks.service.js';

/**
 * A member's own systems: the ones they pinned, and the ones they used lately.
 *
 * ★ EVERY ROUTE IS SCOPED TO THE CALLER, WITH NO PARAMETER THAT COULD WIDEN IT ★
 *
 * There is no shape of any request here that returns somebody else's list. That is deliberate and
 * not merely tidy: a member's pinned systems are their home, their carrier and the system they are
 * quietly planning to claim, and the position endpoint next door already carries the note that a
 * commander's location is the most sensitive thing this platform holds. Convenience never widens
 * it — the user id comes from the session and nowhere else.
 */
@Controller('v1/me/systems')
export class SystemMarksController {
  constructor(@Inject(SystemMarksService) private readonly marks: SystemMarksService) {}

  #me(caller: CurrentUser | undefined): string {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to keep your systems.');
    }
    return caller.userId;
  }

  /** Pins and recents together — the caller ranks them with the shared `rankSystemChoices`. */
  @Get()
  async list(@User() caller: CurrentUser | undefined) {
    return { systems: await this.marks.list(this.#me(caller)) };
  }

  /**
   * Record a system a member actually searched with.
   *
   * Fire-and-forget from the client's point of view: it must never be able to fail a search that
   * otherwise worked, which is why nothing here is returned and the pages ignore the response.
   */
  @Post('use')
  async use(
    @User() caller: CurrentUser | undefined,
    @Body() body: { system?: string; systemId64?: string },
  ) {
    await this.marks.use(this.#me(caller), body.system ?? '', body.systemId64 ?? null);
    return { ok: true };
  }

  @Post('pin')
  async pin(
    @User() caller: CurrentUser | undefined,
    @Body() body: { system?: string; label?: string },
  ) {
    await this.marks.pin(this.#me(caller), body.system ?? '', body.label ?? null);
    return { ok: true };
  }

  /** Demotes to a recent rather than deleting — see the note on the service. */
  @Delete('pin')
  async unpin(@User() caller: CurrentUser | undefined, @Query('system') system?: string) {
    await this.marks.unpin(this.#me(caller), system ?? '');
    return { ok: true };
  }
}
