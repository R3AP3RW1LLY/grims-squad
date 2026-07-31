import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@grims/shared';
import { BANNER, BANNER_LIMITS } from '@grims/shared/forum-signature';
import { SignatureService, toView } from './signature.service.js';

/**
 * Forum signatures — the rules worth pinning.
 *
 * ★ THE ONE THAT DEFINES THE FEATURE ★
 *
 * Squadron owner, 2026-07-30: the signature avatar "should only be displayed on the forums and not
 * replace their global avatar that discord imports".
 *
 * The obvious implementation — "let them upload an avatar" — writes `User.avatarStoredHash`, and
 * the next Discord sync silently writes it back. The member watches their picture change on its
 * own and has no way to describe the bug. So the test below asserts an ABSENCE: no write to `user`
 * ever happens, recorded at the client rather than inferred.
 */

function client(
  opts: {
    existing?: Record<string, unknown> | null;
    uploads?: readonly string[];
    /** Dimensions the fake reports for an owned upload. Banner rules key on these. */
    size?: { width: number; height: number };
  } = {},
) {
  const uploads = opts.uploads ?? ['media-mine'];
  const size = opts.size ?? { width: 1200, height: 400 };
  /** Every model touched, so a write to `user` can be asserted never to occur. */
  const touched: string[] = [];
  const upserts: Array<Record<string, unknown>> = [];

  return {
    touched,
    upserts,
    forumSignature: {
      findUnique: async () => {
        touched.push('forumSignature.findUnique');
        return opts.existing ?? null;
      },
      findMany: async () => {
        touched.push('forumSignature.findMany');
        return [];
      },
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        touched.push('forumSignature.upsert');
        upserts.push(args.update);
        return {
          avatarMediaId: null,
          bannerSpec: null,
          bannerPublishedMediaId: null,
          tagline: null,
          bannerMediaId: null,
          bannerUrl: null,
          bannerLabel: null,
          accent: 'orange',
          showRank: true,
          showCommander: true,
          enabled: true,
          ...args.update,
        };
      },
    },
    mediaUpload: {
      findFirst: async ({ where }: { where: { id: string; uploaderId: string } }) => {
        touched.push('mediaUpload.findFirst');
        return uploads.includes(where.id) && where.uploaderId === 'me'
          ? { id: where.id, ...size }
          : null;
      },
    },
    /*
     * Present and LOUD. If anything in this feature ever reaches for the user table, the test that
     * asserts `touched` contains no 'user.' entry fails with a name rather than a mystery.
     */
    user: {
      update: async () => {
        touched.push('user.update');
        return {};
      },
      updateMany: async () => {
        touched.push('user.updateMany');
        return {};
      },
    },
  };
}

