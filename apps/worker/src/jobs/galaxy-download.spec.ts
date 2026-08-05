import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshGalaxyDump } from './galaxy-download.js';

/**
 * The galaxy dump is 4.26 GB and Spansh rebuilds it once a night.
 *
 * That makes the SKIP path the one that matters: it runs on every check that is not the first after
 * a rebuild, and getting it wrong means downloading four gigabytes every time the job fires rather
 * than once a day. Nothing about that failure is visible from the outside — the data would be
 * perfectly correct, and the only symptom is a bandwidth bill.
 *
 * Everything here is against a stubbed fetch. Pointing a test at the real endpoint would either
 * download the dump or, worse, download it sometimes.
 */

const LAST_MODIFIED = 'Fri, 31 Jul 2026 05:13:00 GMT';
const BODY = 'not really four gigabytes';

let dir: string;
let file: string;

function stubFetch(opts: {
  headOk?: boolean;
  lastModified?: string;
  length?: number;
  body?: string;
  getOk?: boolean;
  throws?: boolean;
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { method?: string }) => {
      if (opts.throws === true) throw new Error('ENOTFOUND');
      // Content-Length follows the body being served unless a test is deliberately lying about it
      // — which the truncation case does, and which caught an earlier version of this stub.
      const headers = new Headers({
        'last-modified': opts.lastModified ?? LAST_MODIFIED,
        'content-length': String(opts.length ?? (opts.body ?? BODY).length),
      });
      if (init?.method === 'HEAD') {
        return new Response(null, { status: opts.headOk === false ? 503 : 200, headers });
      }
      return new Response(opts.getOk === false ? null : (opts.body ?? BODY), {
        status: opts.getOk === false ? 500 : 200,
        headers,
      });
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'galaxy-'));
  file = join(dir, 'galaxy_populated.json.gz');
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe('refreshGalaxyDump', () => {
  it('downloads when there is nothing on disk', async () => {
    stubFetch({});
    const r = await refreshGalaxyDump(file, 'https://example.test/dump.gz');

    expect(r.changed).toBe(true);
    expect(r.available).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(BODY);
  });

  it('MANDATORY: does not download again while upstream is unchanged', async () => {
    stubFetch({});
    await refreshGalaxyDump(file, 'https://example.test/dump.gz');

    const second = await refreshGalaxyDump(file, 'https://example.test/dump.gz');
    expect(second.changed).toBe(false);
    expect(second.available).toBe(true);
    expect(second.skipped).toContain('unchanged');
  });

  it('downloads again once Spansh has rebuilt', async () => {
    stubFetch({});
    await refreshGalaxyDump(file, 'https://example.test/dump.gz');

    stubFetch({ lastModified: 'Sat, 01 Aug 2026 05:13:00 GMT', body: 'a newer dump' });
    const r = await refreshGalaxyDump(file, 'https://example.test/dump.gz');

    expect(r.changed).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('a newer dump');
  });

  it('MANDATORY: refuses a truncated download rather than importing half a galaxy', async () => {
    /*
     * The nastiest failure available here. A short gzip stream parses fine for as far as it goes,
     * so a truncated dump would import most systems, add nothing that came after the cut, and look
     * like a completely successful run. Length is the only thing that catches it.
     */
    stubFetch({ length: 999_999, body: 'short' });
    const r = await refreshGalaxyDump(file, 'https://example.test/dump.gz');

    expect(r.changed).toBe(false);
    expect(r.skipped).toContain('expected');
    expect(existsSync(file)).toBe(false);
    // And no half-written file left where the ingest might find it next time.
    expect(existsSync(`${file}.part`)).toBe(false);
  });

  it('★ MANDATORY: the deadline covers the HEADERS, never the 4 GB body ★', async () => {
    /*
     * ★ THE BUG THIS EXISTS FOR — FOUND 2026-08-04 ★
     *
     * The download was `fetch(url, { signal: AbortSignal.timeout(30_000) })`, under a comment
     * claiming that timeout "covers getting the response; from here the body can legitimately take
     * a long time". It does not. The signal stays armed for the WHOLE request, body included — so
     * thirty seconds in, the transfer aborted however well it was going.
     *
     * The dump is 4.26 GB. It cannot arrive in thirty seconds on any connection the squadron owns,
     * so the nightly job could not succeed EVER, and the idle watchdog beneath it never ran. It
     * failed in the signal's own words — "The operation was aborted due to timeout" — which reads
     * like a network fault and was self-inflicted.
     *
     * ★ WHY THIS TEST USES A REAL SOCKET ★
     *
     * A first attempt used the stubbed fetch above and fake timers, and it passed against the
     * BROKEN code — which makes it worse than no test, because it would have signed off the bug.
     * The semantics that broke this are undici's, and a mocked Response has none of them: nothing
     * about a fake `Response` object is cancelled by an abort.
     *
     * So this serves a real HTTP response that sends headers at once and then dribbles its body out
     * over well past the deadline. Against the old code the request is aborted mid-body; against
     * the fix the idle watchdog sees steady progress and lets it finish.
     */
    const { createServer } = await import('node:http');
    const payload = 'x'.repeat(400);

    const server = createServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'last-modified': LAST_MODIFIED,
          'content-length': String(payload.length),
        });
        res.end();
        return;
      }

      res.writeHead(200, {
        'last-modified': LAST_MODIFIED,
        'content-length': String(payload.length),
      });
      // Flushed at once, because that IS the case under test: headers arrive promptly and the body
      // takes far longer. Node otherwise holds them back until the first write, which would make
      // this a test about slow headers instead.
      res.flushHeaders();

      // Four chunks, 60ms apart — always arriving, and finishing long after a 50ms total deadline.
      let sent = 0;
      const tick = setInterval(() => {
        res.write(payload.slice(sent, sent + 100));
        sent += 100;
        if (sent >= payload.length) {
          clearInterval(tick);
          res.end();
        }
      }, 60);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const result = await refreshGalaxyDump(file, `http://127.0.0.1:${port}/galaxy.json.gz`, {
        // Shorter than the body takes to arrive. The whole point: this must NOT kill the transfer.
        headersTimeoutMs: 50,
        idleTimeoutMs: 2_000,
      });

      expect(result.skipped).toBeNull();
      expect(result.changed).toBe(true);
      expect(readFileSync(file, 'utf8')).toHaveLength(payload.length);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('falls back to the dump we already have when Spansh is unreachable', async () => {
    // A day-old galaxy is enormously better than no galaxy, and systems do not move.
    writeFileSync(file, BODY, 'utf8');
    stubFetch({ throws: true });

    const r = await refreshGalaxyDump(file, 'https://example.test/dump.gz');
    expect(r.changed).toBe(false);
    expect(r.available).toBe(true);
    expect(r.skipped).toContain('could not reach');
  });

  it('reports unavailable when there is no dump AND no upstream', async () => {
    // This is what must reach the training page as a FAILURE — the state where the old code
    // returned silently and left the source reading "Never run" for ever.
    stubFetch({ throws: true });

    const r = await refreshGalaxyDump(file, 'https://example.test/dump.gz');
    expect(r.available).toBe(false);
  });

  it('does not trust a stale meta file over the actual file size', async () => {
    /*
     * An interrupted run can leave a short file beside a meta that claims it is whole. Checking the
     * size on disk — not just the timestamp — is what stops that being believed for ever.
     */
    writeFileSync(file, 'truncated', 'utf8');
    writeFileSync(`${file}.meta`, JSON.stringify({ lastModified: LAST_MODIFIED, bytes: 999_999 }), 'utf8');
    stubFetch({});

    const r = await refreshGalaxyDump(file, 'https://example.test/dump.gz');
    expect(r.changed).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(BODY);
  });

  it('survives an upstream that answers with an error status', async () => {
    stubFetch({ headOk: false });
    const r = await refreshGalaxyDump(file, 'https://example.test/dump.gz');

    expect(r.changed).toBe(false);
    expect(r.skipped).toContain('503');
  });
});
