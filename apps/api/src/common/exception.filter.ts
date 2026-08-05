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

    /*
     * ★ FASTIFY'S OWN ERRORS CARRY A STATUS, AND WE WERE THROWING IT AWAY ★
     *
     * A plugin registered on the Fastify instance rather than inside Nest throws a plain `Error`
     * with a numeric `statusCode` — that is Fastify's convention, not Nest's, so it is neither an
     * `AppError` nor an `HttpException` and fell through to "anything else is a bug".
     *
     * `@fastify/rate-limit` is exactly that. A member who connected the companion app for the
     * first time uploaded their whole journal history, crossed the per-device budget, and got
     * FOUR HTTP 500s — logged as "this is a defect", which they were not. The app reads any
     * failure as a refusal and told them "the hub refused the last upload". Reported by the
     * squadron owner on 2026-08-05.
     *
     * A 429 and a 500 mean opposite things to a client: one says wait and try again, the other
     * says something is broken and there is nothing you can do. Turning the first into the second
     * is how a working rate limit becomes an outage report.
     *
     * ★ retryAfterSeconds, WHICH HAS ALWAYS BEEN IN THE ENVELOPE AND NEVER SET ★
     *
     * The error contract carries `retryAfterSeconds` for precisely this case. Fastify has already
     * put the same figure on the `retry-after` header by the time the filter runs, so it is read
     * from there rather than parsed out of an English sentence that upstream may reword.
     */
    const fastifyStatus = (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof fastifyStatus === 'number' && fastifyStatus >= 400 && fastifyStatus < 500) {
      const header = reply.getHeader('retry-after');
      const retryAfterSeconds =
        typeof header === 'number'
          ? header
          : typeof header === 'string' && /^\d+$/.test(header)
            ? Number(header)
            : null;

      const code: ErrorCodeName =
        fastifyStatus === 429
          ? ErrorCode.RATE_LIMITED
          : fastifyStatus === 404
            ? ErrorCode.RESOURCE_NOT_VISIBLE
            : fastifyStatus === 401
              ? ErrorCode.UNAUTHENTICATED
              : fastifyStatus === 403
                ? ErrorCode.PERMISSION_DENIED
                : ErrorCode.VALIDATION_FAILED;

      logger.warn(
        { requestId, code, status: fastifyStatus, retryAfterSeconds },
        exception instanceof Error ? exception.message : 'Rejected before the handler.',
      );

      const envelope: ErrorEnvelope = {
        error: {
          code,
          message:
            exception instanceof Error ? exception.message : 'That request was not accepted.',
          requestId,
          details: null,
          // A rate limit clears by itself; the others need the caller to change something.
          retryable: fastifyStatus === 429,
          retryAfterSeconds,
        },
      };
      reply.status(fastifyStatus).send(envelope);
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
