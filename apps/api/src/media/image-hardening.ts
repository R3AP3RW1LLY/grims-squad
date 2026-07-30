import sharp from 'sharp';
import type { Metadata } from 'sharp';

/**
 * Turning a file somebody uploaded into an image we are willing to serve.
 *
 * ★ THE ONE IDEA THIS FILE IS BUILT ON: WE DO NOT CLEAN THE FILE, WE REPLACE IT ★
 *
 * Every byte served to a reader is a byte THIS CODE generated. The upload is decoded
 * into raw pixels and a brand-new file is encoded from those pixels. Nothing from the
 * original container survives — not metadata, not trailing data, not a second file
 * smuggled after the first, not a chunk the decoder skipped.
 *
 * That single property is what makes the rest of the threat model collapse:
 *
 *   EXIF and GPS       cannot survive, because no metadata is copied forward. A member
 *                      posting a screenshot from a phone is not publishing their home
 *                      address, and they should not have to know that to be safe.
 *   Polyglots          a file that is a valid GIF *and* valid HTML/JS — the classic
 *                      way an "image" becomes a script — cannot survive, because the
 *                      HTML lives in bytes we do not reproduce.
 *   Appended payloads  a ZIP or a shell script concatenated after the image data is
 *                      simply not in the output.
 *   Malformed chunks   crafted to exploit whatever decodes it downstream. Our encoder
 *                      writes well-formed output regardless of how odd the input was.
 *
 * ★ WHY NOT VALIDATE-AND-PASS-THROUGH ★
 *
 * The cheaper design checks the magic bytes, maybe strips an EXIF segment, and stores
 * the original. It is the same mistake as sanitising HTML with a regex: it enumerates
 * the badness it knows about, and the list is never finished. Re-encoding enumerates
 * the GOODNESS instead — pixels — and that list is complete.
 *
 * The cost is real: CPU per upload, and a re-encoded PNG is not byte-identical to what
 * the member chose. For a squadron forum posting screenshots, that is a trade worth
 * making without hesitating.
 *
 * ★ THE DECLARED CONTENT TYPE IS NEVER TRUSTED ★
 *
 * Not the filename, not the multipart `content-type`. Both are attacker-controlled
 * strings. The format is whatever the decoder actually finds, and if it cannot find
 * one, the upload is refused.
 */

/** Formats we accept IN. Determined by decoding, never by what the request claimed. */
const ACCEPTED_INPUT = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff']);

/**
 * Formats we write OUT, and the only content types this module can produce.
 *
 * Deliberately narrow. Anything animated becomes a still PNG — see `chooseOutput`.
 */
export const OUTPUT_TYPES = {
  png: 'image/png',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
} as const;

export type OutputFormat = keyof typeof OUTPUT_TYPES;

/**
 * Hard limits.
 *
 * ★ PIXELS MATTER MORE THAN BYTES ★
 *
 * `MAX_UPLOAD_BYTES` stops a huge file arriving. It does NOT stop a decompression bomb:
 * a ~50KB PNG can legitimately declare 30000x30000 pixels, which is 3.6GB of RAM the
 * moment anything decodes it. Byte limits feel like the safety check and are the wrong
 * axis entirely.
 *
 * So dimensions are read from the header FIRST and refused before any pixel is decoded.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 40_000_000;
/** Longest edge we store. A screenshot wider than this is downscaled, never rejected. */
export const MAX_EDGE = 2400;

export interface HardenedImage {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly format: OutputFormat;
  readonly width: number;
  readonly height: number;
}

export class ImageRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRejected';
  }
}

/**
 * What format to write, given what arrived.
 *
 * ★ ANIMATION IS DROPPED ON PURPOSE ★
 *
 * An animated GIF or WebP becomes a still PNG of its first frame. Keeping animation
 * would mean carrying multi-frame containers through the pipeline, and every extra
 * container feature is extra decoder surface — animated WebP in particular has a
 * history of memory-safety bugs.
 *
 * A guide screenshot does not need to move. If animation is ever genuinely wanted, it
 * should be a deliberate feature with its own limits rather than something that arrived
 * because nobody stopped it.
 */
