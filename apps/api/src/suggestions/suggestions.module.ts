import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { ForumModule } from '../forum/forum.module.js';
import { SuggestionsController } from './suggestions.controller.js';
import { SuggestionsInboxController } from './suggestions-inbox.controller.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * The suggestion box: two doors onto one service.
 *
 *   SuggestionsController       the sending side — members by session, and their own list.
 *   SuggestionsInboxController  the reviewing side, behind SITE_CONFIG and the second factor.
 *
 * ForumModule is imported for `ThreadService` — the SAME instance the forum's HTTP path uses,
 * sanitiser, screening and all, exactly as the announcements carbon-copy does it: a published
 * suggestion must be a real thread, not a lookalike written by a second code path.
 * `AclDbService` and `PermissionService` come from the @Global authz module. AuthModule is
 * what the admin module imports it for: TotpService, which the AdminGateGuard on the inbox
 * resolves — without it the guard cannot construct and every inbox route 500s.
 */
@Module({
  imports: [DatabaseModule, ForumModule, AuthModule],
  controllers: [SuggestionsController, SuggestionsInboxController],
  providers: [SuggestionsService],
})
export class SuggestionsModule {}
