import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import {
  RoadmapController,
  RoadmapManageController,
  RoadmapPromotableController,
} from './roadmap.controller.js';
import { RoadmapService } from './roadmap.service.js';

/**
 * The roadmap: three doors onto one service, each gated for what it actually does.
 *
 *   RoadmapController            the reading side — every signed-in member, at /roadmap.
 *   RoadmapPromotableController  "is this thread promotable" — SITE_CONFIG, no second factor.
 *   RoadmapManageController      the kanban and every write, behind SITE_CONFIG AND the second
 *                                factor.
 *
 * The middle one exists because a read gated on a step-up degrades to INVISIBILITY: the promote
 * panel is drawn only when the API answers, so an idle webmaster nine hours past their last code
 * was shown no panel at all rather than a control that says why. Pressing Promote still lands on
 * the guarded route and is refused out loud.
 *
 * No forum import: promotion READS a thread (through the caller's bound client, which the
 * @Global authz module provides) rather than creating one — the thread already exists, made by
 * the suggestion publish flow. Creating threads stays ThreadService's monopoly. AuthModule is
 * here for TotpService, which the manage controller's AdminGateGuard resolves — the same
 * import the admin module carries for the same reason.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RoadmapController, RoadmapPromotableController, RoadmapManageController],
  providers: [RoadmapService],
})
export class RoadmapModule {}
