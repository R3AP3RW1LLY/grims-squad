import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the app's icons from the squadron brand set.
 *
 * ★ WHY A .ico AND NOT JUST THE 512px PNG ★
 *
 * There was no .ico at all, so electron-builder handed Windows one 512×512 PNG
 * and let it downscale. Windows needs 16px for a title bar and 32px for the
 * taskbar, and squeezing a detailed badge from 512 to 16 in one step is what
 * made every icon look smeared.
 *
 * A .ico is a CONTAINER. Packing the brand set — which already exists at 32,
 * 48, 64, 128 and 256 — lets Windows pick the size closest to what it needs
 * instead of resampling from the largest one.
 *
 * ★ NO IMAGE LIBRARY, AND NONE NEEDED ★
 *
 * Since Vista an .ico entry may hold a PNG verbatim rather than a BMP. So this
 * concatenates files that already exist behind a small header: no decoding, no
 * resampling, no dependency, and the bytes in the icon are exactly the bytes an
 * artist exported.
 *
 * Run by `pnpm build`, so the icons cannot drift from the brand set.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAND = join(HERE, '../../apps/web/public/brand');
const BUILD = join(HERE, 'build');

/**
 * Which sizes go in.
 *
 * ★ 16 AND 24 ADDED, 2026-08-01 ★
 *
 * They used to be absent, on the reasoning that the brand set did not have them and inventing them
 * would mean resampling — leaving Windows to halve 32→16 for the title bar.
 *
 * That reasoning was right about resampling and wrong about who should do it. Windows' runtime
 * downscale is a plain box filter with no sharpening, and the title bar and Alt-Tab are where the
 * icon is seen most. The two sizes are now exported ONCE, with ImageMagick's Lanczos filter and a
 * light unsharp pass, and committed to the brand set alongside the others.
 *
 * So the resampling still does not happen here — it happened once, deliberately, with a good
 * filter, and the bytes in the .ico are still exactly the bytes of an exported file. This script
 * keeps its promise of no decoding and no image dependency at build time.
 */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Packs PNGs into an .ico.
 *
 * The format: a 6-byte header, then a 16-byte directory entry per image, then
 * the image data. Offsets in the directory are absolute from the start of the
 * file, which is why the data has to be laid out before the entries are
 * written.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon (2 would be a cursor)
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, i) => {
    const at = i * 16;
    /*
     * 256 is written as 0. The field is ONE BYTE, so 256 does not fit — the
     * format's own convention is that zero means 256. Writing 256 here
     * truncates to 0 anyway, but only by accident; doing it deliberately is
     * the difference between working and appearing to work.
     */
    directory[at] = image.size >= 256 ? 0 : image.size; // width
    directory[at + 1] = image.size >= 256 ? 0 : image.size; // height
    directory[at + 2] = 0; // palette size; 0 for truecolour
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel — RGBA
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

await mkdir(BUILD, { recursive: true });

const images = [];
for (const size of SIZES) {
  const data = await readFile(join(BRAND, `badge-${size}.png`));

  // Verified rather than trusted: an .ico whose directory disagrees with the
  // PNG inside it renders as a black square, and nothing says why.
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== size || height !== size) {
    throw new Error(`badge-${size}.png is ${width}x${height}, expected ${size}x${size}`);
  }

  images.push({ size, data });
}

await writeFile(join(BUILD, 'icon.ico'), buildIco(images));

/*
 * The PNGs the runtime and the other platforms use.
 *
 * macOS and Linux take the 512 and convert it themselves — both handle that
 * well, and neither has Windows' 16px title-bar problem.
 */
await copyFile(join(BRAND, 'badge-512.png'), join(BUILD, 'icon.png'));

/*
 * The tray needs the SMALL marks, at their exported sizes.
 *
 * Windows draws the tray at 16px and macOS at 22, both doubled on a high-DPI
 * screen. Feeding either a 512px badge produces the smeared result this whole
 * script exists to fix.
 */
await copyFile(join(BRAND, 'badge-32.png'), join(BUILD, 'tray.png'));
await copyFile(join(BRAND, 'badge-64.png'), join(BUILD, 'tray@2x.png'));

console.log(
  `icon.ico: ${SIZES.join(', ')}px  ·  icon.png: 512px  ·  tray: 32/64px  — from the brand set`,
);
