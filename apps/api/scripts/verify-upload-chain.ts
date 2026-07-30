/**
 * End-to-end proof of the upload chain, against the real database and object store.
 *
 * The unit tests cover each piece. This checks the pieces FIT — specifically that the path
 * `UploadService` returns is one `isOwnMediaSrc` accepts, which is a contract between two
 * files that no single unit test spans. Get that wrong and every uploaded image silently
 * turns into text when a member posts it.
 *
 *   pnpm --filter @grims/api verify:uploads
 */
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { join } from 'node:path';
import { UploadService } from '../src/media/upload.service.js';
import { FileObjectStore } from '../src/media/object-store.drivers.js';
import { renderPostBody, isOwnMediaSrc } from '../src/forum/sanitize.js';

const FORUM_POST_MEMBER = 1n << 3n;

function check(label: string, ok: boolean, detail = ''): boolean {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`);
  return ok;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const store = new FileObjectStore(join(process.cwd(), '.local-storage'));
  const svc = new UploadService(store, prisma as never);

  let allOk = true;
  const ok = (l: string, v: boolean, d = '') => {
    if (!check(l, v, d)) allOk = false;
  };

  try {
    const uploader = await prisma.user.findFirst({
      where: { status: 'active' },
      select: { id: true, handle: true },
    });
    if (uploader === null) throw new Error('No active user to attribute an upload to.');
    console.log(`Uploading as ${uploader.handle}\n`);

    /*
     * A JPEG carrying real EXIF including GPS, and a payload appended after the image data.
     * Both must be gone from what gets stored.
     */
    const dirty = Buffer.concat([
      await sharp({ create: { width: 1200, height: 400, channels: 3, background: '#c05000' } })
        .withExif({
          IFD0: { Copyright: 'CMDR Test', Make: 'TestPhone' },
          GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
        })
        .jpeg()
        .toBuffer(),
      Buffer.from('<script>alert(1)</script>', 'utf8'),
    ]);

    const before = await sharp(dirty).metadata();
    ok('fixture genuinely carries EXIF', before.exif !== undefined);

    console.log('\n[1] upload');
    const result = await svc.upload(uploader.id, FORUM_POST_MEMBER, new Uint8Array(dirty));
    ok('returned an id', /^[0-9a-f-]{36}$/i.test(result.id), result.id);
    ok('dimensions preserved', result.width === 1200 && result.height === 400, `${result.width}x${result.height}`);

    console.log('\n[2] the row and the object agree');
    const row = await prisma.mediaUpload.findUnique({ where: { id: result.id } });
    ok('row exists', row !== null);
    ok('storage key is derived from the id', row?.storageKey === `uploads/${result.id}.jpg`, row?.storageKey ?? '');
    ok('provisional key was replaced', !(row?.storageKey ?? '').startsWith('pending/'));
    ok('content type is one we encode', ['image/png', 'image/jpeg', 'image/webp'].includes(row?.contentType ?? ''), row?.contentType ?? '');

    console.log('\n[3] hardening actually happened');
    const served = await svc.serve(result.id);
    ok('serves', served !== null);
    const bytes = Buffer.from(served?.body ?? new Uint8Array());
    const after = await sharp(bytes).metadata();
    ok('EXIF is GONE', after.exif === undefined);
    ok('appended script is GONE', !bytes.toString('latin1').includes('<script'));
    ok('bytes differ from the upload', !bytes.equals(dirty));
    ok('still a real image', after.format === 'jpeg' || after.format === 'png');

    console.log('\n[4] THE CONTRACT BETWEEN THE TWO FILES');
    ok('the returned path is one the sanitiser accepts', isOwnMediaSrc(result.path), result.path);

    const rendered = renderPostBody(`Here is the step:\n\n![the settings page](${result.path})`);
    ok('an <img> survives sanitisation', rendered.bodyHtml.includes('<img'));
    ok('the src is intact', rendered.bodyHtml.includes(`src="${result.path}"`));
    ok('it did NOT degrade to text', !rendered.bodyHtml.includes('[image:'));
    ok('lazy loading was applied', rendered.bodyHtml.includes('loading="lazy"'));

    console.log('\n[5] a remote image in the same post is still refused');
    const mixed = renderPostBody(`![ours](${result.path})\n\n![theirs](https://evil.test/tracker.png)`);
    ok('ours survives', mixed.bodyHtml.includes(`src="${result.path}"`));
    ok('theirs does not', !mixed.bodyHtml.includes('evil.test'));
    ok('theirs degraded to text', mixed.bodyHtml.includes('[image: theirs]'));

    console.log('\n[6] cleanup');
    await store.delete(row?.storageKey ?? '');
    await prisma.mediaUpload.delete({ where: { id: result.id } });
    ok('removed the probe upload', (await prisma.mediaUpload.findUnique({ where: { id: result.id } })) === null);

    console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
    if (!allOk) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
