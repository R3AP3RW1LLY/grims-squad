import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { AclDbService } from '../authz/acl-db.service.js';
import { MarketController } from './market.controller.js';
import { ColonyController } from './colony.controller.js';
import { ColonyDeviceController } from './colony-device.controller.js';
import { ColonyService } from './colony.service.js';
import { PrismaMarketStore, type MarketStore } from './market.store.js';
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
  // TelemetryModule for PAIRING_SERVICE: the companion identifies itself with a paired device
  // token rather than a session, and the colonisation routes it reaches resolve it the same way
  // the telemetry upload does.
  imports: [DatabaseModule, AuthzModule, TelemetryModule],
  controllers: [MarketController, ColonyController, ColonyDeviceController],
  providers: [
    {
      provide: MARKET_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaMarketStore(db),
    },
    {
      /*
       * Colonisation takes the market store as well as the database, because a project's shopping
       * list — "Squadron projects also get a shopping list from the Freight Office" — is the market
       * answering "where do I buy this" for each outstanding need. One implementation of those
       * index-shaped queries, used by both features.
       */
      provide: ColonyService,
      // AclDbService as well: projects carry a visibility, so every read of one is bound to whoever
      // is asking (INV-002). The plain client is for `colony_needs` and the contribution ledger,
      // which carry no ACL column and are only ever reached through a resolved project.
      inject: [PrismaClient, MARKET_STORE, AclDbService],
      useFactory: (db: PrismaClient, market: MarketStore, acl: AclDbService) =>
        new ColonyService(db, market, acl),
    },
  ],
})
export class LogisticsModule {}
