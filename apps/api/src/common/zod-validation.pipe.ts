import { type PipeTransform, Injectable } from '@nestjs/common';
import { AppError, ErrorCode } from '@grims/shared';
import type { ZodTypeAny, ZodIssue } from 'zod';

/**
 * Parses an input against a Zod schema at the boundary.
 *
 * ENUMERATES EVERY FAILING FIELD, not just the first. A validation error that
 * reports one problem at a time turns a five-field form into five round trips,
 * and it is the difference between a usable API and an annoying one
 * (ssot/04-contracts/errors.md).
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Request validation failed.', {
      details: {
        issues: result.error.issues.map((i: ZodIssue) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      },
    });
  }
}
