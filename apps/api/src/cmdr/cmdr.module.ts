import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { CmdrController } from './cmdr.controller.js';
import { CmdrService } from './cmdr.service.js';
import { PrismaCmdrStore } from './cmdr.store.prisma.js';
import { NonceService } from '@grims/shared';
import { PrismaNonceStore } from '@grims/db';
import { CMDR_SERVICE, NONCE_SERVICE } from './cmdr.tokens.js';

@Module({
  imports: [DatabaseModule],
  controllers: [CmdrController],
  providers: [
    {
      provide: CMDR_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new CmdrService(new PrismaCmdrStore(db)),
    },
    {
      provide: NONCE_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new NonceService(new PrismaNonceStore(db)),
    },
  ],
})
export class CmdrModule {}
