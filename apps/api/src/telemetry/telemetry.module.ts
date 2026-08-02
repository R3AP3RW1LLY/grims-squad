import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { ShipBuildService } from '../ai/ship-build.service.js';
import { ColonyLiveService } from '../logistics/colony-live.service.js';
import { AclDbService } from '../authz/acl-db.service.js';
import { CompanionModule } from '../companion/companion.module.js';
import { TelemetryController } from './telemetry.controller.js';
import { PairingService } from './pairing.service.js';
import { DeviceLinkService } from './device-link.service.js';
import { JournalIngestService } from './journal-ingest.service.js';
import { ConsentService } from './consent.service.js';
import { PrismaPairingStore, PrismaIngestStore, PrismaConsentStore } from './telemetry.store.prisma.js';
import { PrismaMarketUpdater } from './market-live.js';
import { PAIRING_SERVICE, INGEST_SERVICE, CONSENT_SERVICE } from './telemetry.tokens.js';

@Module({
  /*
   * CompanionModule for the release store: the settings endpoint tells the app
   * the newest published version, which is what drives the update banner.
   */
  imports: [DatabaseModule, CompanionModule],
  controllers: [TelemetryController],
  providers: [
    {
      provide: PAIRING_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PairingService(new PrismaPairingStore(db)),
    },
    /*
     * Linking the companion app without anybody copying a credential. Uses the pairing service to
     * mint, so the five-device limit and the audit entry are the same ones the old flow produced.
     */
    DeviceLinkService,
    {
      provide: INGEST_SERVICE,
      inject: [PrismaClient, AclDbService],
      useFactory: (db: PrismaClient, acl: AclDbService) =>
        /*
         * The market updater is passed in here and nowhere else. It is what
         * turns a member opening a commodity screen into a price the whole
         * squadron can route against — the same table the nightly Spansh
         * rebuild fills, kept current in the day between rebuilds.
         */
        new JournalIngestService(
          new PrismaIngestStore(db),
          new PrismaMarketUpdater(db),
          /*
           * ★ THEIR OWN SHIPS, IMPORTED AS THEY FLY ★
           *
           * Squadron owner, 2026-08-01: automatic for everyone. A `Loadout` is the strongest build
           * we can hold — what is bolted to the hull, with the engineering actually on it — and it
           * refreshes on every refit with nobody pasting anything.
           *
           * Constructed here rather than injected from the AI module: telemetry must not depend on
           * the assistant.
           *
           * It takes the ACL client as well as the plain one now: a build carries a visibility, so
           * every read of one is bound to whoever it is for (INV-002). A journal import is on
           * behalf of the member whose ship it is, and binds to them.
           */
          new ShipBuildService(db, acl),
          /*
           * ★ A DELIVERY LANDS WHEN IT IS UPLOADED, NOT WHEN A DAEMON NEXT WAKES ★
           *
           * Squadron owner, 2026-08-02: "i have made several deliveries to the project, but they
           * are not seeming to register." Nine contribution events were in telemetry and six had
           * become ledger rows, because the only thing converting them ran in the worker daemon
           * and the daemon was down.
           *
           * Constructed here for the same reason the market updater is: the API is the process
           * that must be up for the events to have arrived at all, so it is the one place the
           * conversion cannot be missed. The worker's scheduled pass stays as the backstop.
           */
          new ColonyLiveService(db),
        ),
    },
    {
      provide: CONSENT_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new ConsentService(new PrismaConsentStore(db)),
    },
  ],
  /*
   * ★ ONLY THE PAIRING SERVICE LEAVES THIS MODULE ★
   *
   * Squadron owner, 2026-08-02: "people should be able to have full interaction with colonization
   * either from the website or from the app." The app identifies itself with a paired device token,
   * so the colonisation routes it reaches have to resolve one — and resolving it any other way
   * would be a second authentication path, which is how one of them ends up accepting a token the
   * other rejects.
   *
   * Exported alone. The ingest and consent services stay private: nothing outside telemetry should
   * be able to write a member's journal rows or change what they have agreed to.
   */
  exports: [PAIRING_SERVICE],
})
export class TelemetryModule {}
