import { Injectable, Inject, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { Client } from 'pg';
import { AiStreamService } from './ai-stream.service.js';

/**
 * Bringing worker activity onto the admin area's live log.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "add all ingesting and embedding to the live log found on this page please!"
 *
 * The ingests and the embedder run in a container started by cron, which exits when it is done.
 * They cannot reach `AiStreamService` — it is an object in this process. They announce over
 * Postgres `NOTIFY` instead, and this listens and forwards.
 *
 * ★ A DEDICATED CONNECTION, NOT THE PRISMA POOL ★
 *
 * `LISTEN` is a property of a SESSION: the connection that issued it is the one that receives
 * notifications. Prisma hands out pooled connections and takes them back, so a LISTEN issued
 * through it would work until the pool recycled that connection and then silently stop — the worst
 * possible failure for a log, because the page keeps looking fine and simply shows nothing.
 *
 * So this owns one raw client for the lifetime of the process, and nothing else uses it.
 */

/** Must match `JOB_LOG_CHANNEL` in the worker. Two sides, one name. */
const CHANNEL = 'gmsd_job_log';

/** How long to wait before reconnecting after the connection drops. */
const RETRY_MS = 10_000;

@Injectable()
export class JobLogListener implements OnModuleInit, OnModuleDestroy {
  #client: Client | null = null;
  #retry: NodeJS.Timeout | null = null;
  #stopped = false;

  constructor(@Inject(AiStreamService) private readonly stream: AiStreamService) {}

  onModuleInit(): void {
    // Not awaited: the API must boot whether or not this connects. A missing log is a missing log.
    void this.#connect();
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;

    const url = process.env['DATABASE_URL'];
    if (url === undefined || url === '') return;

    const client = new Client({ connectionString: url });
    this.#client = client;

    /*
     * ★ THE ERROR HANDLER IS NOT OPTIONAL ★
     *
     * An unhandled 'error' on a pg Client is an unhandled EventEmitter error, which takes the whole
     * API process down. Postgres restarting — or a network blip — would then be an outage of the
     * website rather than a gap in a log nobody was reading.
     */
    client.on('error', () => {
      this.#schedule();
    });
    client.on('end', () => {
      this.#schedule();
    });

    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || msg.payload === undefined) return;
      try {
        const line = JSON.parse(msg.payload) as {
          level?: unknown;
          kind?: unknown;
          message?: unknown;
          tookMs?: unknown;
        };
        if (typeof line.message !== 'string') return;

        this.stream.emit({
          level: line.level === 'error' || line.level === 'warn' ? line.level : 'info',
          kind: typeof line.kind === 'string' ? line.kind : 'job',
          message: line.message,
          ...(typeof line.tookMs === 'number' ? { tookMs: line.tookMs } : {}),
        });
      } catch {
        // A malformed payload is dropped. It cannot be anything but our own bug, and taking the
        // listener down over one line would lose every line after it.
      }
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      /*
       * Said on the stream itself, so an officer watching an empty log knows the difference between
       * "the workers are quiet" and "nothing is connected". That ambiguity is the reason the log has
       * a heartbeat at all.
       */
      this.stream.emit({
        level: 'info',
        kind: 'health',
        message: 'Listening for ingest and embedding activity',
      });
    } catch {
      this.#schedule();
    }
  }

  /** Reconnects, once, after a delay. Guarded so a flapping connection cannot stack up timers. */
  #schedule(): void {
    if (this.#stopped || this.#retry !== null) return;
    this.#retry = setTimeout(() => {
      this.#retry = null;
      void this.#connect();
    }, RETRY_MS);
    // Never the reason a container will not exit.
    this.#retry.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.#stopped = true;
    if (this.#retry !== null) clearTimeout(this.#retry);
    await this.#client?.end().catch(() => undefined);
  }
}