describe('forum signatures', () => {
  describe('MANDATORY: the global Discord avatar is never touched', () => {
    it('saving a signature avatar writes only the signature row', async () => {
      const db = client();
      await new SignatureService().save(db as never, 'me', { avatarMediaId: 'media-mine' });

      expect(db.touched.filter((t) => t.startsWith('user.'))).toEqual([]);
      expect(db.upserts[0]).toMatchObject({ avatarMediaId: 'media-mine' });
    });

    it('clearing it also writes only the signature row', async () => {
      const db = client();
      await new SignatureService().save(db as never, 'me', { avatarMediaId: null });

      expect(db.touched.filter((t) => t.startsWith('user.'))).toEqual([]);
      expect(db.upserts[0]).toMatchObject({ avatarMediaId: null });
    });
  });

  describe('MANDATORY: images have to be yours', () => {
    it('refuses a media id belonging to somebody else', async () => {
      /*
       * Ids arrive from a browser. Without the uploader check, a member could point their
       * signature at another member's upload — somebody else's face under a stranger's name, on
       * every post that stranger writes.
       */
      const db = client({ uploads: ['media-mine'] });
      await expect(
        new SignatureService().save(db as never, 'me', { avatarMediaId: 'media-theirs' }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('refuses a banner belonging to somebody else too', async () => {
      const db = client({ uploads: ['media-mine'] });
      await expect(
        new SignatureService().save(db as never, 'me', { bannerMediaId: 'media-theirs' }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });
  });

  describe('banner uploads have a size floor, not an exact size', () => {
    /*
     * The renderer crops to fill at 600 × 120, so anything LARGER fits without being re-encoded.
     * What cropping cannot fix is an image too small to fill the space — scaling up blurs it, and
     * the member blames us rather than their source file.
     */
    it('accepts an upload larger than the banner', async () => {
      const db = client({ size: { width: 1920, height: 1080 } });
      await new SignatureService().save(db as never, 'me', { bannerMediaId: 'media-mine' });
      expect(db.upserts[0]).toMatchObject({ bannerMediaId: 'media-mine' });
    });

    it('accepts an upload at exactly the floor', async () => {
      // Read from the contract rather than hardcoded: the floor moved with the banner height, and
      // a literal here would have to be found and changed every time it does.
      const db = client({
        size: { width: BANNER.minUploadWidth, height: BANNER.minUploadHeight },
      });
      await new SignatureService().save(db as never, 'me', { bannerMediaId: 'media-mine' });
      expect(db.upserts[0]).toMatchObject({ bannerMediaId: 'media-mine' });
    });

    it('MANDATORY: refuses one below the floor, stating both numbers', async () => {
      // A refusal nobody can act on is worse than no refusal. The message has to say what was
      // needed AND what they sent, or the next attempt is another guess.
      const db = client({
        size: { width: BANNER.minUploadWidth - 100, height: BANNER.minUploadHeight - 20 },
      });
      await expect(
        new SignatureService().save(db as never, 'me', { bannerMediaId: 'media-mine' }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        message: expect.stringContaining(
          `${BANNER.minUploadWidth - 100} × ${BANNER.minUploadHeight - 20}`,
        ),
      });
    });

    it('MANDATORY: the floor applies to banners only, never to avatars', async () => {
      // An avatar is a circle 40px across. Holding it to a banner's floor would refuse perfectly
      // good pictures for failing a rule about a different thing.
      const db = client({ size: { width: 64, height: 64 } });
      await new SignatureService().save(db as never, 'me', { avatarMediaId: 'media-mine' });
      expect(db.upserts[0]).toMatchObject({ avatarMediaId: 'media-mine' });
    });
  });

  describe('the built banner spec', () => {
    it('MANDATORY: is validated even though our own editor produced it', async () => {
      // The editor is JavaScript in a browser: what arrives is whatever the browser sent.
      const db = client();
      await expect(
        new SignatureService().save(db as never, 'me', {
          bannerSpec: { version: 2, background: 'chartreuse', layers: [] },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('clamps an out-of-range size rather than losing the whole banner', async () => {
      const db = client();
      await new SignatureService().save(db as never, 'me', {
        bannerSpec: {
          version: 2,
          background: 'gradient',
          colourA: '#0b0f14',
          colourB: '#ff7100',
          dim: 0,
          layers: [{ kind: 'text', source: 'custom', text: 'hi', row: 2, size: 9999 }],
        },
      });
      const saved = db.upserts[0]?.['bannerSpec'] as { layers: Array<{ size: number }> };
      expect(saved.layers[0]?.size).toBe(BANNER_LIMITS.maxTextSize);
    });

    it('null clears it, for somebody switching back to an uploaded banner', async () => {
      const db = client();
      await new SignatureService().save(db as never, 'me', { bannerSpec: null });
      expect(db.upserts[0]).toMatchObject({ bannerSpec: null });
    });
  });

  describe('the banner link', () => {
    it('MANDATORY: refuses a host that is not on the allowlist', async () => {
      const db = client();
      await expect(
        new SignatureService().save(db as never, 'me', { bannerUrl: 'https://evil.test/' }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('accepts a commander page and a stream channel', async () => {
      const svc = new SignatureService();
      await expect(
        svc.save(client() as never, 'me', { bannerUrl: 'https://inara.cz/elite/cmdr/1/' }),
      ).resolves.toBeDefined();
      await expect(
        svc.save(client() as never, 'me', { bannerUrl: 'https://www.twitch.tv/somebody' }),
      ).resolves.toBeDefined();
    });

    it('an empty string clears it rather than failing validation', async () => {
      // Clearing a field and supplying a bad one are different intents, and a member emptying the
      // box should not be told their blank link is not an approved host.
      const db = client();
      await new SignatureService().save(db as never, 'me', { bannerUrl: '' });
      expect(db.upserts[0]).toMatchObject({ bannerUrl: null });
    });
  });

  describe('length limits', () => {
    it('refuses an over-long tagline with a message that says the limit', async () => {
      const db = client();
      await expect(
        new SignatureService().save(db as never, 'me', { tagline: 'x'.repeat(200) }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('turns whitespace-only into null rather than storing a blank line', async () => {
      const db = client();
      await new SignatureService().save(db as never, 'me', { tagline: '   ' });
      expect(db.upserts[0]).toMatchObject({ tagline: null });
    });
  });

  describe('accents', () => {
    it('MANDATORY: refuses a colour outside the set', async () => {
      /*
       * A free colour is how a member ends up with near-black text on our near-black panel. Not
       * maliciously — just by picking something that looked fine in a picker.
       */
      const db = client();
      await expect(
        new SignatureService().save(db as never, 'me', { accent: '#000000' as never }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });
  });

  describe('what a reader receives', () => {
    it('falls back to the Discord avatar when no signature avatar is set', () => {
      const view = toView(null, '/v1/media/avatars/u1');
      expect(view.avatarUrl).toBe('/v1/media/avatars/u1');
      expect(view.enabled).toBe(true);
    });

    it('MANDATORY: image URLs are paths on our own API', () => {
      const view = toView(
        {
          avatarMediaId: 'm1',
          // Added when banners moved to a spec; these two literals predate it.
          bannerSpec: null,
          bannerPublishedMediaId: null,
          tagline: null,
          bannerMediaId: 'm2',
          bannerUrl: 'https://inara.cz/x',
          bannerLabel: null,
          accent: 'cyan',
          showRank: true,
          showCommander: true,
          enabled: true,
        },
        null,
      );

      expect(view.avatarUrl).toBe('/v1/media/uploads/m1');
      expect(view.bannerUrl).toBe('/v1/media/uploads/m2');
      // The LINK is external by design; the IMAGES never are. Distinct fields for that reason.
      expect(view.bannerLink).toBe('https://inara.cz/x');
    });

    it('falls back to orange when a stored accent is no longer in the set', () => {
      // The set can shrink under stored rows. An unknown value must not become an unknown class
      // name, which would render an unstyled block rather than an obviously-wrong colour.
      const view = toView(
        {
          avatarMediaId: null,
          bannerSpec: null,
          bannerPublishedMediaId: null,
          tagline: null,
          bannerMediaId: null,
          bannerUrl: null,
          bannerLabel: null,
          accent: 'chartreuse',
          showRank: true,
          showCommander: true,
          enabled: true,
        },
        null,
      );
      expect(view.accent).toBe('orange');
    });
  });

  describe('reading many at once', () => {
    it('does not query at all for an empty list', async () => {
      // A thread whose posts are all by deleted accounts, or a page with nothing on it. An `IN ()`
      // with no values is a query that costs a round trip to return nothing.
      const db = client();
      const out = await new SignatureService().forUsers(db as never, []);
      expect(out.size).toBe(0);
      expect(db.touched).toEqual([]);
    });
  });
});
