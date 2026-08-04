import type { PrismaClient } from '@grims/db';
import { Logger } from '@nestjs/common';
import type { ObjectStore, StoredObject } from './object-store.js';

/**
 * An object store that says so when it breaks.
 *
 * ★ FOUND THE HARD WAY, 2026-08-04 ★
 *
 * The Vultr object storage account went into UserSuspended, every avatar and upload on the site
 * became a broken image — and nothing anywhere said a word, because every read path politely
 * `catch(() => null)`s storage errors into "no such object". The owner found out by looking at
 * broken pictures. That is the exact failure mode the ops-alert pipeline was built for the same
 * night: infrastructure dying silently while every page stays superficially fine.
 *
 * The wrapper rethrows everything — behaviour is unchanged for callers — and writes one
 * `ops_alerts` row per incident (6-hour dedupe, recovery row on the first success after failures),
 * which the bot delivers as a DM. The insert itself is best-effort: an alert about storage being
 * down must never make storage look MORE down.
 */
export class MonitoredObjectStore implements ObjectStore {
  #failing = false;
  readonly #log = new Logger('ObjectStore');

  constructor(
    private readonly inner: ObjectStore,
    private readonly db: PrismaClient,
  ) {}

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    return this.#watch('put', () => this.inner.put(key, body, contentType));
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.#watch('get', () => this.inner.get(key));
  }

  async delete(key: string): Promise<void> {
    return this.#watch('delete', () => this.inner.delete(key));
  }

  async #watch<T>(op: string, run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      if (this.#failing) {
        this.#failing = false;
        await this.#alert('media-store-recovered', 'Object storage is answering again.');
      }
      return result;
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      this.#log.error(`object store ${op} failed — ${detail}`);
      if (!this.#failing) {
        this.#failing = true;
        await this.#alert(
          'media-store-failing',
          `Object storage is failing (${detail} on ${op}). Every avatar and uploaded image on ` +
            `the site is broken until this is fixed — if the error says UserSuspended, that is ` +
            `the Vultr ACCOUNT, not the code.`,
        );
      }
      throw error;
    }
  }

  async #alert(kind: string, message: string): Promise<void> {
    try {
      const [recent] = await this.db.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM ops_alerts
          WHERE kind = $1 AND created_at > now() - interval '6 hours'`,
        kind,
      );
      if ((recent?.n ?? 0) > 0) return;
      await this.db.$executeRawUnsafe(
        `INSERT INTO ops_alerts (kind, message) VALUES ($1, $2)`,
        kind,
        message,
      );
    } catch {
      // The log line above already recorded the real failure.
    }
  }
}
