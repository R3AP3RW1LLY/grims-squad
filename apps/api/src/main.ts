import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/exception.filter.js';
import { logger } from './logging.js';

const PORT = Number(process.env['API_PORT'] ?? 5001);
const HOST = process.env['API_HOST'] ?? '0.0.0.0';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    // Every request gets an ID, correlated across web -> api -> gsai.
    // Honour an inbound header so a trace survives the hop.
    genReqId: (req: { headers: Record<string, unknown> }) =>
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    trustProxy: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    // Pino is the logger; Nest's own is silenced to avoid two formats in one stream.
    logger: false,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Echo the request ID back so a member can quote it in a bug report.
  app.getHttpAdapter().getInstance().addHook('onSend', (req, reply, _payload, done) => {
    void reply.header('x-request-id', req.id);
    done();
  });

  await app.listen(PORT, HOST);
  logger.info({ port: PORT, host: HOST }, 'api listening');
}

bootstrap().catch((err: unknown) => {
  logger.error({ err }, 'api failed to start');
  process.exit(1);
});
