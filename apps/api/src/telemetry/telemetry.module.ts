import { Module } from '@nestjs/common';
import type { DockSighting, SystemSighting } from '@grims/shared';
import {
  enrichStationFromDock,
  notifyMembers,
  PrismaClient,
  recordSystemSighting,
} from '@grims/db';
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
import { LIVE_SERVICE } from '../live/live.tokens.js';
import { liveNudgeOf } from '../live/live-nudge.js';
import type { LiveService } from '../live/live.service.js';

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
      inject: [PrismaClient, { token: LIVE_SERVICE, optional: true }],
      useFactory: (db: PrismaClient, live?: LiveService) =>
        new PairingService(new PrismaPairingStore(db), async (userId, event, label) => {
          /*
           * The device.security notice, for both doors (the pasted token and the browser-approved
           * link both come through the pairing service). A credential appearing or disappearing
           * on an account is the one change a member should hear about even when they caused it —
           * because the time it matters is the time they did not.
           */
          await notifyMembers(
            db,
            [userId],
            event === 'paired'
              ? {
                  kind: 'device.security',
                  title: 'A device was paired to your account',
                  body: `“${label}” can now upload journal data for your commander. If this was not you, remove it and speak to an officer.`,
                  link: '/settings/devices',
                }
              : {
                  kind: 'device.security',
                  title: 'A device was removed from your account',
                  body: `“${label}” can no longer upload journal data. If this was not you, speak to an officer.`,
                  link: '/settings/devices',
                },
            liveNudgeOf(live),
          );
        }),
    },
    /*
     * Linking the companion app without anybody copying a credential. Uses the pairing service to
     * mint, so the five-device limit and the audit entry are the same ones the old flow produced.
     */
    DeviceLinkService,
    {
      provide: INGEST_SERVICE,
      inject: [PrismaClient, AclDbService, { token: LIVE_SERVICE, optional: true }],
      useFactory: (db: PrismaClient, acl: AclDbService, live?: LiveService) =>
        /*
         * The market updater is passed in here and nowhere else. It is what
         * turns a member opening a commodity screen into a price the whole
         * squadron can route against — the same table the nightly Spansh
         * rebuild fills, kept current in the day between rebuilds.
         */
        new JournalIngestService(
          new PrismaIngestStore(db),
          // The nudge is how a banked data bounty reaches the bell of the member whose upload
          // paid it, in the tab they are watching while still docked.
          new PrismaMarketUpdater(db, liveNudgeOf(live)),
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
          // The nudge rides to the sync's markComplete transition, so a build finished by THIS
          // upload announces itself through this process's own SSE service.
          new ColonyLiveService(db, liveNudgeOf(live)),
          /*
           * ★ THE MAP, UPDATED FROM WHERE PEOPLE ACTUALLY FLEW — 2026-08-08 ★
           *
           * `enrichStationFromDock` was written weeks ago, complete, and called by NOTHING. Docked
           * was never routed to it and the field allowlist discarded MarketID before it could have
           * been, so 987 docks a week taught us nothing and a member opening a new station stayed
           * invisible until EDDN caught up.
           *
           * Wired here for the same reason the colony sync is: the API is the process that must be
           * up for the events to have arrived at all, so it is the one place the conversion cannot
           * be missed.
           */
          {
            recordSystem: (seen: SystemSighting) => recordSystemSighting(db, seen),
            recordDock: (dock: DockSighting) => enrichStationFromDock(db, dock),
          },
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
