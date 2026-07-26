import { describe, it, expect, vi } from 'vitest';
import { HealthService, type DependencyProbe } from './health.service.js';

/**
 * P0.4 — health endpoint semantics.
 *
 * The rule that matters: a dependency being down must NEVER produce a 500.
 * `/v1/health` is what monitoring polls, and an endpoint that 500s when Redis
 * blips takes the page down with a cache and tells the operator nothing
 * (ssot/04-contracts/errors.md § Health endpoint semantics).
 */

const ok = (name: string): DependencyProbe => ({
  name,
  critical: name === 'db',
  check: async () => ({ status: 'ok' as const, latencyMs: 1 }),
});

const down = (name: string, critical: boolean): DependencyProbe => ({
  name,
  critical,
  check: async () => {
    throw new Error('connection refused');
  },
});

describe('HealthService', () => {
  it('reports ok when every dependency is healthy', async () => {
    const svc = new HealthService([ok('db'), ok('redis'), ok('meilisearch')], '1.0.0');
    const r = await svc.check();
    expect(r.status).toBe('ok');
    expect(r.httpStatus).toBe(200);
    expect(Object.keys(r.checks).sort()).toEqual(['db', 'meilisearch', 'redis']);
  });

  it('reports DEGRADED with HTTP 200 when a non-critical dependency is down', async () => {
    // Killing redis must not take the health endpoint down with it.
    const svc = new HealthService([ok('db'), down('redis', false), ok('meilisearch')], '1.0.0');
    const r = await svc.check();
    expect(r.status).toBe('degraded');
    expect(r.httpStatus).toBe(200);
    expect(r.checks['redis']?.status).toBe('down');
    expect(r.checks['db']?.status).toBe('ok');
  });

  it('reports DOWN with HTTP 503 only when a critical dependency is unreachable', async () => {
    const svc = new HealthService([down('db', true), ok('redis')], '1.0.0');
    const r = await svc.check();
    expect(r.status).toBe('down');
    expect(r.httpStatus).toBe(503);
  });

  it('never throws, whatever a probe does', async () => {
    const exploding: DependencyProbe = {
      name: 'meilisearch',
      critical: false,
      check: () => {
        throw new Error('synchronous explosion');
      },
    };
    const svc = new HealthService([ok('db'), exploding], '1.0.0');
    await expect(svc.check()).resolves.toBeDefined();
  });

  it('bounds a hanging probe rather than hanging the endpoint', async () => {
    vi.useFakeTimers();
    const hanging: DependencyProbe = {
      name: 'redis',
      critical: false,
      check: () => new Promise(() => {}),
    };
    const svc = new HealthService([ok('db'), hanging], '1.0.0', 100);
    const p = svc.check();
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;
    vi.useRealTimers();
    expect(r.status).toBe('degraded');
    expect(r.checks['redis']?.status).toBe('down');
    expect(r.checks['redis']?.error).toMatch(/timed out/i);
  });

  it('never leaks an internal detail into the error field', async () => {
    const leaky: DependencyProbe = {
      name: 'redis',
      critical: false,
      check: async () => {
        throw new Error(
          'connect ECONNREFUSED 10.44.0.2:6379 at /srv/grims/node_modules/ioredis/index.js:412',
        );
      },
    };
    const svc = new HealthService([ok('db'), leaky], '1.0.0');
    const r = await svc.check();
    const err = r.checks['redis']?.error ?? '';
    // No internal IPs, no filesystem paths, no stack frames.
    expect(err).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(err).not.toMatch(/node_modules|\/srv\//);
    expect(err).not.toMatch(/\bat\s+\//);
  });

  it('reports the version so a deploy can be confirmed', async () => {
    const svc = new HealthService([ok('db')], '1.4.2');
    expect((await svc.check()).version).toBe('1.4.2');
  });
});
