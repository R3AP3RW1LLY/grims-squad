import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import type { PrismaClient } from '@grims/db';
import type { WritableRow } from './knowledge-writer.js';

/**
 * Guides and reference — how the game works, and how THIS squadron works.
 *
 * ★ THE SOURCE THE ASSISTANT MOST NEEDS AND HAS NEVER HAD ★
 *
 * Every other source answers a question about a FACT: where a station is, what a module weighs, who
 * is in the squadron. This one answers "how does that work" — and those are the questions members
 * actually ask. It is also the only source whose value comes from being embedded rather than looked
 * up: nobody searches a guide by its title, they ask "how do I get more jump range" and the answer
 * is a paragraph that never uses those words.
 *
 * ★ TWO PLACES, BOTH OURS ★
 *
 *   The guides board   Written by the squadron, curated by construction — only FORUM_POST_GUIDE
 *                      holders can post there, so everything in it was deliberately published as
 *                      reference rather than voted up by accident.
 *
 *   A directory        Markdown files kept with the repository, for material that is not a forum
 *                      post: the journal event reference, mechanics notes, anything an officer
 *                      wants the assistant to know verbatim.
 *
 * ★ AND WHY NOT THE WIKI ★
 *
 * Scraping elite-dangerous.fandom.com would be the obvious way to get a lot of text quickly. It is
 * deliberately not done: the licensing is unclear for redistribution through an assistant, the
 * markup changes without warning, and an assistant confidently quoting a wiki edit somebody made
 * five minutes ago is worse than one that says it does not know. Everything here is content this
 * squadron owns and can correct.
 */

export interface ReferenceKnowledge {
  readonly rows: WritableRow[];
  readonly fromBoard: number;
  readonly fromFiles: number;
  readonly fromHelp: number;
}

/** Where reference documents live. Overridable so a second machine need not match this one. */
const DEFAULT_DIR = 'ssot/09-reference';

/**
 * Where the help corpus lives — the 57 articles describing every surface of the platform.
 *
 * ★ ITS OWN kind, ON PURPOSE ★
 *
 * These rows carry `kind: 'help'` where ordinary reference carries 'guide'/'document', because the
 * support assistant's retrieval is HELP-TAGGED ONLY (owner's approved design): a member asking the
 * support chat "how do I pair the app" must be answered from the articles written for that
 * question, not from whatever forum guide embeds nearest. The general assistant still sees them —
 * they are reference like everything else here — but the support leg can narrow to exactly this
 * kind and nothing else.
 */
const HELP_DIR = 'docs/help';

/**
 * The frontmatter the help articles carry: `title`, `surface`, `route`. Parsed rather than
 * stripped, because the title is the retrieval anchor and the route is what lets an answer link
 * the member to the page it is describing.
 */
export function readHelpFrontmatter(raw: string): { title: string | null; route: string | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (match === null) return { title: null, route: null, body: raw };

  const field = (name: string): string | null => {
    const line = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(match[1] ?? '');
    const value = line?.[1];
    return value === undefined ? null : value.trim();
  };

  return { title: field('title'), route: field('route'), body: raw.slice(match[0].length) };
}

/**
 * How much of one document goes in a row.
 *
 * ★ CHUNKED, BECAUSE A VECTOR DESCRIBES ONE THING ★
 *
 * A 4,000-word guide embedded whole produces a single vector that is the AVERAGE of everything it
 * discusses — jump range, engineering, power management — and is therefore close to nothing in
 * particular. Retrieval returns it for every question and answers none of them well.
 *
 * Split on blank lines with a size target, so each row is a passage about one thing. Paragraphs are
 * kept whole: a chunk that starts mid-sentence embeds the fragment, not the idea.
 */
const CHUNK_TARGET = 1_200;

export function chunk(text: string, target = CHUNK_TARGET): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '');

  const out: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    // Start a new chunk when adding this paragraph would overshoot — unless nothing is held yet, in
    // which case a single oversized paragraph becomes its own chunk rather than being dropped.
    if (current !== '' && current.length + p.length + 1 > target) {
      out.push(current);
      current = p;
    } else {
      current = current === '' ? p : `${current} ${p}`;
    }
  }

  if (current !== '') out.push(current);
  return out;
}

