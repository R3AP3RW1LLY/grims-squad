import type { PrismaClient } from '@prisma/client';
import { AiLog, type AiCallRecord } from './ai-log.port.js';

/**
 * The real call log.
 *
 * ★ THE PLAIN CLIENT, NOT AN AclBoundClient ★
 *
 * `ai_calls` carries no ACL column and is not an ACL-bearing model. Who may READ it is decided by
 * `AI_REVIEW` at the route, which is a permission question rather than a row-level one — every row
 * is visible to a reviewer or none are.
 *
 * Writing is different again: the log records calls made BY members who cannot read it, so binding
 * the write to the caller's own visibility would be exactly backwards.
 */
export class PrismaAiLog extends AiLog {
  constructor(private readonly db: PrismaClient) {
    super();
  }

  async record(entry: AiCallRecord): Promise<void> {
    await this.db.aiCall.create({
      data: {
        userId: entry.userId,
        kind: entry.kind,
        surface: entry.surface,
        prompt: entry.prompt,
        response: entry.response,
        ...(entry.refusedReason === undefined ? {} : { refusedReason: entry.refusedReason }),
        ...(entry.tookMs === undefined ? {} : { tookMs: entry.tookMs }),
      },
    });
  }
}
