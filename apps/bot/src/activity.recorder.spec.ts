import { describe, it, expect, beforeEach } from 'vitest';
import { ActivityRecorder, monthKey } from './activity.recorder.js';
import { InMemoryActivityStore } from './activity.store.fake.js';

/**
 * Phase 1 of rank progression: record who spoke, and when.
 *
 * No promotions happen here. This exists to accumulate a month of real data
 * BEFORE anything acts on it, so the first promotion run can be checked against
 * activity we can verify by eye rather than trusted blind.
 *
 * The month boundary is the whole game. Everything is UTC and everything is
 * pinned to the first of the month, because the promotion engine compares month
 * keys for equality — a row stored a millisecond off is a row that never
 * matches, and a member who is silently never promoted.
 */

const CHANNEL = '801929817149669388';
let store: InMemoryActivityStore;
let rec: ActivityRecorder;

beforeEach(() => {
  store = new InMemoryActivityStore();
  rec = new ActivityRecorder(store, { activityChannelId: CHANNEL });
});

describe('monthKey', () => {
  it('pins any instant to the first of its month, midnight UTC', () => {
    expect(monthKey(new Date('2026-07-27T23:59:59.999Z')).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(monthKey(new Date('2026-07-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
  });

  it('uses UTC, not local time', () => {
    // 23:30 on 31 July in UTC is already 1 August in Sydney. If this used local
    // time, a message would land in whichever month the SERVER happened to be
    // in — and the answer would change if we moved the box to another region.
    expect(monthKey(new Date('2026-07-31T23:30:00.000Z')).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(monthKey(new Date('2026-08-01T00:30:00.000Z')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('handles December to January without rolling the year wrong', () => {
    expect(monthKey(new Date('2026-12-31T22:00:00.000Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    expect(monthKey(new Date('2027-01-01T01:00:00.000Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('recording a message', () => {
  it('creates a row for the member on their first message of the month', async () => {
    await rec.onMessage({
      discordId: '111',
      channelId: CHANNEL,
      at: new Date('2026-07-14T10:00:00.000Z'),
      isBot: false,
    });
    const row = store.find('111', '2026-07-01');
    expect(row?.messageCount).toBe(1);
    expect(row?.firstMessageAt?.toISOString()).toBe('2026-07-14T10:00:00.000Z');
    expect(row?.lastMessageAt?.toISOString()).toBe('2026-07-14T10:00:00.000Z');
  });

  it('increments rather than replacing on later messages', async () => {
    for (const d of ['2026-07-02T09:00:00.000Z', '2026-07-09T12:00:00.000Z', '2026-07-20T18:00:00.000Z']) {
      await rec.onMessage({ discordId: '111', channelId: CHANNEL, at: new Date(d), isBot: false });
    }
    const row = store.find('111', '2026-07-01');
    expect(row?.messageCount).toBe(3);
    // firstMessageAt must NOT drift forward — it is the evidence of when they
    // first appeared that month.
    expect(row?.firstMessageAt?.toISOString()).toBe('2026-07-02T09:00:00.000Z');
    expect(row?.lastMessageAt?.toISOString()).toBe('2026-07-20T18:00:00.000Z');
  });

  it('keeps months separate', async () => {
    await rec.onMessage({ discordId: '111', channelId: CHANNEL, at: new Date('2026-07-31T23:00:00.000Z'), isBot: false });
    await rec.onMessage({ discordId: '111', channelId: CHANNEL, at: new Date('2026-08-01T00:10:00.000Z'), isBot: false });
    expect(store.find('111', '2026-07-01')?.messageCount).toBe(1);
    expect(store.find('111', '2026-08-01')?.messageCount).toBe(1);
    expect(store.rows).toHaveLength(2);
  });

  it('keeps members separate', async () => {
    const at = new Date('2026-07-14T10:00:00.000Z');
    await rec.onMessage({ discordId: '111', channelId: CHANNEL, at, isBot: false });
    await rec.onMessage({ discordId: '222', channelId: CHANNEL, at, isBot: false });
    expect(store.rows).toHaveLength(2);
  });
});

describe('what is ignored', () => {
  it('ignores messages in any other channel', async () => {
    await rec.onMessage({
      discordId: '111',
      channelId: '999999999999999999',
      at: new Date('2026-07-14T10:00:00.000Z'),
      isBot: false,
    });
    expect(store.rows).toHaveLength(0);
  });

  it('ignores bots, including our own', async () => {
    // Otherwise the bot's own notifications would count as squadron activity,
    // and every member would appear active forever.
    await rec.onMessage({
      discordId: '1531031147340103711',
      channelId: CHANNEL,
      at: new Date('2026-07-14T10:00:00.000Z'),
      isBot: true,
    });
    expect(store.rows).toHaveLength(0);
  });

  it('ignores a message with no author id', async () => {
    await rec.onMessage({
      discordId: '',
      channelId: CHANNEL,
      at: new Date('2026-07-14T10:00:00.000Z'),
      isBot: false,
    });
    expect(store.rows).toHaveLength(0);
  });
});

describe('what is NOT stored', () => {
  it('never stores message content, id, or anything but a count and timestamps', async () => {
    await rec.onMessage({
      discordId: '111',
      channelId: CHANNEL,
      at: new Date('2026-07-14T10:00:00.000Z'),
      isBot: false,
    });
    const row = store.find('111', '2026-07-01');
    // The privacy policy says we cannot read messages, and the bot does not
    // hold the Message Content intent — so there is nothing to store even by
    // accident. This asserts the shape stays that way.
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'discordId',
      'firstMessageAt',
      'lastMessageAt',
      'messageCount',
      'month',
    ]);
  });
});

describe('backfill after downtime', () => {
  it('is idempotent — replaying the same message does not double-count', async () => {
    // On restart the bot reads recent channel history to cover the gap. Without
    // dedupe, every restart would inflate everyone's count.
    const msg = {
      discordId: '111',
      channelId: CHANNEL,
      at: new Date('2026-07-14T10:00:00.000Z'),
      isBot: false,
      messageId: 'm-1',
    };
    await rec.onMessage(msg);
    await rec.onMessage(msg);
    await rec.onMessage(msg);
    expect(store.find('111', '2026-07-01')?.messageCount).toBe(1);
  });

  it('still counts genuinely distinct messages', async () => {
    const base = { discordId: '111', channelId: CHANNEL, isBot: false };
    await rec.onMessage({ ...base, at: new Date('2026-07-14T10:00:00.000Z'), messageId: 'm-1' });
    await rec.onMessage({ ...base, at: new Date('2026-07-14T10:05:00.000Z'), messageId: 'm-2' });
    expect(store.find('111', '2026-07-01')?.messageCount).toBe(2);
  });
});
