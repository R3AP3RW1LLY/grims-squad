import { PrismaClient } from '@prisma/client';

/**
 * The Prisma client.
 *
 * A single instance is reused across hot reloads in development — Next.js and
 * NestJS both re-evaluate modules, and a fresh PrismaClient per reload exhausts
 * the connection pool within a few minutes of editing.
 *
 * The ACL-enforcing extension (P1.3) wraps this. Application code should import
 * the wrapped client from there once it exists, not this one — INV-002 requires
 * authorization in the data layer, and an un-wrapped client bypasses it.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
export * from './acl-extension.js';
export * from './nonce.store.prisma.js';
export { PrismaPromotionStore } from './promotion.store.prisma.js';
/*
 * Colonisation.
 *
 * ★ IT LIVES HERE SO THERE IS ONE IMPLEMENTATION, NOT TWO ★
 *
 * The worker runs this on a schedule to reconcile every live project. The API runs the SAME job,
 * narrowed to one site, the moment a member's companion uploads a delivery — because the API is the
 * one process guaranteed to be running when telemetry arrives, and a member who has just handed over
 * cargo should not have to wait for a background daemon that may not be up. Two write paths into the
 * same tables would be two chances to disagree; this is one job with two callers.
 */
export * from './colony-sync.js';
export { PrismaColonyStore } from './colony.store.prisma.js';
export * from './colony-catalogue.js';
export { DiscordRankApplier, ladderRoleIds } from './rank-applier.discord.js';
