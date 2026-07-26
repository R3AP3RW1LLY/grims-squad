import type { HealthCheck } from '@grims/shared';

/**
 * A dependency the API can probe.
 *
 * `critical` decides the difference between DEGRADED and DOWN, and therefore
 * between HTTP 200 and 503. Only Postgres is critical: without it nothing works.
 * Redis, Meilisearch and (later) GSAI all have degraded paths.
 */
export interface DependencyProbe {
  readonly name: string;
  readonly critical: boolean;
  check(): Promise<{ status: 'ok'; latencyMs: number }>;
}

export interface HealthResult {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  checks: Record<string, HealthCheck>;
  /** 200 for ok AND degraded. 503 only when a critical dependency is unreachable. */
  httpStatus: 200 | 503;
}

const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * Strip anything that would leak infrastructure detail into a public response.
 * A health endpoint is unauthenticated in most deployments, so its error strings
 * are effectively public (ssot/04-contracts/errors.md).
 */
function safeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw
      // internal addresses
      .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '<addr>')
      // filesystem paths, POSIX and Windows
      .replace(/(?:[A-Za-z]:)?[\\/][\w.\-\\/]+/g, '<path>')
      // stack frames
      .replace(/\s+at\s+.*$/gm, '')
      // Collapse whitespace. Prisma in particular emits multi-line messages, and
      // a health payload should be one readable line per check.
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'unavailable'
  );
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class HealthService {
  constructor(
    private readonly probes: readonly DependencyProbe[],
    private readonly version: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Probe every dependency. NEVER throws, and never returns 500 for a
   * dependency failure — monitoring depends on this endpoint answering.
   */
  async check(): Promise<HealthResult> {
    const results = await Promise.all(
      this.probes.map(async (probe) => {
        try {
          // The probe itself may throw synchronously, so wrap the call too.
          const r = await withTimeout(
            (async () => probe.check())(),
            this.timeoutMs,
          );
          return [probe, { status: 'ok', latencyMs: r.latencyMs } satisfies HealthCheck] as const;
        } catch (err) {
          return [
            probe,
            { status: 'down', error: safeError(err) } satisfies HealthCheck,
          ] as const;
        }
      }),
    );

    const checks: Record<string, HealthCheck> = {};
    let criticalDown = false;
    let anyDown = false;

    for (const [probe, result] of results) {
      checks[probe.name] = result;
      if (result.status !== 'ok') {
        anyDown = true;
        if (probe.critical) criticalDown = true;
      }
    }

    const status = criticalDown ? 'down' : anyDown ? 'degraded' : 'ok';

    return {
      status,
      version: this.version,
      checks,
      httpStatus: status === 'down' ? 503 : 200,
    };
  }
}
