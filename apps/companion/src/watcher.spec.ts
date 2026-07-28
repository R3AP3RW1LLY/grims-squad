import { describe, it, expect, beforeEach } from 'vitest';
import { runWatchPass, pruneOffsets, FIRST_RUN_FILE_LIMIT, type JournalFs } from './watcher.js';
import { DEFAULT_CONFIG, type CompanionConfig } from './config.js';
import type { Uploader, UploadResult } from './uploader.js';

/**
 * The watch loop.
 *
 * ★ THE PROPERTY EVERYTHING ELSE DEPENDS ON ★
 *
 * An offset advances only after a SUCCESSFUL send. Get that wrong and a failed
 * upload becomes a silent permanent loss, with nobody able to tell which events
 * went missing — the worst possible failure for a system whose whole job is
 * proving a member played.
 */

const DIR = '/journals';

class FakeFs implements JournalFs {
  files: Record<string, string> = {};

  async listFiles(): Promise<string[]> {
    return Object.keys(this.files);
  }
  async readFrom(path: string, offset: number): Promise<string> {
    const name = path.slice(DIR.length + 1);
    const content = this.files[name];
    if (content === undefined) throw new Error('no such file');
    return Buffer.from(content, 'utf8').subarray(offset).toString('utf8');
  }
  async sizeOf(path: string): Promise<number> {
    const name = path.slice(DIR.length + 1);
    const content = this.files[name];
    if (content === undefined) throw new Error('no such file');
    return Buffer.byteLength(content, 'utf8');
  }
}

class FakeUploader {
  batches: number[] = [];
  result: UploadResult = {
    ok: true,
    accepted: 0,
    duplicates: 0,
    unauthorised: false,
    refused: {},
    error: null,
  };

  async send(events: readonly unknown[]): Promise<UploadResult> {
    this.batches.push(events.length);
    return { ...this.result, accepted: this.result.ok ? events.length : 0 };
  }
}

const line = (o: Record<string, unknown>) => `${JSON.stringify(o)}\n`;
const HEADER = line({ event: 'Fileheader', timestamp: '2026-07-27T10:00:00Z', gameversion: '4.0.0.1904' });
const LOAD = line({ event: 'LoadGame', timestamp: '2026-07-27T10:00:01Z', Commander: 'GRIM' });

const NAME = 'Journal.2026-07-27T100000.01.log';

const paired = (over: Partial<CompanionConfig> = {}): CompanionConfig => ({
  ...DEFAULT_CONFIG,
  deviceToken: 'gsq_test',
  enabled: true,
  ...over,
});

let fs: FakeFs;
let up: FakeUploader;

beforeEach(() => {
  fs = new FakeFs();
  up = new FakeUploader();
});

const run = (config: CompanionConfig) =>
  runWatchPass(fs, DIR, config, up as unknown as Uploader);

describe('sending', () => {
  it('reads a journal and sends what it finds', async () => {
    fs.files[NAME] = HEADER + LOAD;
    const { outcome } = await run(paired());

    expect(outcome.sent).toBe(1);
    expect(outcome.error).toBeNull();
  });

  it('MANDATORY: sends nothing until the member turns it on', async () => {
    // Being installed is not consent. The app ships disabled and waits.
    fs.files[NAME] = HEADER + LOAD;
    const { outcome } = await run(paired({ enabled: false }));

    expect(up.batches).toEqual([]);
    expect(outcome.sent).toBe(0);
  });

  it('MANDATORY: sends nothing when no device is paired', async () => {
    fs.files[NAME] = HEADER + LOAD;
    await run(paired({ deviceToken: '' }));
    expect(up.batches).toEqual([]);
  });

  it('does not re-send what it has already sent', async () => {
    fs.files[NAME] = HEADER + LOAD;
    const first = await run(paired());
    const second = await run(first.config);

    expect(second.outcome.sent).toBe(0);
    expect(up.batches).toHaveLength(1);
  });

  it('sends only the NEW lines when a file grows', async () => {
    fs.files[NAME] = HEADER + LOAD;
    const first = await run(paired());

    fs.files[NAME] += line({ event: 'Rank', timestamp: '2026-07-27T10:05:00Z', Combat: 7 });
    const second = await run(first.config);

    expect(second.outcome.sent).toBe(1);
  });
});

describe('failure never loses events', () => {
  it('MANDATORY: does not advance the offset when the send fails', async () => {
    /*
     * The property everything else depends on. A failed send must leave the
     * offset alone so the events are read again next pass — the hub dedupes
     * them. Advancing first would make an outage a permanent, invisible loss.
     */
    fs.files[NAME] = HEADER + LOAD;
    up.result = { ...up.result, ok: false, error: 'Could not reach the hub.' };

    const failed = await run(paired());
    expect(failed.outcome.error).toBe('Could not reach the hub.');
    expect(failed.config.offsets[NAME] ?? 0).toBe(0);

    up.result = { ...up.result, ok: true, error: null };
    const retried = await run(failed.config);
    expect(retried.outcome.sent).toBe(1);
  });

  it('MANDATORY: stops and reports when the token has been revoked', async () => {
    /*
     * Distinguished from an outage because the responses differ: an outage
     * clears by itself and this never will. Retrying forever would hammer the
     * server and leave the member wondering why nothing updates.
     */
    fs.files[NAME] = HEADER + LOAD;
    up.result = { ...up.result, ok: false, unauthorised: true, error: 'no longer paired' };

    const { outcome, config } = await run(paired());
    expect(outcome.unauthorised).toBe(true);
    expect(config.offsets[NAME] ?? 0).toBe(0);
  });

  it('stops at the first failure rather than trying every file', async () => {
    // If the network is gone it is gone for all of them, and marching through
    // the list just makes the member wait.
    fs.files['Journal.2026-07-01T100000.01.log'] = HEADER + LOAD;
    fs.files['Journal.2026-07-02T100000.01.log'] = HEADER + LOAD;
    up.result = { ...up.result, ok: false, error: 'offline' };

    await run(paired());
    expect(up.batches).toHaveLength(1);
  });
});

