import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module.js';
import { ForumModule } from '../forum/forum.module.js';
import { SuggestionsController } from './suggestions.controller.js';
import { SuggestionsInboxController } from './suggestions-inbox.controller.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * The suggestion box: two doors onto one service.
 *
 *   SuggestionsController       the sending side — members by session, and their own list.
 *   SuggestionsInboxController  the reviewing side, behind SITE_CONFIG.
 *
 * ForumModule is imported for `ThreadService` — the SAME instance the forum's HTTP path uses,
 * sanitiser, screening and all, exactly as the announcements carbon-copy does it: a published
 * suggestion must be a real thread, not a lookalike written by a second code path.
 * `AclDbService` and `PermissionService` come from the @Global authz module.
 */
@Module({
  imports: [DatabaseModule, ForumModule],
  controllers: [SuggestionsController, SuggestionsInboxController],
  providers: [SuggestionsService],
})
export class SuggestionsModule {}
