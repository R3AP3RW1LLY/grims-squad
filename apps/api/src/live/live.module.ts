import { Global, Inject, Module, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { LiveController } from './live.controller.js';
import { LiveService } from './live.service.js';
import { LiveBridge } from './live.bridge.js';
import { LIVE_SERVICE } from './live.tokens.js';

/**
 * The live event stream.
 *
 * ★ @Global, AND FOR A REASON ★
 *
 * Anything that changes a member's data should be able to say so — telemetry
 * ingest, verification, the roster. Wiring the service into each of those
 * modules by hand means the next feature that forgets simply does not update
 * live, and nobody notices because the page still works after a refresh.
 *
 * ONE instance, which is what makes it work at all: subscribers live in memory
 * on the service, so a second instance would hold half the connections and
 * publish to the wrong ones.
 */
@Global()
@Module({
  controllers: [LiveController],
  providers: [
    { provide: LIVE_SERVICE, useFactory: () => new LiveService() },
    {
      /*
       * The bridge from the scheduled jobs.
       *
       * Provided here rather than in the worker's own wiring because the
       * SUBSCRIBER has to live wherever the sockets live, and they live in this
       * process. See live.bridge.ts for why this exists at all.
       */
      provide: LiveBridge,
      useFactory: (live: LiveService) =>
        new LiveBridge(live, process.env['REDIS_URL'] ?? 'redis://localhost:6379'),
      inject: [LIVE_SERVICE],
    },
  ],
  exports: [LIVE_SERVICE],
})
export class LiveModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(LiveBridge) private readonly bridge: LiveBridge) {}

  onModuleInit(): void {
    this.bridge.start();
  }

  async onModuleDestroy(): Promise<void> {
    // Closed on shutdown so a rolling deploy does not leave a subscriber
    // connection behind on the old container for Redis to hold open.
    await this.bridge.stop();
  }
}
