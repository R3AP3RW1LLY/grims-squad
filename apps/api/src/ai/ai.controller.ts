import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PermissionService } from '../authz/permission.service.js';
import { satisfiesMask } from '../forum/category.service.js';
import { AiStreamService, type AiLogLine } from './ai-stream.service.js';
import { AiClient, aiHealth } from './ai.client.js';

/**
 * The AI's live view, for the admin area.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "we also want realtime streaming logs for ai in the admin area for the AI, just dont show PC file
 * paths into this streaming logs servic please."
 *
 * Paths are stripped inside `AiStreamService.emit`, which every line passes through — a single
 * funnel, so the guarantee is structural rather than something each call site remembers.
 *
 * ★ GATED ON AI_REVIEW ★
 *
 * The same permission that opens the review queue: officers, and the webmaster automatically. Not
 * AI_TOOLS_ADMIN, which would also mean kill switches and quota overrides.
 */
@Controller('v1/ai')
export class AiController {
  constructor(
    @Inject(AiStreamService) private readonly stream: AiStreamService,
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  /**
   * Is the model answering, right now.
   *
   * ★ THE SAME ANSWER ON LOCALHOST AND ON THE SERVER ★
   *
   * `AI_BASE_URL` is `http://127.0.0.1:11434/v1` in both places. On a development machine that is
   * Ollama running locally; on the Vultr box it is the near end of the SSH reverse tunnel, which
   * forwards that port to the same Ollama. One value, one code path, no environment branching —
   * which is what makes "it worked locally" mean anything.
   */
  @Get('health')
  async health(
    @User() caller: CurrentUser | undefined,
  ): Promise<{ configured: boolean; reachable: boolean; model: string | null; tookMs: number }> {
    await this.#assertMayReview(caller);
    const health = await aiHealth(this.ai);
    return { configured: this.ai.configured, ...health };
  }

  /**
   * The live log.
   *
   * SSE rather than websockets, matching the existing live stream: it is a GET that never ends, so
   * it carries the session cookie like any other request and needs no second auth path.
   */
  @Get('stream')
  async logStream(
    @User() caller: CurrentUser | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.#assertMayReview(caller);

    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      /*
       * Every one of these is load-bearing, for the reasons spelled out on the members' live
       * stream: an intermediary that caches an endless response never ends the request, and
       * `x-accel-buffering: no` is what stops Caddy holding events until a buffer fills — which
       * works perfectly in development and fails only in production.
       */
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    raw.write(': connected\n\n');

    const send = (line: AiLogLine): void => {
      raw.write(`event: ai\ndata: ${JSON.stringify(line)}\n\n`);
    };

    // The recent backlog first, so a freshly-opened panel is not an empty box that looks broken.
    for (const line of this.stream.recent()) send(line);

    const unsubscribe = this.stream.subscribe(send);

    /*
     * The heartbeat is not optional: proxies close idle connections at around 60 seconds, and a
     * stream that dies silently reconnects forever while appearing to work.
     */
    const heartbeat = setInterval(() => {
      try {
        raw.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  async #assertMayReview(caller: CurrentUser | undefined): Promise<void> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const mask = await this.permissions.effectiveMask(caller.userId);
    if (!satisfiesMask(mask, Permission.AI_REVIEW)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot read the AI log.');
    }
  }
}
