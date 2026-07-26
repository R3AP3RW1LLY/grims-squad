import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode, type ErrorEnvelope, type ErrorCodeName } from '@grims/shared';
import { logger } from '../logging.js';

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
