import { describe, it, expect, beforeEach } from 'vitest';
import { runWatchPass, pruneOffsets, FIRST_RUN_FILE_LIMIT, type JournalFs } from './watcher.js';
import { DEFAULT_CONFIG, hubKey, type CompanionConfig } from './config.js';
import type { Uploader, UploadResult } from './uploader.js';

/**
 * This hub's reading positions.
 *
 * Offsets became per-DESTINATION on 2026-08-05: an offset says how far a file has been read, and
 * saying nothing about where those lines went is how a development run against localhost silently
 * consumed a member's history and the production hub resumed after it.
 */
function offsetsOf(config: CompanionConfig): Record<string, number> {
  return config.offsetsByHub[hubKey(config.apiBaseUrl)] ?? {};
}


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
    // The uploader measures what it moved, so every result carries these.
    txBytes: 0,
    rxBytes: 0,
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
    expect(offsetsOf(failed.config)[NAME] ?? 0).toBe(0);

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
    expect(offsetsOf(config)[NAME] ?? 0).toBe(0);
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
    expect(offsetsOf(config)[NAME]).toBeGreaterThan(0);
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
    expect(Object.keys(offsetsOf(first.config))).toHaveLength(FIRST_RUN_FILE_LIMIT + 5);

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
    /*
     * `pruneOffsets` works on the FLAT working map the pass builds for one hub, not on the stored
     * per-hub structure — so this constructs that shape directly rather than going through a
     * config, which is also what the function is handed at the call site.
     */
    const working = {
      ...paired({ sessionLive: { a: true, b: false } }),
      offsets: { a: 1, b: 2 },
    };
    const pruned = pruneOffsets(working, ['a']);

    expect(pruned.offsets).toEqual({ a: 1 });
    expect(pruned.sessionLive).toEqual({ a: true });
  });
});

/**
 * History is read and uploaded; it is not "what I am carrying".
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "it seems that it is tracking all the materials i buy and persisting them right now i have 1040
 * tonnes of titanium and its giving me the aggregated total of all the times ive bought it ... its
 * also showing ive sold modular terminals or something and ive never done that!"
 *
 * One fault, two symptoms. Every parsed event was folded into the trip ledger and the carrier
 * hold — including the first-run replay of up to thirty old journal files, and a full re-read of
 * every journal whenever the app is pointed at a different hub. So a whole purchase history piled
 * into one lot, and `lastSale` was whatever that replay happened to end on: a real sale, months
 * old, that nobody remembers making.
 */
describe('the trip ledger ignores replayed history', () => {
  const OLD = '2026-01-02T03:04:05Z';
  const NOW = '2026-07-27T10:30:00Z';
  const WATCHING = Date.parse('2026-07-27T10:00:00Z');

  const buy = (at: string, commodity: string, count: number) =>
    line({
      timestamp: at,
      event: 'MarketBuy',
      Type: commodity.toLowerCase(),
      Type_Localised: commodity,
      Count: count,
      BuyPrice: 1000,
      TotalCost: count * 1000,
    });

  const sell = (at: string, commodity: string, count: number) =>
    line({
      timestamp: at,
      event: 'MarketSell',
      Type: commodity.toLowerCase(),
      Type_Localised: commodity,
      Count: count,
      SellPrice: 100,
      TotalSale: count * 100,
    });

  const watched = (config: CompanionConfig) =>
    runWatchPass(fs, DIR, config, up as unknown as Uploader, null, undefined, undefined, WATCHING);

  it('MANDATORY: an old purchase does not join this session’s lot', async () => {
    fs.files[NAME] = HEADER + LOAD + buy(OLD, 'Titanium', 900) + buy(NOW, 'Titanium', 40);

    const { outcome } = await watched(paired());

    // 40, not 940: the replayed 900 was read and uploaded, and is not aboard.
    expect(outcome.trip.lots['titanium']?.units).toBe(40);
  });

  it('MANDATORY: an old sale is not shown as the last transaction', async () => {
    /*
     * The "modular terminals" complaint exactly: a real sale, months old, surfacing as the receipt
     * on screen because a replay happened to end on it.
     */
    fs.files[NAME] = HEADER + LOAD + sell(OLD, 'Modular Terminals', 12);

    const { outcome } = await watched(paired());

    expect(outcome.trip.lastSale).toBeNull();
  });

  it('a sale made THIS session still shows', async () => {
    fs.files[NAME] = HEADER + LOAD + buy(NOW, 'Titanium', 40) + sell(NOW, 'Titanium', 40);

    const { outcome } = await watched(paired());

    expect(outcome.trip.lastSale?.commodity).toBe('titanium');
    expect(outcome.trip.lastSale?.units).toBe(40);
  });

  it('history is still READ and still uploaded — only the ledger ignores it', async () => {
    /*
     * The point of the replay is the hub. Excluding it from the ledger must not quietly stop it
     * reaching the squadron, which is the failure this would be worth trading for and is not.
     */
    fs.files[NAME] = HEADER + LOAD + buy(OLD, 'Titanium', 900);

    const { outcome } = await watched(paired());

    expect(outcome.sent).toBeGreaterThan(0);
  });

  it('with no boundary given, everything folds — the default the other tests rely on', async () => {
    fs.files[NAME] = HEADER + LOAD + buy(OLD, 'Titanium', 900);

    const { outcome } = await run(paired());

    expect(outcome.trip.lots['titanium']?.units).toBe(900);
  });
});
