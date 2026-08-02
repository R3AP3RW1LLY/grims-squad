import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { MarketController } from './market.controller.js';
import { PrismaMarketStore } from './market.store.js';
import { MARKET_STORE } from './logistics.tokens.js';

/**
 * Logistics & Trade — the commodities market, and the Freight Office built on it.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "create another subcategory under Squadron called Logistics & Trade please."
 *
 * One module for both because they are one system: the planner is route-finding over exactly the
 * prices the market page lists, against exactly the same indexes, and splitting them would mean two
 * copies of the rules about which WHERE clauses may be touched.
 */
@Module({
  // AuthzModule for PermissionService: every route here checks TRADE_QUERY against the caller's own
  // mask, falling back to the guest preset when there is no session.
  imports: [DatabaseModule, AuthzModule],
  controllers: [MarketController],
  providers: [
    {
      provide: MARKET_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaMarketStore(db),
    },
  ],
})
export class LogisticsModule {}
