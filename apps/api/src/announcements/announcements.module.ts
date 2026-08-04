import { Module } from '@nestjs/common';
import { ForumModule } from '../forum/forum.module.js';
import { ForumCcService } from './forum-cc.service.js';

/**
 * The API side of the announcements pipeline.
 *
 * No controller — nothing here answers HTTP. The module exists to host the forum
 * carbon-copy poller, which turns `announcements` rows carrying a forum half into real
 * threads in the Announcements category and fans the bell out to every member. The rows
 * themselves are written by the producers (the promotion paths, the verification confirm
 * paths, the deploy script), and the Discord half is the bot's.
 *
 * ForumModule is imported for `ThreadService` — the SAME instance the forum's HTTP path
 * uses, sanitiser, screening and all, which is the entire point: a carbon-copy must be a
 * real thread, not a lookalike written by a second code path.
 */
@Module({
  imports: [ForumModule],
  providers: [ForumCcService],
})
export class AnnouncementsModule {}
