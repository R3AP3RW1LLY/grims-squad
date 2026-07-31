import { Global, Module, type OnModuleDestroy, type OnModuleInit, Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MODEL_WARM_INTERVAL_MS } from '@grims/shared';
import { AiClient, aiConfigFrom } from './ai.client.js';
import { EmbedClient, embedRootFrom } from './embed.client.js';
import { DecisionStore } from './decision.store.js';
import { ReportService } from './report.service.js';
import { ImageClient, imageConfigFrom } from './image.client.js';
import { AiLog } from './ai-log.port.js';
import { PrismaAiLog } from './ai-log.prisma.js';
import { ScreeningService } from './screening.service.js';
import { ArtworkService, ArtworkQuota } from './artwork.service.js';
import { PrismaArtworkQuota } from './artwork-quota.prisma.js';
import { ReviewQueueService } from './review-queue.service.js';
import { AiStreamService } from './ai-stream.service.js';
import { AiController } from './ai.controller.js';
import { TrainingStatusService } from './training.service.js';
import { KnowledgeService } from './knowledge.service.js';
import { CorpusService } from './corpus.service.js';
import { JobLogListener } from './job-log.listener.js';
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
/**
 * Keeps the text model loaded.
 *
 * ★ THE BUG THIS EXISTS FOR ★
 *
 * Measured 2026-07-31: screening takes 0.22s with the model resident and 8.70s without. The model
 * was unloading after five minutes idle, so every post after a quiet spell paid the cold load and
 * missed the timeout — the member's post was held for review and the admin log read "No answer from
 * the model", which looks like a broken GPU rather than a model that had simply gone to sleep.
 *
 * ★ WHY A HEARTBEAT AND NOT JUST keep_alive ★
 *
 * Every request already carries `keep_alive: -1`. That covers a model that is loaded and idling. It
 * does not cover the model server being restarted, the machine waking from sleep, or another model
 * evicting ours — and in each of those the person who discovers it is the next member to post.
 *
 * ★ NOTHING HERE CAN FAIL A BOOT ★
 *
 * The warm-up is fired and not awaited, and its errors are swallowed. The model being unreachable is
 * an ordinary state — the machine may simply be off — and the API must start regardless. Whether it
 * is actually answering is the health route's question, not startup's.
 */
@Injectable()
export class ModelWarmer implements OnModuleInit, OnModuleDestroy {
  #timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(AiStreamService) private readonly stream: AiStreamService,
  ) {}

  onModuleInit(): void {
    if (!this.ai.configured) {
      /*
       * Said out loud, once, on the stream. An officer watching an empty log needs to know the
       * difference between "nothing has happened" and "screening is not switched on at all" — and
       * the second one means every post is publishing unscreened.
       */
      this.stream.emit({
        level: 'warn',
        kind: 'health',
        message: 'GMSD AI is not configured — posts are publishing without screening.',
      });
      return;
    }

    void this.#beat();

    this.#timer = setInterval(() => {
      void this.#beat();
    }, MODEL_WARM_INTERVAL_MS);
    // Does not hold the process open: a heartbeat must never be the reason a container will not exit.
    this.#timer.unref?.();
  }

  /**
   * Keeps the model warm AND says so on the live log.
   *
   * ★ SQUADRON OWNER, 2026-07-31: "show pings that keep it alive" ★
   *
   * A silent log is ambiguous — it means either "nothing is happening" or "this is dead", and those
   * need opposite reactions. A heartbeat every few minutes removes the ambiguity: while pings are
   * arriving, the stream and the model are both proven, so silence becomes evidence rather than
   * uncertainty.
   *
   * It reports the FAILURE too. A ping that says the model did not answer is exactly the warning
   * somebody needs before members start finding their posts held.
   */
  async #beat(): Promise<void> {
    const started = Date.now();
    let ok = false;
    try {
      ok = await this.ai.warm();
    } catch {
      ok = false;
    }

    this.stream.emit({
      level: ok ? 'info' : 'error',
      kind: 'health',
      message: ok ? 'GMSD AI ready — model warm' : 'GMSD AI did not answer — posts will be held',
      tookMs: Date.now() - started,
    });
  }

  onModuleDestroy(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
  }
}

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
      provide: EmbedClient,
      useFactory: () => new EmbedClient(embedRootFrom(process.env)),
    },
    {
      provide: DecisionStore,
      inject: [PrismaClient, EmbedClient],
      /*
       * The plain client, not an AclBoundClient. `screen_decisions` carries no ACL column: a
       * decision is squadron policy rather than somebody's content, and screening reads it on behalf
       * of the system rather than of the member posting.
       */
      useFactory: (db: PrismaClient, embed: EmbedClient) => new DecisionStore(db, embed),
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
      inject: [AiClient, AiLog, DecisionStore],
      useFactory: (ai: AiClient, log: AiLog, decisions: DecisionStore) =>
        new ScreeningService(ai, log, decisions),
    },
    {
      provide: ArtworkService,
      inject: [ImageClient, AiLog, ArtworkQuota, AiStreamService],
      useFactory: (images: ImageClient, log: AiLog, quota: ArtworkQuota, stream: AiStreamService) =>
        new ArtworkService(images, log, quota, stream),
    },
    {
      provide: ReviewQueueService,
      inject: [DecisionStore],
      useFactory: (decisions: DecisionStore) => new ReviewQueueService(decisions),
    },
    {
      provide: ReportService,
      inject: [DecisionStore],
      useFactory: (decisions: DecisionStore) => new ReportService(decisions),
    },
    // Reads the knowledge tables directly; no client, no stream, nothing to configure.
    TrainingStatusService,
    /*
     * Retrieval. The half of the assistant that decides whether it is any good — the model brings
     * language, this brings facts, and keeping them apart is what lets it say "I do not know"
     * instead of inventing a station.
     */
    KnowledgeService,
    // Help Train the Bot. Never touches bytes — the media pipeline does that.
    CorpusService,
    /*
     * Brings the worker's ingest and embed activity onto the live log. The jobs run in a container
     * that exits when it is done, so they announce over Postgres NOTIFY and this forwards.
     */
    JobLogListener,
    ModelWarmer,
  ],
  controllers: [AiController, ArtworkController],
  exports: [
    AiClient,
    KnowledgeService,
    DecisionStore,
    EmbedClient,
    ImageClient,
    AiLog,
    ScreeningService,
    ArtworkService,
    ReviewQueueService,
    ReportService,
    AiStreamService,
  ],
})
export class AiModule {}
