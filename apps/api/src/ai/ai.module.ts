import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AiClient, aiConfigFrom } from './ai.client.js';
import { AiLog } from './ai-log.port.js';
import { PrismaAiLog } from './ai-log.prisma.js';
import { ScreeningService } from './screening.service.js';
import { ReviewQueueService } from './review-queue.service.js';
import { AiStreamService } from './ai-stream.service.js';
import { AiController } from './ai.controller.js';

/**
 * The AI, wired.
 *
 * ★ @Global, BECAUSE SCREENING SITS ON THE POST PATH ★
 *
 * The forum module needs the screener and the review queue, and the admin module needs the log.
 * Exporting globally beats threading the same three providers through every module that touches a
 * post — and it makes it obvious that screening is infrastructure rather than a forum feature.
 *
 * ★ AN UNCONFIGURED AI IS A WORKING STATE ★
 *
 * `aiConfigFrom` returns null when `AI_BASE_URL` is unset, and `AiClient` handles that by reporting
 * itself unconfigured. Nothing here throws on a missing model — the site runs today with no AI at
 * all, and it must keep running whenever the owner's machine is off.
 */
@Global()
@Module({
  providers: [
    AiStreamService,
    {
      provide: AiClient,
      inject: [AiStreamService],
      /*
       * The stream is handed to the client so a failing model is VISIBLE while it fails, rather
       * than only afterwards in `ai_calls`. Redaction happens inside the stream, not here — one
       * funnel, so no future call site can forget.
       */
      useFactory: (stream: AiStreamService) => new AiClient(aiConfigFrom(process.env), fetch, stream),
    },
    {
      provide: AiLog,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaAiLog(db),
    },
    {
      provide: ScreeningService,
      inject: [AiClient, AiLog],
      useFactory: (ai: AiClient, log: AiLog) => new ScreeningService(ai, log),
    },
    ReviewQueueService,
  ],
  controllers: [AiController],
  exports: [AiClient, AiLog, ScreeningService, ReviewQueueService, AiStreamService],
})
export class AiModule {}
