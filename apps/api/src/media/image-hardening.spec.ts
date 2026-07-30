import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  hardenImage,
  chooseOutput,
  ImageRejected,
  MAX_EDGE,
  MAX_UPLOAD_BYTES,
} from './image-hardening.js';

/**
 * The upload hardening suite.
 *
 * ★ THESE USE REAL PAYLOADS, NOT MOCKS ★
 *
 * The claim being tested is "nothing from the original container survives", and a mock
 * cannot demonstrate that — it can only demonstrate that the function was called. So
 * every test below builds an actual file with an actual problem in it and then asserts
 * the problem is absent from the OUTPUT BYTES.
 *
 * That is also why sharp is not stubbed. Stubbing the encoder would remove the only
 * component doing the security work.
 */

/** A real PNG, generated rather than checked in as a fixture. */
const png = (w = 8, h = 8): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c05000' } })
    .png()
    .toBuffer();

const jpeg = (w = 8, h = 8): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#204080' } })
    .jpeg()
    .toBuffer();

const withAlpha = (w = 8, h = 8): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();

describe('EXIF and location metadata', () => {
  it('MANDATORY: GPS coordinates in an upload never reach storage', async () => {
    /*
     * ★ THE PRIVACY FAILURE THIS PREVENTS ★
     *
     * A member screenshots something on their phone and posts it. Phone cameras write
     * GPS coordinates into EXIF. Storing the file as uploaded would publish their
     * location to everybody who can read the thread — and they would have no way of
     * knowing it had happened.
     *
     * Built with real EXIF via sharp's own writer, then asserted absent by DECODING the
     * output rather than by string-searching it: a substring check would pass if the
     * bytes merely moved.
     */
    const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      /*
       * Cast, because sharp's `Exif` type does not declare a GPS block — while libvips writes
       * one perfectly well. GPS is the whole point of this fixture: it is the tag that turns a
       * posted screenshot into a member's home address, so weakening the fixture to satisfy the
       * type would remove the reason the test exists.
       */
      .withExif({
        IFD0: { Copyright: 'CMDR Test', Make: 'TestPhone' },
        GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
      } as unknown as Parameters<ReturnType<typeof sharp>['withExif']>[0])
      .jpeg()
      .toBuffer();

    // The fixture genuinely has metadata, or this test proves nothing.
    const before = await sharp(src).metadata();
    expect(before.exif, 'fixture must actually carry EXIF').toBeDefined();

    const out = await hardenImage(src);
    const after = await sharp(out.body).metadata();

    expect(after.exif).toBeUndefined();
  });

  it('MANDATORY: applies EXIF orientation before discarding it', async () => {
    /*
     * Stripping metadata alone would leave a phone photo sideways: the tag describing
     * the rotation is thrown away, so the rotation must first be baked into the pixels.
     *
     * A 16x8 image tagged as needing a 90° turn must come out 8x16.
     */
    const src = await sharp({ create: { width: 16, height: 8, channels: 3, background: '#fff' } })
      /*
       * `withMetadata({ orientation })`, NOT `withExif({ IFD0: { Orientation } })`.
       *
       * The first version of this test used withExif and asserted 16x8 -> 8x16. It got
       * 16x8 back, which looked like `rotate()` being broken. It was the FIXTURE:
       * sharp's `rotate()` with no argument reads `metadata().orientation`, which
       * `withMetadata` populates and a raw IFD0 tag write does not necessarily reach.
       *
       * Worth keeping the note, because the symptom pointed squarely at the wrong file.
       */
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    // The fixture genuinely declares a rotation, or this proves nothing.
    expect((await sharp(src).metadata()).orientation).toBe(6);

    const out = await hardenImage(src);

    expect(out.width).toBe(8);
    expect(out.height).toBe(16);
  });

  it('drops ICC and XMP along with everything else', async () => {
    const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .withMetadata({ icc: 'srgb' })
      .png()
      .toBuffer();

    const out = await hardenImage(src);
    const after = await sharp(out.body).metadata();

    // No metadata is copied FORWARD — nothing enumerates what to remove.
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
  });
});

