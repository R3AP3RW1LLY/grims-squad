import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { CompanionModule } from '../companion/companion.module.js';
import { TelemetryController } from './telemetry.controller.js';
import { PairingService } from './pairing.service.js';
import { JournalIngestService } from './journal-ingest.service.js';
import { ConsentService } from './consent.service.js';
import { PrismaPairingStore, PrismaIngestStore, PrismaConsentStore } from './telemetry.store.prisma.js';
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
    {
      provide: INGEST_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new JournalIngestService(new PrismaIngestStore(db)),
    },
    {
      provide: CONSENT_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new ConsentService(new PrismaConsentStore(db)),
    },
  ],
})
export class TelemetryModule {}
