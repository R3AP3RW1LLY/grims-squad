import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AiClient, aiConfigFrom } from './ai.client.js';
import { ImageClient, imageConfigFrom } from './image.client.js';
import { AiLog } from './ai-log.port.js';
import { PrismaAiLog } from './ai-log.prisma.js';
import { ScreeningService } from './screening.service.js';
import { ArtworkService, ArtworkQuota } from './artwork.service.js';
import { PrismaArtworkQuota } from './artwork-quota.prisma.js';
import { ReviewQueueService } from './review-queue.service.js';
import { AiStreamService } from './ai-stream.service.js';
import { AiController } from './ai.controller.js';
import { ArtworkController } from './artwork.controller.js';

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
      provide: ImageClient,
      inject: [AiStreamService],
      /*
       * A SECOND client, and a second base URL. The text model is Ollama on the 3060; this is
       * ComfyUI on the 5070 Ti. They are different protocols on different ports on different cards,
       * and collapsing them into one provider would mean the image model going down takes screening
       * with it — the exact coupling the two-card split exists to avoid.
       */
      useFactory: (stream: AiStreamService) =>
        new ImageClient(imageConfigFrom(process.env), fetch, stream),
    },
    {
      provide: AiLog,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaAiLog(db),
    },
    {
      provide: ArtworkQuota,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaArtworkQuota(db),
    },
    {
      provide: ScreeningService,
      inject: [AiClient, AiLog],
      useFactory: (ai: AiClient, log: AiLog) => new ScreeningService(ai, log),
    },
    {
      provide: ArtworkService,
      inject: [ImageClient, AiLog, ArtworkQuota, AiStreamService],
      useFactory: (images: ImageClient, log: AiLog, quota: ArtworkQuota, stream: AiStreamService) =>
        new ArtworkService(images, log, quota, stream),
    },
    ReviewQueueService,
  ],
  controllers: [AiController, ArtworkController],
  exports: [
    AiClient,
    ImageClient,
    AiLog,
    ScreeningService,
    ArtworkService,
    ReviewQueueService,
    AiStreamService,
  ],
})
export class AiModule {}
