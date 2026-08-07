import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { RecruitController } from './recruit.controller.js';
import { RecruitService } from './recruit.service.js';

/**
 * Recruitment.
 *
 * The Discord values are provided rather than read inside the service, so a test can construct it
 * without a guild and so "which channel do invites point at" is a deployment decision visible in
 * one place rather than a `process.env` buried in a method.
 */
@Module({
  imports: [DatabaseModule, AuthzModule],
  controllers: [RecruitController],
  providers: [
    { provide: 'DISCORD_BOT_TOKEN', useValue: process.env['DISCORD_BOT_TOKEN'] ?? '' },
    { provide: 'DISCORD_GUILD_ID', useValue: process.env['DISCORD_GUILD_ID'] ?? '' },
    /*
     * Which channel a new member lands in. Its own variable rather than reusing the announcement
     * channel: an invite points somewhere a stranger arrives, and that is a different decision from
     * where the squadron talks to itself.
     */
    {
      provide: 'DISCORD_INVITE_CHANNEL_ID',
      useValue: process.env['DISCORD_INVITE_CHANNEL_ID'] ?? '',
    },
    {
      provide: RecruitService,
      inject: [PrismaClient, 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_INVITE_CHANNEL_ID'],
      useFactory: (db: PrismaClient, token: string, guild: string, channel: string) =>
        new RecruitService(db, token, guild, channel),
    },
  ],
  exports: [RecruitService],
})
export class RecruitModule {}
