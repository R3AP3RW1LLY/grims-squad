import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { AclDbService } from '../authz/acl-db.service.js';
import { MarketController } from './market.controller.js';
import { ColonyController } from './colony.controller.js';
import { ColonyDeviceController } from './colony-device.controller.js';
import { TradeDeviceController } from './trade-device.controller.js';
import { ColonyService } from './colony.service.js';
import { ColonyCatalogueService } from './colony-catalogue.service.js';
import { ColonyPlanService } from './colony-plan.service.js';
import { ColonyCarrierService } from './colony-carrier.service.js';
import { ColonyPurchasesService } from './colony-purchases.service.js';
import { ColonyPlanReviewService } from './colony-plan-review.service.js';
import { AiClient, aiConfigFrom } from '../ai/ai.client.js';
import { CommanderPositionService } from './commander-position.service.js';
import { ColonyRosterService } from './colony-roster.service.js';
import { PrismaMarketStore, type MarketStore } from './market.store.js';
import { MARKET_STORE } from './logistics.tokens.js';
import { LIVE_SERVICE } from '../live/live.tokens.js';
import { liveNudgeOf } from '../live/live-nudge.js';
import type { LiveService } from '../live/live.service.js';

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
  controllers: [MarketController, ColonyController, ColonyDeviceController, TradeDeviceController],
  providers: [
    {
      provide: MARKET_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaMarketStore(db),
    },
    {
      // The roster is its own service because its rules are about PEOPLE — who may direct whom —
      // where ColonyService's are about the build. Folding them together would put two unrelated
      // authorisation stories in one file.
      provide: ColonyRosterService,
      /*
       * LIVE_SERVICE is optional in the factory for the same reason producers take the nudge as
       * an optional parameter: the crew notices are decoration, and a wiring where the live
       * module were absent must still serve the roster. `liveNudgeOf` tolerates null.
       */
      inject: [PrismaClient, AclDbService, { token: LIVE_SERVICE, optional: true }],
      useFactory: (db: PrismaClient, acl: AclDbService, live?: LiveService) =>
        new ColonyRosterService(db, acl, liveNudgeOf(live)),
    },
    {
      /*
       * Colonisation takes the market store as well as the database, because a project's shopping
       * list — "Squadron projects also get a shopping list from the Freight Office" — is the market
       * answering "where do I buy this" for each outstanding need. One implementation of those
       * index-shaped queries, used by both features.
       */
      /*
       * The build catalogue. Reads the market store like the shopping list does, because "what
       * does a Coriolis cost near me" is the same question as "where do I buy this project's
       * remaining steel" asked before the project exists.
       */
      /*
       * The planner. Its fetcher is the global `fetch`, injected rather than imported so the
       * service can be tested without a network — the same seam every other outward call here uses.
       */
      provide: ColonyPlanService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) =>
        new ColonyPlanService(db, async (url: string) => {
          const response = await fetch(url);
          return { ok: response.ok, status: response.status, text: () => response.text() };
        }),
    },
    {
      /*
       * Where a member was last. Takes the market store's own system lookup rather than a second
       * one — an origin resolved two different ways is two different answers to the same question.
       */
      provide: CommanderPositionService,
      inject: [PrismaClient, MARKET_STORE],
      useFactory: (db: PrismaClient, market: MarketStore) =>
        new CommanderPositionService(db, (system: string) => market.systemCoords(system)),
    },
    {
      /*
       * Carriers. No injected fetcher, because everything it reads is already in our own market
       * mirror — see the note at the top of the service on why the hold comes from EDDN rather than
       * from somebody's journal.
       */
      provide: ColonyCarrierService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new ColonyCarrierService(db),
    },
    {
      /*
       * The shopping route: where to fly for what this build still needs. Half of it is derived from
       * MarketBuy telemetry and half is hand-typed.
       *
       * It takes the carrier service because "what is still to buy" has to subtract what is already
       * aboard, and the three-source merge that decides how much that is lives there. Asking for it
       * rather than re-deriving it in SQL is what stops the two answers drifting apart.
       */
      provide: ColonyPurchasesService,
      inject: [PrismaClient, ColonyCarrierService],
      useFactory: (db: PrismaClient, carriers: ColonyCarrierService) =>
        new ColonyPurchasesService(db, carriers),
    },
    {
      /*
       * The plan review. Takes the planner (for the plan and its simulation) and the AI client —
       * the model supplies sentences, the simulation supplies every fact, and the facts come back
       * with the answer so a bad review can be told from bad data.
       */
      provide: ColonyPlanReviewService,
      inject: [ColonyPlanService],
      /*
       * ★ THE CLIENT IS BUILT HERE, NOT IMPORTED — PRODUCTION OUTAGE, 2026-08-10 ★
       *
       * The first version added `AiModule` to this module's imports, which closed a cycle:
       *
       *     LogisticsModule -> AiModule -> MiningModule -> LogisticsModule
       *
       * ESM evaluates that as `ReferenceError: Cannot access 'LogisticsModule' before
       * initialization` — the API crash-looped, the website kept serving its static pages, and the
       * health monitor caught it a minute later. Typecheck, lint and every unit test were green:
       * nothing in this repository loads the real module graph, so nothing could see it.
       *
       * `AiClient` is a plain class over `fetch` with no Nest dependencies of its own — the same
       * construction `AiModule` performs, minus the admin stream, which is optional by design and
       * only feeds the AI activity panel. Building it here costs one object and closes the cycle.
       */
      useFactory: (plans: ColonyPlanService) =>
        new ColonyPlanReviewService(plans, new AiClient(aiConfigFrom(process.env), fetch)),
    },
    {
      provide: ColonyCatalogueService,
      inject: [PrismaClient, MARKET_STORE],
      useFactory: (db: PrismaClient, market: MarketStore) =>
        new ColonyCatalogueService(db, market),
    },
    {
      provide: ColonyService,
      // AclDbService as well: projects carry a visibility, so every read of one is bound to whoever
      // is asking (INV-002). The plain client is for `colony_needs` and the contribution ledger,
      // which carry no ACL column and are only ever reached through a resolved project.
      inject: [PrismaClient, MARKET_STORE, AclDbService, { token: LIVE_SERVICE, optional: true }],
      useFactory: (db: PrismaClient, market: MarketStore, acl: AclDbService, live?: LiveService) =>
        new ColonyService(db, market, acl, liveNudgeOf(live)),
    },
  ],
  /*
   * The market store is EXPORTED so the mining module can price a hold against the same eighteen
   * million rows the colony shopping list reads. A second store built on the same table would be a
   * second place for the carrier-exclusion and staleness rules to drift apart, and those rules are
   * the ones that stop a member being sent across the bubble to a price nobody has seen in a month.
   */
  /*
   * `ColonyPlanService` is exported so the colonisation scout can survey a candidate through the
   * SAME instance the planner uses. That matters: its fetch-and-cache is the only path that leaves
   * hand-entered slot counts intact on a refresh, and a second instance would mean a second cache
   * with its own idea of how fresh a system is.
   */
  exports: [MARKET_STORE, ColonyPlanService],
})
export class LogisticsModule {}
