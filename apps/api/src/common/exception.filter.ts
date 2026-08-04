import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode, type ErrorEnvelope, type ErrorCodeName } from '@grims/shared';
import { logger } from '../logging.js';

/**
 * Where a development-time defect is written down as well as logged.
 *
 * ★ A SCROLLBACK BUFFER IS NOT A RECORD — 2026-08-04 ★
 *
 * An unhandled exception is a DEFECT, and the only trace of one was a line in whichever terminal
 * happened to be running the API. A member reporting "I get an unexpected error, requestId
 * d7889177" therefore could not be helped without asking them to go and find that terminal, scroll
 * to the right place, and copy it out — and by then the window has usually scrolled away.
 *
 * That happened, twice in one evening, and the second time cost a full sweep of every route, page
 * and write in the module to establish that nothing was reproducibly broken.
 *
 * Development only, and gitignored. In production the log IS the record: pino emits JSON to stdout
 * and it is shipped, so a second copy on a container's disk would be a file nobody reads and one
 * more place for something sensitive to sit. Redaction is pino's either way — this writes the same
 * already-redacted shape.
 */
const DEFECT_LOG =
  process.env['NODE_ENV'] === 'production'
    ? null
    : join(process.cwd(), '.notes', 'api-defects.log');

/**
 * The ONLY place an error response is constructed.
 *
 * Two rules it exists to enforce (ssot/04-contracts/errors.md):
 *   1. Never leak internals. A Prisma error, an upstream 500 or an unhandled
 *      exception becomes INTERNAL_ERROR plus a requestId; the detail goes to the
 *      log, not to the client.
 *   2. `requestId` is ALWAYS present, including on 500s. It is what turns
 *      "the site broke" into a diagnosable report.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = (request.id as string | undefined) ?? 'unknown';

    if (exception instanceof AppError) {
      // Expected, typed, already safe to display.
      logger.warn(
        { requestId, code: exception.code, details: exception.details },
        exception.message,
      );
      reply.status(exception.status).send(exception.toEnvelope(requestId));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCodeName =
        status === 404
          ? ErrorCode.RESOURCE_NOT_VISIBLE
          : status === 401
            ? ErrorCode.UNAUTHENTICATED
            : status === 403
              ? ErrorCode.PERMISSION_DENIED
              : status === 429
                ? ErrorCode.RATE_LIMITED
                : ErrorCode.INTERNAL_ERROR;

      logger.warn({ requestId, code, status }, exception.message);
      const envelope: ErrorEnvelope = {
        error: {
          code,
          message: status >= 500 ? 'An unexpected error occurred.' : exception.message,
          requestId,
          details: null,
          retryable: status >= 500,
          retryAfterSeconds: null,
        },
      };
      reply.status(status).send(envelope);
      return;
    }

    // Anything else is a bug. Log everything; tell the client nothing.
    logger.error(
      { requestId, err: exception },
      'Unhandled exception — this is a defect, not an expected error path',
    );

    /*
     * ...and written down, so the next report of "an unexpected error occurred" can be answered by
     * reading a file rather than by sweeping every route in the module hoping to trip it again.
     *
     * Never allowed to throw: a filter that fails while handling a failure turns a 500 into a
     * hung request, and the log is a convenience while the response is the contract.
     */
    if (DEFECT_LOG !== null) {
      try {
        mkdirSync(dirname(DEFECT_LOG), { recursive: true });
        appendFileSync(
          DEFECT_LOG,
          `${new Date().toISOString()}  ${requestId}  ${request.method} ${request.url}\n` +
            `${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}\n\n`,
        );
      } catch {
        // The log is best effort. The member already has their requestId and their 500.
      }
    }

    const envelope: ErrorEnvelope = {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred.',
        requestId,
        details: null,
        retryable: true,
        retryAfterSeconds: null,
      },
    };
    reply.status(500).send(envelope);
  }
}
