import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module.js';
import { RoadmapController, RoadmapManageController } from './roadmap.controller.js';
import { RoadmapService } from './roadmap.service.js';

/**
 * The roadmap: two doors onto one service.
 *
 *   RoadmapController        the reading side — every signed-in member, at /roadmap.
 *   RoadmapManageController  the kanban, behind SITE_CONFIG.
 *
 * No forum import: promotion READS a thread (through the caller's bound client, which the
 * @Global authz module provides) rather than creating one — the thread already exists, made by
 * the suggestion publish flow. Creating threads stays ThreadService's monopoly.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [RoadmapController, RoadmapManageController],
  providers: [RoadmapService],
})
export class RoadmapModule {}
