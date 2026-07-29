import { describe, it, expect } from 'vitest';
import {
  countsTowardActivity,
  isForumChannel,
  CHANNEL_TYPE,
  type ScopeChannel,
  type ScopeRole,
} from './channel-scope.js';

/**
 * Which channels count toward activity.
 *
 * ★ THE BUG THESE EXIST BECAUSE OF ★
 *
 * Messages were counted in ONE nominated channel and voice in a hand-written
 * list of ids. So the admin console showed 0 / 0 / 0 for a member who had been
 * talking all month and sitting in voice constantly, and it read as a broken
 * bot rather than as a bot doing exactly what it was configured to do.
 *
 * The rule, from the squadron owner: anything not admin-gated and not an
 * announcement channel counts, NSFW included.
 */

const EVERYONE: ScopeRole = { id: 'everyone', isPrivileged: false };
const MEMBER: ScopeRole = { id: 'members', isPrivileged: false };
const MINERS: ScopeRole = { id: 'miners', isPrivileged: false };
const ADMIN: ScopeRole = { id: 'admin', isPrivileged: true };
const MOD: ScopeRole = { id: 'mod', isPrivileged: true };

const ROLES = [EVERYONE, MEMBER, MINERS, ADMIN, MOD];

const chan = (over: Partial<ScopeChannel> = {}): ScopeChannel => ({
  id: 'c1',
  type: CHANNEL_TYPE.GuildText,
  viewerRoleIds: ['everyone', 'members', 'admin'],
  ...over,
});

describe('countsTowardActivity', () => {
  it('MANDATORY: counts an ordinary text channel', () => {
    expect(countsTowardActivity(chan(), ROLES)).toBe(true);
  });

  it('MANDATORY: counts a channel gated behind an INTEREST role', () => {
    /*
     * ★ THE ONE A NAIVE RULE GETS WRONG ★
     *
     * The squadron gates channels behind Miners, Explorers, Anti-Xeno and so
     * on. Those are ordinary members talking. A rule of "@everyone must be able
     * to view it" reads as perfectly reasonable and would silently throw away
     * most of the server's real conversation.
     */
    expect(countsTowardActivity(chan({ viewerRoleIds: ['miners', 'admin'] }), ROLES)).toBe(true);
  });

  it('MANDATORY: does NOT count a channel only staff can see', () => {
    // Admin-gated means exactly this: every role that can view it is staff.
    expect(countsTowardActivity(chan({ viewerRoleIds: ['admin', 'mod'] }), ROLES)).toBe(false);
  });

  it('MANDATORY: does not count announcement channels', () => {
    /*
     * Readable by everyone, postable only by staff. Counting them would award
     * activity to the handful of people who write announcements and nothing to
     * anybody else — the opposite of measuring participation.
     */
    expect(countsTowardActivity(chan({ type: CHANNEL_TYPE.GuildAnnouncement }), ROLES)).toBe(false);
  });

  it('does not count a thread under an announcement channel', () => {
    const t = chan({ type: CHANNEL_TYPE.PublicThread, parentType: CHANNEL_TYPE.GuildAnnouncement });
    expect(countsTowardActivity(t, ROLES)).toBe(false);
  });

  it('MANDATORY: counts NSFW channels, on explicit instruction', () => {
    // NSFW is a content warning, not a permission. Members talking there are
    // members talking, and the rule does not consult it at all.
    expect(countsTowardActivity(chan(), ROLES)).toBe(true);
  });

  it('counts voice, forum, media and threads', () => {
    for (const type of [
      CHANNEL_TYPE.GuildVoice,
      CHANNEL_TYPE.GuildForum,
      CHANNEL_TYPE.GuildMedia,
      CHANNEL_TYPE.PublicThread,
      CHANNEL_TYPE.PrivateThread,
    ]) {
      expect(countsTowardActivity(chan({ type }), ROLES), `type ${type}`).toBe(true);
    }
  });

  it('does not count stage channels', () => {
    // Two hundred listeners and three speakers is not two hundred people taking
    // part in a conversation.
    expect(countsTowardActivity(chan({ type: CHANNEL_TYPE.GuildStageVoice }), ROLES)).toBe(false);
  });

  it('MANDATORY: refuses when the viewer list is empty', () => {
    /*
     * Either a genuinely locked channel or a permission resolution that failed.
     * Counting on a failed read would quietly inflate everybody's activity, and
     * that is unfalsifiable afterwards — nothing records why a message counted.
     */
    expect(countsTowardActivity(chan({ viewerRoleIds: [] }), ROLES)).toBe(false);
  });

  it('treats an unknown role as ordinary, not as staff', () => {
    // A role created since the cache was loaded. Erring toward counting is
    // right here: the alternative silently stops recording a whole channel
    // because somebody added a colour role.
    expect(countsTowardActivity(chan({ viewerRoleIds: ['brand-new'] }), ROLES)).toBe(true);
  });
});

describe('isForumChannel', () => {
  it('recognises a forum and a thread beneath one', () => {
    // A forum post and its replies are messages inside a thread whose parent is
    // the forum. There is no separate "commented on a forum post" event.
    expect(isForumChannel(chan({ type: CHANNEL_TYPE.GuildForum }))).toBe(true);
    expect(
      isForumChannel(chan({ type: CHANNEL_TYPE.PublicThread, parentType: CHANNEL_TYPE.GuildForum })),
    ).toBe(true);
  });

  it('does not mistake an ordinary channel for a forum', () => {
    expect(isForumChannel(chan())).toBe(false);
  });
});