describe('a file that changes shape', () => {
  it('MANDATORY: starts over when a file SHRANK', async () => {
    /*
     * Replaced, truncated, or restored from a backup. Whatever the cause, the
     * saved offset points into a file that no longer exists in that shape, and
     * reading from it would slice mid-line and produce garbage.
     */
    fs.files[NAME] = HEADER + LOAD + line({ event: 'Rank', timestamp: '2026-07-27T10:02:00Z', Combat: 7 });
    const first = await run(paired());
    expect(first.outcome.sent).toBe(2);

    fs.files[NAME] = HEADER + LOAD;
    const second = await run(first.config);

    expect(second.outcome.sent).toBe(1);
  });

  it('MANDATORY: forgets the Legacy verdict when a file is replaced', async () => {
    // Otherwise a new Live journal written to a recycled filename would inherit
    // "this is Legacy" and be silently discarded for as long as it existed.
    const legacyHeader = line({
      event: 'Fileheader',
      timestamp: '2026-07-27T09:00:00Z',
      gameversion: '3.8.0.407',
    });
    fs.files[NAME] = legacyHeader + LOAD + LOAD;
    const first = await run(paired());
    expect(first.outcome.sent).toBe(0);
    expect(first.config.sessionLive[NAME]).toBe(false);

    fs.files[NAME] = HEADER + LOAD;
    const second = await run(first.config);
    expect(second.outcome.sent).toBe(1);
  });

  it('advances past a chunk with nothing worth sending', async () => {
    // Those bytes have been read. Re-reading them next pass is work with no
    // possible outcome.
    fs.files[NAME] = HEADER + line({ event: 'ReceiveText', timestamp: '2026-07-27T10:00:02Z', Message: 'hi' });
    const { config, outcome } = await run(paired());

    expect(outcome.sent).toBe(0);
    expect(config.offsets[NAME]).toBeGreaterThan(0);
  });
});

describe('the first run', () => {
  it('MANDATORY: does not upload a decade of history', async () => {
    /*
     * A member who has played since 2015 has thousands of files. Uploading all
     * of them would spend an hour answering a question nobody asked —
     * promotions look at THIS month.
     */
    for (let i = 0; i < FIRST_RUN_FILE_LIMIT + 20; i += 1) {
      const day = String((i % 28) + 1).padStart(2, '0');
      fs.files[`Journal.2026-01-${day}T1000${String(i).padStart(2, '0')}.01.log`] = HEADER + LOAD;
    }

    const { outcome } = await run(paired());
    expect(outcome.filesRead).toBe(FIRST_RUN_FILE_LIMIT);
  });

  it('MANDATORY: marks the skipped files as read, so it is a FIRST run only once', async () => {
    /*
     * Without this the next pass sees no offsets, calls itself a first run
     * again, and re-reads the same window forever — the skipped files would
     * never be skipped, they would just never be reached.
     */
    for (let i = 0; i < FIRST_RUN_FILE_LIMIT + 5; i += 1) {
      const day = String((i % 28) + 1).padStart(2, '0');
      fs.files[`Journal.2026-01-${day}T1000${String(i).padStart(2, '0')}.01.log`] = HEADER + LOAD;
    }

    const first = await run(paired());
    expect(Object.keys(first.config.offsets)).toHaveLength(FIRST_RUN_FILE_LIMIT + 5);

    const second = await run(first.config);
    expect(second.outcome.filesRead).toBe(0);
  });
});

describe('refused categories are carried back to the member', () => {
  it('MANDATORY: reports what the hub would not accept', async () => {
    // A member who has not opted into a category is entitled to be told their
    // events are being dropped, rather than watching an app that looks like it
    // is working and a website that never updates.
    fs.files[NAME] = HEADER + LOAD;
    up.result = { ...up.result, refused: { profile: 3 } };

    const { outcome } = await run(paired());
    expect(outcome.refused).toEqual({ profile: 3 });
  });
});

describe('pruneOffsets', () => {
  it('forgets files that are gone', () => {
    // Journals accumulate for years and members delete them. Without this the
    // config grows without limit.
    const config = paired({
      offsets: { a: 1, b: 2 },
      sessionLive: { a: true, b: false },
    });
    const pruned = pruneOffsets(config, ['a']);

    expect(pruned.offsets).toEqual({ a: 1 });
    expect(pruned.sessionLive).toEqual({ a: true });
  });
});
