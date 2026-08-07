import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { LogisticsModule } from '../logistics/logistics.module.js';
import { MARKET_STORE } from '../logistics/logistics.tokens.js';
import type { MarketStore } from '../logistics/market.store.js';
import { MiningController, MiningDeviceController } from './mining.controller.js';
import { MiningService } from './mining.service.js';

/**
 * The mining module.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... ultra feature ritch ... this must meet / exceed ED tools"
 *
 * Its own module rather than a corner of Logistics, because the subject is different: Logistics
 * answers "where do I buy and sell", this answers "where do I dig and what did I get". It borrows
 * the market store to price a hold — which is exactly the kind of dependency a module boundary
 * should make visible rather than hide behind a duplicated query.
 */
@Module({
  // LogisticsModule for MARKET_STORE (valuation against the live market table).
  // TelemetryModule for PAIRING_SERVICE (the companion's door authenticates a paired device).
  imports: [DatabaseModule, AuthzModule, TelemetryModule, LogisticsModule],
  controllers: [MiningController, MiningDeviceController],
  providers: [
    {
      provide: MiningService,
      inject: [PrismaClient, MARKET_STORE],
      useFactory: (db: PrismaClient, market: MarketStore) => new MiningService(db, market),
    },
  ],
  // Exported for the AI assistant's mining retrieval leg — one service answering "which rings are
  // paying", whether the question arrives from a page or from a member asking in words.
  exports: [MiningService],
})
export class MiningModule {}
