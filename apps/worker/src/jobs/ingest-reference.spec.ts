import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chunk, readHelpFrontmatter, readReferenceKnowledge } from './ingest-reference.js';
import type { PrismaClient } from '@grims/db';

/**
 * The help corpus is what the support assistant answers from, so the reader that feeds it is worth
 * pinning: an article whose frontmatter is silently mis-parsed becomes a passage with no title and
 * no route — retrievable but unable to link anywhere, which reads as an assistant that knows the
 * answer and cannot say where it lives.
 */

const emptyBoard = {
  // The guides-board query. These tests are about the FILE readers, so the board answers empty.
  $queryRawUnsafe: async () => [],
} as unknown as PrismaClient;

const noDir = join(tmpdir(), 'grims-does-not-exist');

describe('readHelpFrontmatter', () => {
  it('parses title and route and returns the body without the fence', () => {
    const out = readHelpFrontmatter('---\ntitle: Pairing the app\nsurface: both\nroute: /settings/devices\n---\nThe body.');
    expect(out.title).toBe('Pairing the app');
    expect(out.route).toBe('/settings/devices');
    expect(out.body).toBe('The body.');
  });

  it('a file with no frontmatter is all body, honestly', () => {
    const out = readHelpFrontmatter('Just prose, no fence.');
    expect(out.title).toBeNull();
    expect(out.route).toBeNull();
    expect(out.body).toBe('Just prose, no fence.');
  });

  it('CRLF fences parse the same as LF — articles are edited on Windows', () => {
    const out = readHelpFrontmatter('---\r\ntitle: T\r\nroute: /r\r\n---\r\nBody.');
    expect(out.title).toBe('T');
    expect(out.route).toBe('/r');
  });
});

describe('the help corpus leg', () => {
  const helpDir = mkdtempSync(join(tmpdir(), 'grims-help-'));
  afterAll(() => rmSync(helpDir, { recursive: true, force: true }));

  const article = (name: string, title: string, route: string): void =>
    writeFileSync(
      join(helpDir, name),
      `---\ntitle: ${title}\nsurface: web\nroute: ${route}\n---\n${'A sentence about the thing. '.repeat(20)}`,
    );

  it('MANDATORY: help rows carry kind "help" — the support leg filters on exactly this', async () => {
    article('pairing.md', 'Pairing', '/settings/devices');
    const out = await readReferenceKnowledge(emptyBoard, noDir, helpDir);

    expect(out.fromHelp).toBe(1);
    const row = out.rows.find((r) => r.extKey.startsWith('help/pairing.md'));
    expect(row?.kind).toBe('help');
    expect(row?.source).toBe('reference');
    // The route rides along so an answer can link the member to the page it is explaining.
    expect((row?.data as { url: string | null }).url).toBe('/settings/devices');
    // The title anchors the embedding; a chunk without it describes advice, not a subject.
    expect(row?.text?.startsWith('Pairing')).toBe(true);
  });

  it('INDEX.md is navigation, not an answer — never embedded', async () => {
    writeFileSync(join(helpDir, 'INDEX.md'), `# Index\n\n${'- a line in the index\n'.repeat(30)}`);
    const out = await readReferenceKnowledge(emptyBoard, noDir, helpDir);
    expect(out.rows.some((r) => r.extKey.startsWith('help/INDEX'))).toBe(false);
  });

  it('a missing help directory is zero articles, not a crash — production may predate the corpus', async () => {
    const out = await readReferenceKnowledge(emptyBoard, noDir, noDir);
    expect(out.fromHelp).toBe(0);
    expect(out.rows).toEqual([]);
  });
});

describe('chunk', () => {
  it('keeps paragraphs whole and splits near the target', () => {
    const paragraph = 'word '.repeat(100).trim();
    const pieces = chunk(`${paragraph}\n\n${paragraph}\n\n${paragraph}`, 600);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.startsWith('word')).toBe(true);
  });
});
