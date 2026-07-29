import { Global, Module } from '@nestjs/common';
import { LiveController } from './live.controller.js';
import { LiveService } from './live.service.js';
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
  providers: [{ provide: LIVE_SERVICE, useFactory: () => new LiveService() }],
  exports: [LIVE_SERVICE],
})
export class LiveModule {}
