/**
 * The privacy controls live ON Commander Management, not in a tab of their own.
 *
 * Squadron owner, 2026-07-29: "merge this content: /settings/commander?tab=privacy
 * into this: /settings/commander and delete the privacy tab when done".
 *
 * ★ WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST ★
 *
 * The page is an async server component that fetches four endpoints before it
 * renders anything. Standing all of that up in jsdom would test the mocks. What
 * can actually regress here is somebody re-adding the tab, or moving the
 * controls back out — both of which are visible in the source, and neither of
 * which any other test would notice.
 *
 * The merged page was verified against the running dev server when it landed;
 * this is the guard that keeps it merged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

/**
 * Comments are stripped before matching.
 *
 * The file explains AT LENGTH why privacy is no longer a tab, and the word
 * "privacy" appears throughout that explanation. A test that searched the raw
 * text would fail on the very comment documenting the change.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('Commander Management page', () => {
  const page = code(read('./page.tsx'));

  it('does not offer Privacy as a tab', () => {
    expect(page).not.toMatch(/key:\s*'privacy'/);
  });

  it('still offers the tabs that were not merged away', () => {
    for (const key of ['settings', 'verification', 'security', 'account']) {
      expect(page).toMatch(new RegExp(`key:\\s*'${key}'`));
    }
  });

  it('renders the privacy controls on the page itself', () => {
    expect(page).toContain('<PrivacyControls />');
    expect(page).toMatch(/import\s*\{[^}]*PrivacyControls[^}]*\}\s*from\s*'\.\.\/privacy\/body'/);
  });

  it('summarises what is shared in the rail', () => {
    expect(page).toContain('Fields shared');
    expect(page).toMatch(/sharedFields\(/);
  });

  /*
   * An old bookmark or a link in somebody's Discord message must not 404.
   * `resolveTab` falls back to the first tab for anything unrecognised, and the
   * first tab is now the one holding the controls — so `?tab=privacy` lands on
   * the same switches it always did.
   */
  it('leaves unknown tabs to fall back rather than 404', () => {
    expect(page).toMatch(/resolveTab/);
  });

  it('keeps the old route working as a redirect', () => {
    const old = code(read('../privacy/page.tsx'));
    expect(old).toMatch(/redirect\(\s*'\/settings\/commander'\s*\)/);
  });
});

describe('privacy controls', () => {
  const body = code(read('../privacy/body.tsx'));

  /*
   * It used to render a whole `PageBody` — its own lead, its own rail. Dropped
   * into a page that already has both, that produced two of each. It must stay
   * a Section.
   */
  it('is a Section, not a second page body', () => {
    expect(body).not.toContain('PageBody');
    expect(body).toContain('<Section');
  });
});
