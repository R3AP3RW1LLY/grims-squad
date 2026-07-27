import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
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

  // Needed by the OAuth nonce cookie that binds login state to the browser.
  await app.register(fastifyCookie);

  /*
   * ★ RED-TEAM FINDING, 2026-07-27 — the API had NO rate limiting at all. ★
   *
   * TOTP had its own lockout, which was the loudest case and hid the general
   * one: every other endpoint was unthrottled. That leaves handle enumeration
   * on /v1/members/:handle, repeated Inara link attempts, and refresh-token
   * grinding all free of charge.
   *
   * Keyed on the SESSION where there is one and the IP otherwise. Keying on IP
   * alone would let one member behind a shared address exhaust the budget for
   * everybody else on it — which for a squadron that games together is a
   * realistic Saturday night, not a hypothetical.
   *
   * Generous on purpose: 300/minute is far above anything a person does and
   * far below what a script does. This is a backstop against automation, not a
   * quota, and a limit that legitimate use ever touches is a limit that gets
   * removed.
   */
  await app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies;
      const session = cookies?.['__Host-gs_rt'] ?? cookies?.['gs_rt'];
      // The refresh token is hashed rather than used raw: it is a credential,
      // and a rate-limit key ends up in memory and in metrics.
      return session === undefined ? req.ip : createHash('sha256').update(session).digest('hex');
    },
    // The health endpoint is polled by the container runtime. Throttling it
    // would make a busy API look unhealthy and get it restarted.
    allowList: (req) => req.url.startsWith('/v1/health'),
  });

  app.useGlobalFilters(new GlobalExceptionFilter());

  /*
   * Request logging. Absent until now, which meant a failed login left no trace
   * on the server at all — the only evidence was whatever Discord happened to
   * show the member. One line per completed request, with the correlation id.
   *
   * Deliberately NOT logging query strings: OAuth `code` and `state` arrive
   * there, and a code in a log file is a code someone can replay.
   */
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', (req, reply, done) => {
      logger.info(
        {
          reqId: req.id,
          method: req.method,
          path: (req.url ?? '').split('?')[0],
          status: reply.statusCode,
          ms: Math.round(reply.elapsedTime),
        },
        'request',
      );
      done();
    });

  // Echo the request ID back so a member can quote it in a bug report.
  app.getHttpAdapter().getInstance().addHook('onSend', (req, reply, _payload, done) => {
    void reply.header('x-request-id', req.id);
    done();
  });

  await app.listen(PORT, HOST);
  logger.info({ port: PORT, host: HOST }, 'api listening');
}

bootstrap().catch((err: unknown) => {
  // console.error, NOT the logger. Pino's pretty transport runs in a worker
  // thread, and `process.exit` tears that thread down before it flushes — so a
  // startup crash logged only through pino produces a silent exit code 1 with
  // no message at all. That is precisely the moment you most need the message.
  console.error('api failed to start:', err);
  logger.error({ err }, 'api failed to start');
  process.exit(1);
});
