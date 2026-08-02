import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_LINKS } from './site-chrome';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — this file's own prose names the links it forbids. */
const code = (file: string): string =>
  readFileSync(resolve(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const authedNav = code('authed-nav.tsx');

/**
 * The public site's navbar, signed in and signed out.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "the Public navbar should only have a Forum link ... then we need a nav group dropdown for
 * Shipyard that has outfitter as the first link and public builds as the second link remove
 * everything else please" — and then, when the signed-in bar still had everything:
 *
 * "even when im logged in i dont want all that clutter up there! it should just show the public
 * stuff and dashboard if im logged in and on the homepage."
 *
 * ★ WHY A TEST AND NOT JUST A SHORTER LIST ★
 *
 * Because the clutter did not arrive by anybody deciding to put it there. `AuthedNav` rendered
 * every `squadron` entry the server sent, so adding a page to `nav.ts` — which is how every
 * Shipyard page in this session was added — silently grew the marketing site's header too. The
 * list got long on its own, and it would do it again.
 */

/** Destinations that belong in the hub sidebar and must never reach the public bar. */
const HUB_ONLY: readonly string[] = [
  '/roster',
  '/ops',
  '/bgs',
  '/fleet',
  '/gmsd-ai/ask',
  '/gmsd-ai/train',
  '/shipyard/squadron',
  '/settings/commander',
  '/settings/devices',
];

describe('the public navbar', () => {
  it('offers exactly Forum and a Shipyard dropdown', () => {
    expect(NAV_LINKS).toHaveLength(2);

    const [forum, shipyard] = NAV_LINKS;
    expect(forum).toEqual({ href: '/forum', label: 'Forum' });

    expect(shipyard && 'children' in shipyard ? shipyard.label : null).toBe('Shipyard');
  });

  it('puts Outfitter first in the dropdown and Public builds second', () => {
    // The order was asked for explicitly, and it is the useful one: somebody who has not built
    // anything yet wants the tool, not other people's results.
    const shipyard = NAV_LINKS.find((l) => 'children' in l && l.label === 'Shipyard');
    const children = shipyard !== undefined && 'children' in shipyard ? shipyard.children : [];

    expect(children.map((c) => c.href)).toEqual(['/shipyard', '/shipyard/public']);
    expect(children.map((c) => c.label)).toEqual(['Outfitter', 'Public builds']);
  });

  it('never lists a destination that needs a session', () => {
    const hrefs = NAV_LINKS.flatMap((l) =>
      'children' in l ? l.children.map((c) => c.href) : [l.href],
    );

    for (const blocked of HUB_ONLY) {
      expect(hrefs, `${blocked} is in the public navbar`).not.toContain(blocked);
    }
  });
});

describe('the signed-in navbar', () => {
  it('MANDATORY: renders the public list, not every squadron nav item', () => {
    /*
     * The regression itself. `me.nav.filter((i) => i.section === 'squadron')` is what put nine
     * links in the header, and it grew every time a page was added to `nav.ts`.
     */
    expect(authedNav).not.toMatch(/section\s*===\s*'squadron'/);
    expect(authedNav).toContain('NAV_LINKS');
  });

  it('MANDATORY: takes Dashboard from the server, not from a hard-coded string', () => {
    /*
     * While an admin is unsecured the server sends an EMPTY nav on purpose (me.controller.ts). A
     * hard-coded `/dashboard` would offer a door the guard is about to refuse — which is the exact
     * shape of bug `no-access.tsx` exists because of.
     *
     * The `<a href="/dashboard">` on the logo is deliberately not covered by this: a wordmark that
     * goes home is not a nav link, and it is right there in the same file.
     */
    expect(authedNav).toMatch(/me\.nav\.find\(.*'\/dashboard'/);
    expect(authedNav).toContain('dashboard !== null');
  });

  it('shows Dashboard before anything else', () => {
    const dashboardAt = authedNav.indexOf('dashboard !== null');
    const linksAt = authedNav.indexOf('NAV_LINKS.map');

    expect(dashboardAt).toBeGreaterThan(-1);
    expect(linksAt).toBeGreaterThan(-1);
    expect(dashboardAt, 'Dashboard must render before the public links').toBeLessThan(linksAt);
  });

  it('hard-codes none of the hub destinations', () => {
    for (const blocked of HUB_ONLY) {
      expect(authedNav, `${blocked} is hard-coded into the signed-in navbar`).not.toContain(
        `"${blocked}"`,
      );
    }
  });
});
