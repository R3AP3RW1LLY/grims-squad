import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app's colonisation menu must match the website's, entry for entry.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "ensure the Companion app matches and has all the same pages in colonization that the website has
 * please! must be a mirror!"
 *
 * ★ WHY THIS IS A SOURCE-TEXT TEST AND NOT A BETTER ONE ★
 *
 * The two menus are declared in different packages, in different runtimes, from different data: the
 * website's is a server-side array the API hands down per member, the app's is a literal in a Preact
 * component. Nothing links them, so nothing can notice when a page is added to one and not the
 * other — which is exactly the drift the owner has now objected to twice.
 *
 * Importing the API's nav module here would drag Nest, Prisma and a database connection into the
 * companion's test run for one array. Reading the two files and comparing the labels costs nothing
 * and fails for the one reason worth failing for.
 *
 * It compares LABELS, not routes. The app has no URLs — it has pages — so the label is the only
 * thing the two genuinely share, and it is also the thing a member sees and compares.
 */

/*
 * From the working directory rather than `import.meta.dirname`: this package's spec tsconfig emits
 * CommonJS, where `import.meta` is a compile error. Vitest runs with the cwd set to the package, so
 * two levels up is the repo — which the readFileSync below proves on every run.
 */
const REPO = join(process.cwd(), '..', '..');

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

/** Every `label:` inside a nav entry whose `subsection` is Colonisation. */
function websiteLabels(): string[] {
  const src = read('apps/api/src/auth/nav.ts');
  const out: string[] = [];

  // Entries are object literals separated by `},` at a known indent. Splitting on the brace keeps
  // this from matching a label in a comment three entries away.
  for (const chunk of src.split(/\n {2}\{\n/)) {
    if (!chunk.includes("subsection: 'Colonisation'")) continue;
    const label = /\n {4}label: '([^']+)'/.exec(chunk);
    if (label?.[1] !== undefined) out.push(label[1]);
  }
  return out;
}

/** Every `label:` inside the app's colonisation NAV group. */
function appLabels(): string[] {
  const src = read('apps/companion/src/renderer/app.tsx');

  /*
   * Anchored on the NAV array, not on the first `group: 'colonisation'` in the file — that one is
   * in the `NavGroup` interface above it, and starting there swallowed Status and the group's own
   * heading. Caught by this test failing the first time it ran, which is the whole point of it.
   */
  const nav = src.indexOf('const NAV');
  expect(nav, 'the app still has a NAV array').toBeGreaterThan(-1);

  const group = src.indexOf("group: 'colonisation'", nav);
  expect(group, 'the app still has a colonisation nav group').toBeGreaterThan(-1);

  // From `children:`, not from the group — the group carries its own `label: 'Colonisation'`, which
  // is the heading rather than a page and has no counterpart on the website's list.
  const start = src.indexOf('children: [', group);
  // The group ends at its closing `],` — everything after it is a different top-level entry.
  const end = src.indexOf('\n    ],', start);
  const block = src.slice(start, end);

  return [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1] as string);
}

describe('the app mirrors the website’s colonisation menu', () => {
  it('has an entry for every page the website lists, with the same name', () => {
    const site = websiteLabels();

    // A guard on the guard. If the parse above ever stops matching, an empty list would pass every
    // assertion below and this file would go quiet while claiming to be watching.
    expect(site.length).toBeGreaterThanOrEqual(5);
    expect(site).toContain('Planning');

    expect(appLabels()).toEqual(site);
  });

  it('lists them in the same order', () => {
    /*
     * Order is part of the mirror, not a detail. The owner has asked for a specific one twice —
     * "move the build types link in the navbar to be above New Project" — and a member switching
     * between the app and the site should find the same thing in the same place.
     */
    const site = websiteLabels();
    const app = appLabels();

    for (let i = 0; i < site.length; i += 1) {
      expect(app[i], `position ${i + 1} of the colonisation menu`).toBe(site[i]);
    }
  });
});
