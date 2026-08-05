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
    /*
     * Pino is the logger, so Nest's own is silenced to avoid two formats in one
     * stream — EXCEPT for errors and warnings.
     *
     * ★ WHY THE EXCEPTION MATTERS ★
     *
     * `logger: false` also silences Nest's startup ExceptionHandler. A dependency
     * that fails to resolve then kills the process with NO OUTPUT AT ALL: no
     * stack, no message, exit code 1, and an empty log file. It looks exactly
     * like the process was killed from outside.
     *
     * That cost an hour of bisecting to find a missing @Inject. Two log levels
     * is a small price for never doing it again.
     */
    logger: ['error', 'warn'],
  });

  // Needed by the OAuth nonce cookie that binds login state to the browser.
  await app.register(fastifyCookie);

  /*
   * ★ RAW IMAGE BODIES, AND WHY NOT MULTIPART ★
   *
   * Image uploads POST the file as the request BODY, with the image content type. The
   * obvious alternative is @fastify/multipart, and it was deliberately not used:
   *
   *   - Multipart is a parser. It is another dependency parsing attacker-controlled input
   *     before any of our code runs, to solve a problem we do not have — there is exactly
   *     one part, and no form fields alongside it.
   *   - Multipart carries a FILENAME. Nothing in the upload path reads one, because both
   *     the name and the declared type are attacker-controlled and neither is needed:
   *     the storage key is minted from our own row id, and the format comes from decoding
   *     the bytes. Not accepting a filename at all is stronger than remembering never to
   *     trust it.
   *
   * The parser below hands the route a Buffer and does nothing else. `bodyLimit` is
   * enforced by Fastify BEFORE the body is fully read, so an oversized upload is refused
   * at the socket rather than after being buffered into memory — which the byte check in
   * `hardenImage` cannot do, since by then it already exists.
   *
   * The declared content type still decides nothing: it selects this parser, and
   * `hardenImage` then determines the real format by decoding. A PNG announced as
   * image/jpeg is stored correctly as a PNG.
   */
  const RAW_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/octet-stream'];
  for (const type of RAW_IMAGE_TYPES) {
    app.getHttpAdapter().getInstance().addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 },
      (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
        done(null, body);
      },
    );
  }

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
    /*
     * ★ THE BACKFILL IS LEGITIMATE USE, AND 300 WAS BELOW IT — MEASURED 2026-08-05 ★
     *
     * The note above says a limit legitimate use ever touches is a limit that gets removed. It got
     * touched. A member pairing the companion for the first time uploads their whole journal
     * history, and that is a burst of one request per batch for as long as the history is long —
     * they crossed 300 in a minute, were refused, and the app told them the hub had rejected their
     * upload.
     *
     * ★ A FUNCTION, SO THE BULK PATH IS NOT MEASURED AGAINST THE BROWSING PATH ★
     *
     * Telemetry is the only route family that is bulk by nature, and it is already keyed per
     * DEVICE TOKEN rather than per IP — so a generous budget here cannot be spent by anything
     * except one paired install sending its own journal. Everything else keeps 300, which remains
     * far above what a person does in a browser.
     *
     * 2,000/minute is roughly a first-run backfill finishing in a couple of minutes instead of
     * failing, and is still an order of magnitude below what an unthrottled script would produce.
     */
    max: (req) => (req.url.startsWith('/v1/telemetry/') ? 2_000 : 300),
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      /*
       * The companion app has no session cookie, so without this branch every
       * paired device on a shared address — a household, a student hall, anyone
       * behind CGNAT — would compete for one 300/minute budget, and a member's
       * uploads could throttle their own web browsing.
       *
       * Keying on the DEVICE TOKEN gives each paired install its own bucket,
       * which also caps what a single stolen token can push: 300 requests a
       * minute rather than 300 shared with whatever else that IP is doing.
       */
      const auth = req.headers['authorization'];
      const bearer =
        typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;

      const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies;
      const session = cookies?.['__Host-gs_rt'] ?? cookies?.['gs_rt'];

      // Hashed rather than used raw: both are credentials, and a rate-limit key
      // ends up in memory and in metrics.
      const credential = bearer ?? session;
      return credential === undefined
        ? req.ip
        : createHash('sha256').update(credential).digest('hex');
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