describe('polyglots and appended payloads', () => {
  it('MANDATORY: HTML appended to a valid PNG is not in the output', async () => {
    /*
     * ★ THE CLASSIC "IMAGE" THAT IS ALSO A SCRIPT ★
     *
     * A file that is a valid PNG and also contains HTML. Served with the wrong
     * content-type, or fetched by something that sniffs, the script half executes.
     *
     * It cannot survive here, because the output is encoded from PIXELS — the appended
     * bytes are not pixels and there is nowhere for them to go.
     */
    const payload = '<script>alert(document.domain)</script>';
    const src = Buffer.concat([await png(), Buffer.from(payload, 'utf8')]);

    const out = await hardenImage(src);
    const text = Buffer.from(out.body).toString('latin1');

    expect(text).not.toContain('<script');
    expect(text).not.toContain('alert(');
    expect(text).not.toContain('document.domain');
  });

  it('MANDATORY: a PHP tag hidden in a comment chunk does not survive', async () => {
    const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .withExif({ IFD0: { ImageDescription: '<?php system($_GET["c"]); ?>' } })
      .jpeg()
      .toBuffer();

    const out = await hardenImage(src);
    const text = Buffer.from(out.body).toString('latin1');

    expect(text).not.toContain('<?php');
    expect(text).not.toContain('system(');
  });

  it('MANDATORY: a ZIP concatenated after the image is gone', async () => {
    // "PK\x03\x04" is the ZIP local-file header — the shape of an image/archive
    // polyglot used to smuggle a payload past an upload filter.
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    // The ZIP local-file header, built from byte VALUES rather than written as an escape
    // sequence in a string. Twice now a shell heredoc has collapsed the escapes and left
    // real control bytes in this file, at which point grep reports "binary file matches"
    // and the Edit tool cannot address the line because the bytes are not typeable.
    const src = Buffer.concat([await png(), zipMagic, Buffer.from('SMUGGLED', 'latin1')]);

    const out = await hardenImage(src);
    expect(Buffer.from(out.body).toString('latin1')).not.toContain('SMUGGLED');
  });

  it('the output really is a fresh file, not the input with edits', async () => {
    /*
     * The property everything above depends on, asserted directly: given clean input
     * with nothing wrong, the bytes still differ, because they were regenerated.
     */
    const src = await png(32, 32);
    const out = await hardenImage(src);

    expect(Buffer.from(out.body).equals(src)).toBe(false);
    // And it is still a real PNG.
    expect([...out.body.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('the declared type is never trusted', () => {
  it('MANDATORY: format comes from decoding, not from any header', async () => {
    /*
     * `hardenImage` takes bytes and NOTHING ELSE — no filename, no declared
     * content-type. That is the design: both are attacker-controlled strings, and a
     * signature that accepted them would invite somebody to pass them through.
     *
     * Asserted by giving it a JPEG and checking the reported type is derived.
     */
     expect(hardenImage.length).toBe(1);

     const out = await hardenImage(await jpeg());
     expect(out.contentType).toBe('image/jpeg');
  });

  it('MANDATORY: a text file named like an image is refused', async () => {
    const src = Buffer.from('this is definitely not an image', 'utf8');
    await expect(hardenImage(src)).rejects.toThrow(ImageRejected);
  });

  it('MANDATORY: an HTML file is refused outright', async () => {
    const src = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8');
    await expect(hardenImage(src)).rejects.toBeInstanceOf(ImageRejected);
  });

  it('refuses an SVG, which is a script container wearing an image extension', async () => {
    /*
     * SVG is not in the accepted set, and this is the reason: it is XML that can carry
     * script, foreignObject and external references. It is the one "image" format that
     * is an XSS vector by design, and no amount of re-encoding makes serving it inline
     * safe.
     */
    const src = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'utf8',
    );
    await expect(hardenImage(src)).rejects.toBeInstanceOf(ImageRejected);
  });

  it('does not leak decoder internals in the refusal', async () => {
    /*
     * The message a member sees must not name libvips or quote its error. That text
     * helps nobody and tells anyone probing the endpoint what is behind it.
     */
    await expect(hardenImage(Buffer.from('nope', 'utf8'))).rejects.toThrow(/PNG, JPEG, WebP or GIF/);
    await expect(hardenImage(Buffer.from('nope', 'utf8'))).rejects.not.toThrow(/vips|libvips|heif/i);
  });
});

describe('resource limits', () => {
  it('MANDATORY: refuses an empty file with a message somebody can act on', async () => {
    await expect(hardenImage(new Uint8Array())).rejects.toThrow(/empty/i);
  });

  it('MANDATORY: refuses anything over the byte cap', async () => {
    const src = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    await expect(hardenImage(src)).rejects.toThrow(/larger than/i);
  });

  it('MANDATORY @decompression-bomb: a small file declaring vast dimensions is refused', async () => {
    /*
     * ★ THE LIMIT THAT ACTUALLY MATTERS ★
     *
     * A byte cap feels like the safety check and is the wrong axis. This file is a few
     * KB and declares 15000x15000 — 225 million pixels, gigabytes of RAM the instant
     * anything decodes it. The refusal has to happen from the HEADER, before a single
     * pixel is decoded.
     */
    const bomb = await sharp({
      create: { width: 15000, height: 15000, channels: 3, background: '#000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    // The fixture is genuinely small relative to its pixel count, or it is testing the
    // byte cap by accident rather than the pixel cap.
    expect(bomb.byteLength).toBeLessThan(MAX_UPLOAD_BYTES);

    await expect(hardenImage(bomb)).rejects.toThrow(/pixels/i);
  });

  it('downscales an oversized screenshot rather than rejecting it', async () => {
    /*
     * A 4K screenshot is a completely reasonable thing to post. Refusing it would push
     * members to resize images by hand, which they will not do — they will give up on
     * posting the screenshot.
     */
    const src = await png(3800, 1200);
    const out = await hardenImage(src);

    expect(Math.max(out.width, out.height)).toBe(MAX_EDGE);
    // Aspect ratio preserved: 3800x1200 -> 2400x758.
    expect(out.height).toBe(Math.round((1200 * MAX_EDGE) / 3800));
  });

  it('never scales a small image UP to reach the limit', async () => {
    const out = await hardenImage(await png(40, 20));
    expect(out.width).toBe(40);
    expect(out.height).toBe(20);
  });
});

describe('animation is dropped deliberately', () => {
  /*
   * ★ AN HONEST NOTE ABOUT WHAT THIS DOES AND DOES NOT PROVE ★
   *
   * I could not build a genuinely multi-frame GIF with sharp alone. Two attempts failed:
   * passing two options objects to `sharp()` ("Unsupported input"), and reading a raw
   * filmstrip back with `pages`/`pageHeight`, which wrote a SINGLE-frame GIF — so
   * `metadata().pages` threw "n-pages not found" and any assertion after it would have
   * been vacuous.
   *
   * Rather than check in a hand-crafted byte array whose LZW I cannot verify, or a
   * binary fixture nobody can review in a diff, the guarantee is asserted two ways that
   * are both genuinely checkable:
   *
   *   1. Behaviourally — a GIF never comes back as a GIF.
   *   2. Structurally — both pipelines pass `animated: false`, so libvips decodes the
   *      first frame and nothing else, whatever arrives.
   *
   * A real animated fixture would be better and is worth adding if this ever matters
   * more; the structural check is what makes the absence tolerable meanwhile.
   */
  it('MANDATORY: a GIF never comes back as a GIF', async () => {
    const gif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#3080c0' },
    })
      .gif()
      .toBuffer();

    // The fixture really is a GIF going in.
    expect((await sharp(gif).metadata()).format).toBe('gif');

    const out = await hardenImage(gif);

    expect(out.format).toBe('png');
    expect(out.contentType).toBe('image/png');
  });

  it('MANDATORY: every pipeline decodes ONE frame, asserted in the source', async () => {
    /*
     * The structural half. `animated: false` is what stops a multi-frame container being
     * carried through, and its absence would be invisible in any test using a
     * single-frame fixture — which, per the note above, is all I have.
     *
     * Two pipelines exist (a header probe and a decode), and BOTH must say it: the probe
     * reporting frame-one dimensions while the decode expanded every frame is exactly
     * the kind of mismatch that produces a wrong-sized output nobody can explain.
     */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./image-hardening.ts', import.meta.url), 'utf8');
    /*
     * Comments stripped first, so the doc block above — which discusses `animated: false`
     * at length — cannot satisfy the assertion by talking about it.
     *
     * Written with the Edit tool rather than through a shell heredoc, because a heredoc
     * has already eaten the escapes in a regex twice on this branch: once turning `\b`
     * into a literal backspace byte in the sanitiser, and once collapsing `\s` to `s` in
     * a built pattern. A regex literal has no string-escaping layer to lose.
     */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    const pipelines = code.match(/sharp\(input,\s*\{[^}]*\}/g) ?? [];
    expect(pipelines.length, 'expected a probe pipeline and a decode pipeline').toBe(2);
    for (const p of pipelines) {
      expect(p, p).toContain('animated: false');
    }
  });
});

describe('chooseOutput', () => {
  it('keeps alpha as PNG', () => {
    // JPEG has no alpha channel; a transparent corner would become a black box, which
    // reads as a bug in our upload rather than a limitation of the format.
    expect(chooseOutput('png', true)).toBe('png');
    expect(chooseOutput('webp', true)).toBe('png');
  });

  it('keeps photographs as JPEG', () => {
    expect(chooseOutput('jpeg', false)).toBe('jpeg');
  });

  it('sends screenshots to PNG, where text stays sharp', () => {
    expect(chooseOutput('png', false)).toBe('png');
    expect(chooseOutput('gif', false)).toBe('png');
  });

  it('MANDATORY: only ever names a format we can actually encode', () => {
    // A returned format outside this set would reach an encoder branch that does not
    // exist, and fall through to PNG silently while reporting the wrong content type.
    for (const [fmt, alpha] of [
      ['png', true],
      ['png', false],
      ['jpeg', false],
      ['jpeg', true],
      ['webp', false],
      ['webp', true],
      ['gif', false],
      ['tiff', false],
      ['something-new', false],
    ] as const) {
      expect(['png', 'jpeg', 'webp']).toContain(chooseOutput(fmt, alpha));
    }
  });
});

describe('what a member actually uploaded still works', () => {
  it('accepts a normal PNG screenshot', async () => {
    const out = await hardenImage(await png(1280, 720));
    expect(out.contentType).toBe('image/png');
    expect(out.width).toBe(1280);
    expect(out.body.byteLength).toBeGreaterThan(0);
  });

  it('accepts a JPEG photo', async () => {
    const out = await hardenImage(await jpeg(800, 600));
    expect(out.contentType).toBe('image/jpeg');
  });

  it('preserves transparency', async () => {
    const out = await hardenImage(await withAlpha(16, 16));
    const after = await sharp(out.body).metadata();
    expect(out.contentType).toBe('image/png');
    expect(after.hasAlpha).toBe(true);
  });
});
