import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(resolve(REPO, p), 'utf8');

/**
 * POLICY-CODE DRIFT
 *
 * The privacy policy makes specific, checkable promises about how the system
 * behaves. Each one was true when written. The danger is not that someone edits
 * the policy — it is that someone changes the CODE and never thinks about the
 * policy, because the two live in different worlds and nothing connects them.
 *
 * A stale privacy policy is not an out-of-date document. It is a false statement
 * that people relied on when deciding to hand over their identity. So each claim
 * gets a test against the thing it describes, and changing the behaviour breaks
 * the build until the promise is updated to match.
 */

const privacy = read('apps/web/src/app/(site)/privacy/page.tsx');

describe('privacy policy claims match the code', () => {
  it('CLAIM: "we do not request the email permission from Discord at all"', () => {
    expect(privacy).toMatch(/do\s+not\s+request\s+the\s+<code>email<\/code>\s+permission/);

    const scopes = read('packages/ed-clients/src/discord/types.ts');
    const declared = /DISCORD_SCOPES = \[([^\]]+)\]/.exec(scopes)?.[1] ?? '';
    expect(declared).not.toMatch(/email/);
    expect(declared).toMatch(/identify/);
    expect(declared).toMatch(/guilds\.members\.read/);

    // Nor may it be smuggled in at the authorize step.
    expect(read('apps/api/src/auth/discord.service.ts')).not.toMatch(/'email'|"email"/);
  });

  it('CLAIM: the credit balance is the ONE switch that starts off', () => {
    /*
     * ★ CHANGED 2026-07-31, AND THE POLICY CHANGED WITH IT ★
     *
     * Squadron owner: "default all privacy options to on except balance, they can opt into that!"
     *
     * The previous claim was that EVERY switch started off, and it was true. Flipping the defaults
     * without rewriting the policy would have turned a published promise into a false statement —
     * which is exactly what this file exists to prevent, and it caught it.
     *
     * The balance is the sole exception now, so it is asserted alone and precisely: wealth invites
     * comparison, and in a squadron that includes minors it invites attention nobody asked for.
     */
    const schema = read('ssot/03-data/schema.prisma');
    const model = /model PrivacySetting \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';
    expect(model).not.toBe('');

    expect(model).toMatch(/showCredits\s+Boolean\s+@default\(false\)/);
    // And the policy must say so, in the same words a member would search for.
    expect(privacy).toMatch(/credit balance is the exception/i);
    expect(privacy).toMatch(/starts switched/i);
  });

  it('CLAIM: the other visibility switches are on, and the policy says so', () => {
    /*
     * The inverse guard. If somebody later flips these back to false, the policy would again be
     * wrong — in the opposite direction, telling members their data is shown when it is not.
     * Both directions are a lie; both fail here.
     */
    const schema = read('ssot/03-data/schema.prisma');
    const model = /model PrivacySetting \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';

    const booleans = [...model.matchAll(/^\s+(show\w+)\s+Boolean\s+(.*)$/gm)];
    expect(booleans.length).toBeGreaterThanOrEqual(6);

    for (const [, name, rest] of booleans) {
      if (name === 'showCredits') continue;
      expect(rest, `${name ?? '?'} must default to true`).toMatch(/@default\(true\)/);
    }

    expect(privacy).toMatch(/visible to other members by default/i);
    // The old promise must be GONE, not merely contradicted elsewhere on the page.
    expect(privacy).not.toMatch(/every\s+switch\s+starts\s+in\s+the\s+off\s+position/i);
  });

  it('CLAIM: tokens are encrypted with AES-256-GCM before reaching the database', () => {
    expect(privacy).toMatch(/AES-256-GCM/);
    const crypto = read('packages/shared/src/server/crypto.ts');
    expect(crypto).toMatch(/'aes-256-gcm'/);
    // 32-byte key, i.e. actually 256-bit rather than merely named so.
    expect(crypto).toMatch(/KEY_BYTES = 32/);
  });

  it('CLAIM: a stolen row cannot be replayed against another account', () => {
    expect(privacy).toMatch(/cannot\s+be\s+replayed\s+against\s+a\s+different\s+account/);
    // The property depends on the ciphertext being bound to the subject as AAD.
    expect(read('packages/shared/src/server/crypto.ts')).toMatch(/setAAD/);
    expect(read('apps/api/src/auth/discord.service.ts')).toMatch(
      /CTX_REFRESH = \(discordUserId: string\)/,
    );
  });

  it('CLAIM: web fonts are served from our own server, not Google', () => {
    // \s+ throughout: the source is prettier-wrapped, so a claim can be split
    // across lines at any point. Matching on exact spacing makes the test fail
    // on reformatting rather than on a broken promise.
    expect(privacy).toMatch(/served\s+from\s+our\s+own\s+server\s+rather\s+than\s+Google/);
    const layout = read('apps/web/src/app/layout.tsx');
    // next/font self-hosts at build time. A raw <link> to Google would leak the
    // visitor's IP and user-agent to a third party on every page load.
    expect(layout).toMatch(/from 'next\/font\/google'/);
    expect(layout).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('CLAIM: there are no third-party analytics or advertising trackers', () => {
    expect(privacy).toMatch(/no\s+trackers,\s+no\s+advertising\s+pixels\s+and\s+no\s+analytics/);
    const webSrc = ['apps/web/src/app/layout.tsx', 'apps/web/src/app/(site)/page.tsx']
      .map(read)
      .join('\n');
    for (const tracker of [
      'googletagmanager',
      'google-analytics',
      'gtag(',
      'facebook.net',
      'hotjar',
      'segment.com',
      'mixpanel',
      'plausible',
    ]) {
      expect(webSrc.toLowerCase()).not.toContain(tracker);
    }
  });

  it('CLAIM: tenure is calculated fresh rather than stored, so it cannot drift', () => {
    expect(privacy).toMatch(/calculated\s+fresh\s+each\s+time\s+rather\s+than\s+stored\s+as\s+a\s+rank/);
    const schema = read('ssot/03-data/schema.prisma');
    const user = /model User \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';
    expect(user).not.toMatch(/tenureRank|tenure_rank/);
  });
});

describe('the policies are reachable', () => {
  it('is linked from the site footer, which renders on every page', () => {
    // A policy nobody can find is a policy nobody consented to.
    // Matches the PATH, not a literal href attribute. The footer builds its
    // link lists with .map(), so `href="/privacy"` no longer appears verbatim
    // in the source — the original assertion failed on a refactor that had not
    // removed anything. The rendered-output check lives in the web suite, where
    // the footer is actually rendered.
    const chrome = read('apps/web/src/components/site-chrome.tsx');
    expect(chrome).toContain("'/privacy'");
    expect(chrome).toContain("'/terms'");
    expect(read('apps/web/src/app/(site)/layout.tsx')).toMatch(/<SiteFooter \/>/);

    /*
     * ★ AND FROM INSIDE THE MEMBERS' AREA, WHICH HAS ITS OWN CHROME ★
     *
     * This assertion is here because splitting the app into `(site)` and `(hub)`
     * route groups silently removed the footer — and the only link to either
     * policy — from every signed-in page. Nothing errored; the links simply
     * stopped existing for the people who spend the most time on the site.
     *
     * Checking only the public layout would have let that pass, which is how it
     * got there in the first place.
     */
    const hub = read('apps/web/src/components/hub-shell.tsx');
    expect(hub).toContain('href="/privacy"');
    expect(hub).toContain('href="/terms"');
  });

  it('both pages carry a version and a date, so a change is visible', () => {
    for (const p of ['apps/web/src/app/(site)/privacy/page.tsx', 'apps/web/src/app/(site)/terms/page.tsx']) {
      const src = read(p);
      expect(src).toMatch(/version="\d+\.\d+"/);
      expect(src).toMatch(/updated="\d{1,2} \w+ \d{4}"/);
    }
  });
});
