import { Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { NotificationsService } from './notifications.service.js';

/**
 * The bell's own routes. Session-required throughout — a bell with nobody signed in has nothing
 * to ring about, and the squadron feed is members' business.
 */
@Controller('v1/notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  #me(caller: CurrentUser | undefined): string {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    return caller.userId;
  }

  /** The badge. One cheap read the SSE nudge tells the client to repeat. */
  @Get('count')
  async count(@User() caller: CurrentUser | undefined) {
    return this.notifications.counts(this.#me(caller));
  }

  @Get()
  async list(
    @User() caller: CurrentUser | undefined,
    @Query('tab') tab?: string,
    @Query('cursor') cursor?: string,
  ) {
    const userId = this.#me(caller);
    const c = cursor?.trim() === '' || cursor === undefined ? null : cursor.trim();

    if (tab === 'squadron') return this.notifications.squadron(c);
    return this.notifications.personal(userId, c);
  }

  @Post('read-all')
  async readAll(@User() caller: CurrentUser | undefined) {
    await this.notifications.readAll(this.#me(caller));
    return { ok: true };
  }

  /** Opening the squadron tab IS seeing it — the client calls this as the tab renders. */
  @Post('squadron-seen')
  async squadronSeen(@User() caller: CurrentUser | undefined) {
    await this.notifications.squadronSeen(this.#me(caller));
    return { ok: true };
  }

  @Post(':id/read')
  async read(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    await this.notifications.markRead(this.#me(caller), id);
    return { ok: true };
  }
}
