import { describe, it, expect, vi } from 'vitest';
import {
  DiscordBridge,
  GatedBridgeSender,
  parseChannelMap,
  bridgeMessage,
} from './discord-bridge.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * The Discord thread bridge (P2.8, ADR-006).
 *
 * ★ IT IS BUILT AND IT POSTS NOTHING ★
 *
 * Owner: "Build it, post NOTHING until you approve." So the tests below are about two things — that
 * the bridge does the right thing when enabled, and that it CANNOT post while it is not.
 */

const dec = (v: string) => ({ toFixed: () => v });

function stubDb(over: {
  viewPerm?: string | null;
  categorySlug?: string;
  missing?: boolean;
}): AclBoundClient {
  return {
    forumThread: {
      findFirst: async () =>
        over.missing === true
          ? null
          : {
              title: 'How to join',
              slug: 'how-to-join',
              category: {
                slug: over.categorySlug ?? 'guides',
                viewPerm: over.viewPerm === undefined || over.viewPerm === null ? null : dec(over.viewPerm),
              },
              author: { displayName: 'Pebblemerchant', handle: 'pebble' },
            },
    },
  } as unknown as AclBoundClient;
}

const recorder = (allowed: string[] = [], token: string | undefined = 'token') =>
  new GatedBridgeSender(token, allowed, (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch);

describe('nothing is posted while nothing is configured', () => {
  it('MANDATORY: an absent channel map bridges nothing', () => {
    /*
     * The same ordering as the DM allowlist: default to silence, widen deliberately. Development
     * points at the SAME guild as production, so a default of "send" is one missing environment
     * variable from posting a squadron's board into a channel.
     */
    for (const raw of [undefined, '', '   ', 'garbage', 'guides:', ':123']) {
      expect(parseChannelMap(raw).size, String(raw)).toBe(0);
    }
  });

  it('MANDATORY: a channel not in the map is RECORDED, not posted', async () => {
    const fetchImpl = vi.fn();
    const sender = new GatedBridgeSender('token', [], fetchImpl as unknown as typeof fetch);

    const attempt = await sender.post('999999999999999999', 'hello');

    expect(attempt.sent).toBe(false);
    expect(attempt.suppressedBecause).toMatch(/DISCORD_BRIDGE_CHANNELS/);
    // And no request was made at all — the gate runs before the request is built.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records what it WOULD have said, which is the reviewable evidence', async () => {
    const sender = recorder([]);
    await sender.post('111111111111111111', 'first');
    await sender.post('222222222222222222', 'second');

    expect(sender.attempts().map((a) => a.content)).toEqual(['first', 'second']);
    expect(sender.attempts().every((a) => !a.sent)).toBe(true);
  });

  it('a missing bot token suppresses rather than throwing', async () => {
    /*
     * Constructed DIRECTLY rather than through the `recorder` helper, and that is not style.
     *
     * The helper declares `token: string | undefined = 'token'`, and JavaScript applies a default
     * parameter to an explicit `undefined` — so `recorder([...], undefined)` passed the STRING
     * 'token' and this test asserted the opposite of what it ran. It failed, correctly, and the
     * lesson is that a default parameter cannot express "explicitly absent".
     */
    const sender = new GatedBridgeSender(undefined, ['111111111111111111']);
    const attempt = await sender.post('111111111111111111', 'x');

    expect(attempt.sent).toBe(false);
    expect(attempt.suppressedBecause).toMatch(/token/i);
  });
});

describe('only PUBLIC boards can ever be bridged', () => {
  it('MANDATORY: a gated board is refused even if the map names it', async () => {
    /*
     * ★ THE CHECK THAT OUTRANKS CONFIGURATION ★
     *
     * A bridged announcement carries the thread TITLE into a channel whose membership we do not
     * control. Somebody adding `officers:12345` to the channel map would otherwise publish the
     * officers' board titles — and a configuration mistake must not be able to cause a disclosure.
     */
    const bridge = new DiscordBridge(
      recorder(['111111111111111111']),
      new Map([['officers', '111111111111111111']]),
      'https://example.test',
    );

    const attempt = await bridge.announceThread(
      stubDb({ viewPerm: '16', categorySlug: 'officers' }),
      't1',
    );

    expect(attempt?.sent).toBe(false);
    expect(attempt?.suppressedBecause).toMatch(/not public/);
    // And crucially the CONTENT is empty — the title never even got composed.
    expect(attempt?.content).toBe('');
  });

  it('a public board with a mapped channel posts', async () => {
    const sender = recorder(['111111111111111111']);
    const bridge = new DiscordBridge(
      sender,
      new Map([['guides', '111111111111111111']]),
      'https://example.test',
    );

    const attempt = await bridge.announceThread(stubDb({ viewPerm: null }), 't1');

    expect(attempt?.sent).toBe(true);
    expect(attempt?.content).toContain('How to join');
    expect(attempt?.content).toContain('https://example.test/forum/guides/how-to-join');
  });

  it('an unmapped board returns null rather than an attempt', async () => {
    // The ordinary case. Recording an attempt for every thread on every unbridged board would bury
    // the ones that matter.
    const bridge = new DiscordBridge(recorder([]), new Map(), 'https://example.test');
    expect(await bridge.announceThread(stubDb({ viewPerm: null }), 't1')).toBeNull();
  });

  it('a deleted thread bridges nothing', async () => {
    const bridge = new DiscordBridge(
      recorder(['111111111111111111']),
      new Map([['guides', '111111111111111111']]),
      'https://example.test',
    );
    expect(await bridge.announceThread(stubDb({ missing: true }), 't1')).toBeNull();
  });
});

describe('thread-level only (ADR-006)', () => {
  it('MANDATORY: the message carries a title and a link, never the body', () => {
    /*
     * Posting the body would be the message-level mirror ADR-006 rejected, and it would put member
     * content into a channel with different membership. A title and a link let somebody decide to go
     * and read it, which is the whole value.
     */
    const msg = bridgeMessage({
      categorySlug: 'guides',
      threadTitle: 'How to join',
      threadUrl: 'https://example.test/forum/guides/how-to-join',
      authorDisplayName: 'Pebblemerchant',
    });

    expect(msg).toContain('How to join');
    expect(msg).toContain('https://example.test/forum/guides/how-to-join');
    expect(msg).toContain('Pebblemerchant');
    expect(msg.split('\n')).toHaveLength(3);
  });
});

describe('a thread title cannot ping a server', () => {
  it('MANDATORY: allowed_mentions is empty on every post', async () => {
    /*
     * A member could otherwise write a thread title containing @everyone and alert a hundred people
     * from a forum that has no such capability of its own.
     */
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: { body?: string }) => {
      bodies.push(init?.body === undefined ? null : JSON.parse(init.body));
      return { ok: true, status: 200 } as unknown as Response;
    });

    const sender = new GatedBridgeSender('token', ['111111111111111111'], fetchImpl as unknown as typeof fetch);
    await sender.post('111111111111111111', '@everyone read this');

    expect(bodies[0]).toMatchObject({ allowed_mentions: { parse: [] } });
  });
});

describe('parseChannelMap', () => {
  it('reads slug:channel pairs and ignores malformed ones', () => {
    const map = parseChannelMap('guides:111111111111111111, general:222222222222222222, bad:notanid, :333');

    expect([...map.entries()]).toEqual([
      ['guides', '111111111111111111'],
      ['general', '222222222222222222'],
    ]);
  });
});

describe('a bridge failure does not fail the thread', () => {
  it('MANDATORY: an unreachable Discord is recorded, not thrown', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    const sender = new GatedBridgeSender('token', ['111111111111111111'], fetchImpl as unknown as typeof fetch);

    const attempt = await sender.post('111111111111111111', 'x');
    expect(attempt.sent).toBe(false);
    expect(attempt.suppressedBecause).toMatch(/unreachable/i);
  });
});
