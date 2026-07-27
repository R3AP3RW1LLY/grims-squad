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
