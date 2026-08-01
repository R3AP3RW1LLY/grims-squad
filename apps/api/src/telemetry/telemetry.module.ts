import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
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
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) =>
        /*
         * The market updater is passed in here and nowhere else. It is what
         * turns a member opening a commodity screen into a price the whole
         * squadron can route against — the same table the nightly Spansh
         * rebuild fills, kept current in the day between rebuilds.
         */
        new JournalIngestService(new PrismaIngestStore(db), new PrismaMarketUpdater(db)),
    },
    {
      provide: CONSENT_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new ConsentService(new PrismaConsentStore(db)),
    },
  ],
})
export class TelemetryModule {}
