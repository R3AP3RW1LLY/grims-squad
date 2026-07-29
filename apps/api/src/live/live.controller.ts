import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { LIVE_SERVICE } from './live.tokens.js';
import type { LiveEvent, LiveService } from './live.service.js';

/**
 * The live event stream.
 *
 * ★ SIGNED IN ONLY ★
 *
 * Not `@Public`. Events are scoped to a member, so an anonymous stream would
 * either carry nothing or carry other people's — and the second is how a
 * "harmless" notification channel becomes a disclosure.
 */
@Controller('v1/live')
export class LiveController {
  constructor(@Inject(LIVE_SERVICE) private readonly live: LiveService) {}

  @Get()
  stream(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to receive live updates.');
    }

    const raw = reply.raw;

    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      /*
       * ★ EVERY ONE OF THESE HEADERS IS LOad-BEARING ★
       *
       * no-cache: a proxy that caches an infinite response never ends the
       *   request, and the browser waits forever on a body it will not get.
       *
       * keep-alive: the connection IS the feature.
       *
       * X-Accel-Buffering: nginx and Caddy buffer proxied responses by default,
       *   which holds every event until the buffer fills — so a stream designed
       *   to be instant arrives in batches, minutes late, and only under a
       *   reverse proxy. It works perfectly in development and fails in
       *   production, which is the worst way for anything to fail.
       */
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    // An immediate comment, so the browser fires `onopen` rather than sitting on
    // a connection it cannot tell is alive.
    raw.write(': connected\n\n');

    const send = (event: LiveEvent): void => {
      raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = this.live.subscribe(caller.userId, send);

    /*
     * ★ THE HEARTBEAT IS NOT OPTIONAL ★
     *
     * Proxies and load balancers close idle connections, commonly at 60
     * seconds. Without traffic the stream dies silently, the browser reconnects,
     * and the cycle repeats forever — a reconnect storm that looks like the
     * feature working because events do eventually arrive.
     *
     * A comment line costs three bytes and is ignored by EventSource.
     */
    const heartbeat = setInterval(() => {
      try {
        raw.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    // BOTH events. `close` fires when the client goes away; `error` when the
    // socket breaks. Wiring only one leaks a subscriber every time the other
    // happens.
    req.raw.on('close', close);
    req.raw.on('error', close);
  }
}
