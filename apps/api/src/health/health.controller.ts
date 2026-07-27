import { Public } from '../auth/auth.guard.js';
import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { Meilisearch } from 'meilisearch';
import { HealthService, type DependencyProbe } from './health.service.js';

const VERSION = process.env['npm_package_version'] ?? '0.0.0';

/**
 * Real connectivity checks, not liveness stubs. Each probe issues an actual
 * round trip — a health endpoint that only reports "the process is running" is
 * worse than none, because it reports green during an outage.
 */
function buildProbes(): DependencyProbe[] {
  const prisma = new PrismaClient();

  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // Do not let ioredis retry forever behind the probe's own timeout.
    retryStrategy: () => null,
  });

  const meili = new Meilisearch({
    host: process.env['MEILI_HOST'] ?? 'http://localhost:7700',
    apiKey: process.env['MEILI_MASTER_KEY'] ?? '',
  });

  return [
    {
      name: 'db',
      // The ONLY critical dependency. Everything else has a degraded path.
      critical: true,
      check: async () => {
        const t = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        return { status: 'ok' as const, latencyMs: Date.now() - t };
      },
    },
    {
      name: 'redis',
      critical: false,
      check: async () => {
        const t = Date.now();
        if (redis.status !== 'ready') await redis.connect();
        await redis.ping();
        return { status: 'ok' as const, latencyMs: Date.now() - t };
      },
    },
    {
      name: 'meilisearch',
      critical: false,
      check: async () => {
        const t = Date.now();
        await meili.health();
        return { status: 'ok' as const, latencyMs: Date.now() - t };
      },
    },
  ];
}

@Controller('v1/health')
@Public()
export class HealthController {
  private readonly service = new HealthService(buildProbes(), VERSION);

  @Get()
  async get(@Res() reply: FastifyReply): Promise<void> {
    const result = await this.service.check();
    const { httpStatus, ...body } = result;
    // 200 for ok AND degraded. 503 only when Postgres is unreachable.
    await reply.status(httpStatus).send(body);
  }
}
