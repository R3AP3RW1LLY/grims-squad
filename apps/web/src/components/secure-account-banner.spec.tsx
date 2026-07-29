import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const banner = readFileSync(resolve(HERE, 'secure-account-banner.tsx'), 'utf8');

/**
 * The source with comments removed.
 *
 * Needed because this file's own prose explains what the banner must NOT do —
 * "not dismissible", "not role=alert" — and asserting against the raw text
 * matches the explanation rather than the code. A test that fails on its own
 * documentation is a test nobody trusts.
 */
const bannerCode = banner
  // Block comments first, then whole-line // comments. Split on a regex rather
  // than a newline literal — a shell heredoc turns the escape into a real
  // newline and breaks the string, which is exactly how this first went wrong.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('//'))
  .join(' ');
const siteLayout = readFileSync(resolve(HERE, '../app/(site)/layout.tsx'), 'utf8');
const hubLayout = readFileSync(resolve(HERE, '../app/(hub)/layout.tsx'), 'utf8');
const onboarding = readFileSync(resolve(HERE, '../app/(site)/onboarding/security/page.tsx'), 'utf8');

/**
 * The secure-your-account prompt.
 *
 * Human decision, 2026-07-27: a standard member goes to their dashboard with a
 * banner under the navbar; an admin is put through a forced flow and cannot
 * reach the admin area until it is done.
 */
describe('the banner', () => {
  it('MANDATORY: renders NOTHING unless the member actually needs securing', () => {
    // Three audiences must never see it: ordinary members, signed-out visitors,
    // and admins who have already enrolled. A banner everybody sees is
    // wallpaper, and wallpaper is not a control.
    expect(banner).toContain('if (status === null || !status.needsSecuring) return null;');
  });

  it('MANDATORY: is not dismissible', () => {
    // A dismiss button on a security prompt is a button that turns the prompt
    // off. Tolerable only because it is scoped to the few people it applies to.
    expect(bannerCode).not.toMatch(/dismiss|onClose|setHidden|localStorage/i);
  });

  it('MANDATORY: does not call the API for an anonymous visitor', () => {
    // It renders in the ROOT LAYOUT, so it runs on the public landing page too.
    // An unconditional call would add a round trip to every anonymous render to
    // be told there is no session — a cost paid by the visitors it can never
    // apply to. The cookie check is a precondition, NOT a security check: the
    // API still authenticates whatever request follows.
    expect(bannerCode).toContain('if (!hasSession) return null;');
    const cookieAt = bannerCode.indexOf('hasSession');
    const fetchAt = bannerCode.indexOf('getAccountStatus()');
    expect(cookieAt).toBeLessThan(fetchAt);
  });

  it('links to the forced flow, not to a settings page', () => {
    // The whole point of the decision: no clicking around to find things.
    expect(banner).toContain('href="/onboarding/security"');
  });

  it('does not interrupt a screen reader on every page load', () => {
    // role="alert" fires an interruption each time. This is important and not
    // urgent — a labelled region says so without hijacking.
    expect(bannerCode).toContain('role="region"');
    expect(bannerCode).not.toContain('role="alert"');
  });

  it('MANDATORY: lives in a LAYOUT, under the navbar, on the public site', () => {
    // In a layout it follows the member everywhere. Per-page, it becomes
    // something each future page author has to remember, which means it will
    // eventually be missing from the page that mattered.
    expect(siteLayout).toContain('<SecureAccountBanner />');
    const navAt = siteLayout.indexOf('<SiteNav />');
    const bannerAt = siteLayout.indexOf('<SecureAccountBanner />');
    expect(bannerAt).toBeGreaterThan(navAt);
  });

  it('MANDATORY: is in the MEMBERS AREA layout too', () => {
    /*
     * Caught by this test during the route-group split, which is the only
     * reason it is not a live bug.
     *
     * Splitting the chrome into (site) and (hub) left the banner behind on the
     * public side — and the members area is where an unsecured admin actually
     * LANDS after signing in. The prompt would have been missing from the one
     * place it exists to appear.
     */
    expect(hubLayout).toContain('<SecureAccountBanner />');
  });
});

describe('the forced onboarding page', () => {
  it('MANDATORY: sends an already-enrolled member onward instead of showing a done form', () => {
    // A page saying "you already did this" is a dead end wearing a hat.
    expect(onboarding).toContain('if (totp.enrolled) redirect(');
  });

  it('MANDATORY: does not trap an ordinary member who lands on it', () => {
    // Two-factor is an obligation for people who can affect others. Anyone else
    // arriving here by a stray link should simply be moved along.
    expect(onboarding).toContain("if (!status.privileged) redirect('/dashboard');");
  });

  it('explains WHY, by naming the permissions held', () => {
    // "Secure your account" alone is an instruction. Naming what they hold
    // makes it an explanation, and people act on explanations.
    expect(onboarding).toContain('status.because');
  });

  it('MANDATORY: is accurate about what IS blocked', () => {
    /*
     * It used to say "nothing else on the site is blocked", which stopped
     * being true the moment the members area started redirecting here. A
     * reassurance that is false is worse than none — somebody reads it, tries
     * their dashboard, gets bounced back, and concludes the site is broken.
     *
     * The public site genuinely IS still open, so that is what it now says.
     */
    expect(onboarding).toMatch(/public site is still open/i);
    expect(onboarding).not.toMatch(/Nothing else on the site is blocked/i);
  });

  it('MANDATORY: the members area redirects until the member owes nothing', () => {
    /*
     * Not a banner, not a nudge — a redirect on every page under the (hub)
     * layout, until every obligation is met.
     *
     * The layout no longer names a specific step. There are three now, in an
     * order that matters, and the ORDER is decided once on the server
     * (onboarding-gate.ts, with its own tests) rather than re-derived here.
     * Two copies of a rule this fiddly drift, and the symptom is a member
     * bounced between two pages that each think the other should have run.
     */
    expect(hubLayout).toContain('me.onboarding.path');
    expect(hubLayout).toMatch(/redirect\(me\.onboarding\.path\)/);
  });

  it('MANDATORY: the redirect is unconditional on the path being set', () => {
    /*
     * The failure this forecloses: a well-meaning `&& somethingElse` added to
     * the condition, which would let one class of member past the wall while
     * the code still LOOKED like it gated everybody.
     */
    const guard = hubLayout.slice(
      hubLayout.indexOf('me.onboarding.path'),
      hubLayout.indexOf('redirect(me.onboarding.path)'),
    );
    expect(guard).not.toMatch(/&&|\|\|/);
  });
});