export function chooseOutput(inputFormat: string, hasAlpha: boolean): OutputFormat {
  /*
   * Alpha survives. A screenshot with a transparent corner re-encoded to JPEG gets a
   * black box there, which looks like a rendering bug and is the sort of thing that
   * gets reported as "the upload broke my image".
   */
  if (hasAlpha) return 'png';
  // Photographs compress enormously better as JPEG; screenshots of text do not.
  if (inputFormat === 'jpeg') return 'jpeg';
  return 'png';
}

/**
 * Decodes an upload and re-encodes it as something safe to serve.
 *
 * Throws `ImageRejected` with a message intended for the member — every refusal says
 * what to do about it, because "invalid image" tells somebody nothing they can act on.
 */
export async function hardenImage(input: Uint8Array): Promise<HardenedImage> {
  if (input.byteLength === 0) {
    throw new ImageRejected('That file was empty.');
  }
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImageRejected(
      `That image is larger than ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB. Crop it or save it at a lower quality.`,
    );
  }

  /*
   * ★ TWO PIPELINES, AND THE REASON IS A BUG THE TESTS CAUGHT ★
   *
   * The first version used ONE pipeline with `limitInputPixels` set, and read metadata
   * from it. libvips enforces that limit during the metadata read, so a decompression
   * bomb threw there — and the catch below turned it into "that file is not an image we
   * can read", which is both wrong and unactionable. The member's 15000x15000 PNG is a
   * perfectly readable image; it is simply too big for us.
   *
   * Reading a header is not decoding. It parses a few dozen bytes and allocates nothing
   * proportional to the image, so it is safe to do UNLIMITED — and doing so is what
   * lets the explicit check below refuse a bomb with a message that says what to do
   * ("resize it and try again").
   *
   * The limit then goes on the pipeline that actually DECODES pixels, where it matters,
   * as a backstop in case a future edit reorders these checks.
   */
  const probe = sharp(input, { limitInputPixels: false, animated: false });

  let meta: Metadata;
  try {
    meta = await probe.metadata();
  } catch {
    /*
     * Deliberately not surfacing the decoder's error text. It names libvips internals,
     * which tells a member nothing and tells somebody probing the endpoint exactly what
     * is behind it.
     */
    throw new ImageRejected('That file is not an image we can read. PNG, JPEG, WebP or GIF.');
  }

  const format = meta.format;
  if (format === undefined || !ACCEPTED_INPUT.has(format)) {
    throw new ImageRejected('That file is not an image we can read. PNG, JPEG, WebP or GIF.');
  }

  const { width, height } = meta;
  if (width === undefined || height === undefined || width < 1 || height < 1) {
    throw new ImageRejected('That image has no usable dimensions.');
  }
  if (width * height > MAX_INPUT_PIXELS) {
    // Checked before decoding: see MAX_INPUT_PIXELS.
    throw new ImageRejected('That image has too many pixels to process. Resize it and try again.');
  }

  const out = chooseOutput(format, meta.hasAlpha === true);

  /*
   * ★ THE RE-ENCODE ★
   *
   * `rotate()` with no argument applies the EXIF orientation and then discards it —
   * necessary because stripping metadata alone would leave a phone photo sideways. The
   * rotation has to be baked into the pixels since the tag that described it is about
   * to be thrown away.
   *
   * Metadata is dropped by DEFAULT: sharp only carries it forward if `withMetadata()`
   * is called, and it deliberately is not. Nothing here copies EXIF, GPS, ICC, XMP or
   * IPTC.
   */
  let work = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate();

  if (width > MAX_EDGE || height > MAX_EDGE) {
    work = work.resize({
      width: Math.min(width, MAX_EDGE),
      height: Math.min(height, MAX_EDGE),
      fit: 'inside',
      // Never scale a small image UP to reach the limit — that would blur a screenshot
      // to no purpose.
      withoutEnlargement: true,
    });
  }

  const encoded =
    out === 'jpeg'
      ? await work.jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      : out === 'webp'
        ? await work.webp({ quality: 88 }).toBuffer({ resolveWithObject: true })
        : await work.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });

  return {
    body: new Uint8Array(encoded.data),
    contentType: OUTPUT_TYPES[out],
    format: out,
    width: encoded.info.width,
    height: encoded.info.height,
  };
}