/** Reads the guides board, the reference directory and the help corpus into rows. */
export async function readReferenceKnowledge(
  db: PrismaClient,
  dir: string = DEFAULT_DIR,
  helpDir: string = HELP_DIR,
): Promise<ReferenceKnowledge> {
  const rows: WritableRow[] = [];

  // ── the guides board ──────────────────────────────────────────────────────
  const posts = await db.$queryRawUnsafe<
    Array<{ id: string; title: string; body: string; category_slug: string; thread_slug: string }>
  >(
    `SELECT p.id,
            t.title,
            -- Text, not markup. The assistant reads this; bodies were sanitised on the way in
            -- (INV-035), so the tag set is already closed and known.
            regexp_replace(p.body_html, '<[^>]+>', ' ', 'g') AS body,
            c.slug AS category_slug,
            t.slug AS thread_slug
       FROM forum_posts p
       JOIN forum_threads t    ON t.id = p.thread_id
       JOIN forum_categories c ON c.id = t.category_id
      WHERE p.deleted_at IS NULL
        AND p.screen_state = 'clear'
        /*
         * The guides board only, and only while it is PUBLIC. A guide moved behind a permission is
         * a guide that must stop teaching the assistant — there is no per-member filtering after
         * this table, so one restricted row reaches everybody who asks the right question.
         */
        AND c.slug = 'guides'
        AND COALESCE(c.view_perm, 0) = 0`,
  );

  let fromBoard = 0;
  for (const post of posts) {
    const body = post.body.replace(/\s+/g, ' ').trim();
    if (body.length < 200) continue; // A one-line notice is not a guide.

    const pieces = chunk(body);
    fromBoard += 1;

    pieces.forEach((piece, i) => {
      rows.push({
        source: 'reference',
        kind: 'guide',
        // The chunk index is part of the key: without it every piece of one guide collides and
        // only the last survives, which looks like a guide that mysteriously lost its middle.
        extKey: `forum/${post.id}#${i}`,
        name: post.title,
        data: {
          title: post.title,
          url: `/forum/${post.category_slug}/${post.thread_slug}`,
          part: i + 1,
          parts: pieces.length,
        },
        /*
         * The TITLE rides on every chunk. Part four of a jump-range guide reads as disembodied
         * advice without it, and the vector would describe the advice rather than the subject.
         */
        text: pieces.length === 1 ? `${post.title}\n\n${piece}` : `${post.title} (part ${i + 1} of ${pieces.length})\n\n${piece}`,
        coords: null,
      });
    });
  }

  // ── the reference directory ───────────────────────────────────────────────
  let fromFiles = 0;
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    for (const file of readdirSync(dir)) {
      if (!['.md', '.txt'].includes(extname(file).toLowerCase())) continue;

      const raw = readFileSync(join(dir, file), 'utf8');
      // Markdown, lightly stripped. Headings and emphasis carry no meaning to an embedding and a
      // hash in the middle of a sentence is noise the model has to look past.
      const body = raw
        .replace(/^---[\s\S]*?---/, '')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/[*_`>]/g, '')
        .trim();
      if (body.length < 200) continue;

      const title = basename(file, extname(file)).replace(/[-_]+/g, ' ');
      const pieces = chunk(body);
      fromFiles += 1;

      pieces.forEach((piece, i) => {
        rows.push({
          source: 'reference',
          kind: 'document',
          extKey: `file/${file}#${i}`,
          name: title,
          data: { title, file, part: i + 1, parts: pieces.length },
          text: pieces.length === 1 ? `${title}\n\n${piece}` : `${title} (part ${i + 1} of ${pieces.length})\n\n${piece}`,
          coords: null,
        });
      });
    }
  }

  // ── the help corpus ───────────────────────────────────────────────────────
  let fromHelp = 0;
  if (existsSync(helpDir) && statSync(helpDir).isDirectory()) {
    for (const file of readdirSync(helpDir)) {
      if (extname(file).toLowerCase() !== '.md') continue;
      // The index is navigation for humans and the seeding script — a table of contents embedded
      // as an answer would be retrieved for everything and answer nothing.
      if (file.toUpperCase() === 'INDEX.MD') continue;

      const raw = readFileSync(join(helpDir, file), 'utf8');
      const { title: fmTitle, route, body: afterFrontmatter } = readHelpFrontmatter(raw);

      const body = afterFrontmatter
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/[*_`>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (body.length < 200) continue;

      const title = fmTitle ?? basename(file, '.md').replace(/[-_]+/g, ' ');
      const pieces = chunk(body);
      fromHelp += 1;

      pieces.forEach((piece, i) => {
        rows.push({
          source: 'reference',
          kind: 'help',
          extKey: `help/${file}#${i}`,
          name: title,
          // `url` is the article's route, so an assistant answer can link the member straight to
          // the page it is explaining rather than describing where to find it.
          data: { title, file, url: route, part: i + 1, parts: pieces.length },
          text:
            pieces.length === 1
              ? `${title}\n\n${piece}`
              : `${title} (part ${i + 1} of ${pieces.length})\n\n${piece}`,
          coords: null,
        });
      });
    }
  }

  return { rows, fromBoard, fromFiles, fromHelp };
}
