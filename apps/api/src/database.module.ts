import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';

/**
 * The single Prisma client for the process.
 *
 * `@Global` because nearly every feature module needs it and threading a
 * DatabaseModule import through all of them adds ceremony without adding
 * safety. One client matters: Prisma owns a connection pool, so a second
 * instance silently doubles the connection count against Postgres and the
 * limit is reached in production rather than in testing.
 */
@Global()
@Module({
  providers: [{ provide: PrismaClient, useFactory: () => new PrismaClient() }],
  exports: [PrismaClient],
})
export class DatabaseModule {}
