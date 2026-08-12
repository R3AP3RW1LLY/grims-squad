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
export * from './colony-plan-link.store.js';
export * from './colony-plan-diverged.js';
/*
 * Stations learned live, shared by BOTH market writers — the EDDN collector and the API's journal
 * path — so an unknown station is added the same way whichever feed sees it first.
 */
export * from './live-stations.js';
export * from './live-systems.js';
export * from './notify.js';
/*
 * Announcements — Discord channel posts and forum carbon-copies, produced in three processes
 * (API, worker, deploy script) and delivered by two pollers. Shared here for the same reason
 * notify.ts is: one wording, one write path, whatever process happens to be announcing.
 */
export * from './announce.js';
export { DiscordRankApplier, ladderRoleIds } from './rank-applier.discord.js';
/*
 * Recording a verified commander name. Shared for the same reason as the three above: the API
 * learns a name when a member links a key, the worker learns one when the nightly sweep asks Inara
 * what they are called NOW, and the transaction they both need holds the index that stops two
 * members wearing one commander name.
 */
export * from './verified-name.js';
