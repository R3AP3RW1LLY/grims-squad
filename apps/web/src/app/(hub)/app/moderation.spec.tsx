import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'moderation.tsx'), 'utf8');
const LOG = readFileSync(resolve(HERE, 'ai-log.tsx'), 'utf8');
const PAGE = readFileSync(resolve(HERE, 'page.tsx'), 'utf8');

/**
 * Strips comments, so a guard tests behaviour rather than the prose describing it.
 *
 * This file is mostly about properties that are explained at length in the source. Matching a bare
 * keyword catches those explanations first and reports them as violations — which is how a guard
 * earns a reputation for crying wolf and gets removed.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The moderation queue's promises, held as source guards.
 *
 * ★ WHY GUARDS RATHER THAN RENDERED ASSERTIONS ★
 *
 * These are not "does it render" questions — they are properties that must survive somebody
 * tidying this file a year from now, and each one is invisible when broken:
 *
 *   a truncated post   still looks like a queue, and produces decisions made without reading
 *   a merged list      still looks like a queue, and buries unjudged posts inside flagged ones
 *   a leaked category  looks like helpfulness, and teaches people which wording gets through
 *
 * Rendering tests would not catch any of the three, because all three still render fine.
 */

describe('the two reasons a post is held stay separate', () => {
  it('MANDATORY: flagged and unavailable are triaged as distinct groups', () => {
    /*
     * Forty posts held because a GPU was off is a completely different afternoon from forty the
     * model flagged. Merging them buries the second kind — which is usually FINE and just needs a
     * glance — inside the first, which needs real reading.
     */
    expect(SOURCE).toMatch(/reason === 'flagged'/);
    expect(SOURCE).toMatch(/reason === 'unavailable'/);
  });

  it('says plainly that unjudged posts carry no verdict', () => {
    // An officer who thinks the model objected to these will read them far more suspiciously than
    // they deserve.
    expect(SOURCE).toMatch(/could not be reached/i);
  });
});

describe('what the author must never learn', () => {
  it('MANDATORY: the model’s reason is rendered only in the queue', () => {
    /*
     * Owner's decision: the author is told their post is held and nothing more. Naming the category
     * teaches anybody determined exactly which wording gets through, and they can retry freely.
     * `modelReason` appearing anywhere outside this admin-only component would leak it.
     */
    expect(SOURCE).toContain('modelReason');
    expect(PAGE).not.toContain('modelReason');
  });
});

describe('the post is shown in full', () => {
  it('MANDATORY: no truncation of the body', () => {
    /*
     * A queue showing an excerpt makes people click through to decide — and somebody deciding
     * without reading is the exact failure this feature exists to prevent. If a length limit ever
     * appears on the body, this fails.
     */
    const bodyRender = SOURCE.slice(SOURCE.indexOf('dangerouslySetInnerHTML'));
    expect(bodyRender).toContain('post.bodyHtml');
    expect(bodyRender.slice(0, 200)).not.toMatch(/slice\(|substring\(|truncate/);
  });
});

describe('deciding', () => {
  it('MANDATORY: both outcomes exist and are distinguishable', () => {
    expect(SOURCE).toContain("'release'");
    expect(SOURCE).toContain("'refuse'");
  });

  it('surfaces the server’s own message rather than a generic one', () => {
    /*
     * The likeliest failure is two officers working the queue at once. "That post is not waiting
     * for review" explains it; "something went wrong" starts a bug report.
     */
    expect(SOURCE).toMatch(/e instanceof Error \? e\.message/);
  });

  it('MANDATORY: a decided post is not silently removed from view', () => {
    // A row vanishing on click gives no confirmation the right one went, and no way to notice a
    // misclick — which on a refusal is somebody's post destroyed by accident.
    expect(SOURCE).toMatch(/Decided just now/);
  });

  it('disables the buttons while a decision is in flight', () => {
    // Double-clicking "Refuse" must not race two writes at the same post.
    expect(SOURCE).toMatch(/disabled=\{busy !== null\}/);
  });
});

describe('the live log', () => {
  it('MANDATORY: does no redaction of its own', () => {
    /*
     * Paths are stripped server-side at AiStreamService.emit — one funnel, structurally. A second,
     * weaker redactor here would invite somebody to rely on it, and the client is not where that
     * guarantee can live anyway.
     *
     * Checked against CODE only. The first version of this guard matched the word "redactor" in the
     * comment above explaining why there is none, and failed — a guard that cannot tell prose from
     * behaviour is one that gets deleted rather than fixed.
     */
    expect(codeOf(LOG)).not.toMatch(/redact|<path>|C:\\\\/i);
  });

  it('MANDATORY: is always on, never opt-in', () => {
    /*
     * Squadron owner, 2026-07-31: "The LIVE AI Log must always be on ... this is non-negotiable".
     *
     * It WAS opt-in, and that was wrong for the job. A post was reported as "not screened", and
     * with the panel disconnected there is no way to distinguish screening working, screening
     * failing, and screening never running. A monitor you have to switch on says nothing about the
     * minutes before you switched it on.
     */
    // A constant, not state: there is no setter, so no disconnect control can be wired to one.
    expect(codeOf(LOG)).toMatch(/const open = true/);
    expect(codeOf(LOG)).not.toMatch(/Disconnect/);
  });

  it('MANDATORY: shows a heartbeat, so an idle log is not ambiguous', () => {
    /*
     * "show pings that keep it alive". A silent log otherwise means either "nothing happened" or
     * "this is dead", which need opposite reactions. With pings arriving, silence becomes evidence.
     */
    const warmer = readFileSync(
      resolve(HERE, '../../../../../../apps/api/src/ai/ai.module.ts'),
      'utf8',
    );
    expect(warmer).toMatch(/kind: 'health'/);
    expect(warmer).toMatch(/model warm/);
    // And it must report the failure, not only the success — that is the useful ping.
    expect(warmer).toMatch(/did not answer/);
  });

  it('MANDATORY: says out loud when screening is not configured at all', () => {
    // The most dangerous quiet state: every post publishing unscreened, and an empty log that
    // looks exactly like a quiet evening.
    const warmer = readFileSync(
      resolve(HERE, '../../../../../../apps/api/src/ai/ai.module.ts'),
      'utf8',
    );
    expect(warmer).toMatch(/without screening/);
  });

  it('bounds what a tab left open all evening accumulates', () => {
    // The server's ring buffer bounds what a NEW subscriber receives; it does nothing about a
    // browser holding every line since morning.
    expect(LOG).toMatch(/MAX_LINES/);
    /*
     * ★ slice(0, MAX), NOT slice(-MAX) — AND THE DIRECTION IS THE POINT ★
     *
     * Squadron owner, 2026-08-01: "newest logs need to be at the top". Lines are PREPENDED now, so
     * the oldest sit at the end of the array and `slice(0, MAX)` is what discards them. The old
     * `slice(-MAX)` would keep the tail — which, with the order reversed, means throwing away
     * everything that just happened and keeping the oldest thousand for ever.
     */
    expect(LOG).toMatch(/slice\(0, MAX_LINES\)/);
    expect(LOG).toMatch(/\[line, \.\.\.prev\]/);
  });

  it('closes the stream when the panel is unmounted', () => {
    // Otherwise every visit to the tab leaves a connection behind on both ends.
    expect(LOG).toMatch(/return \(\) => source\.close\(\)/);
  });

  it('describes a dropped connection as reconnecting, not failed', () => {
    // EventSource reconnects by itself. "Error" sends somebody investigating a stream that is
    // already coming back — and on an always-on panel that would happen on every network blip.
    expect(LOG).toMatch(/reconnecting/i);
  });
});

describe('the tab itself', () => {
  it('MANDATORY: is registered, or nothing above is reachable', () => {
    expect(PAGE).toMatch(/key: 'moderation'/);
    expect(PAGE).toContain('<Moderation');
  });

  it('fetches the queue only when the tab is showing', () => {
    // Every other tab pays nothing for this one. Matches how the existing tabs are written.
    expect(PAGE).toMatch(/tab === 'moderation' \? getHeldPosts\(\)/);
  });

  it('MANDATORY: a missing health read does not lock the tab', () => {
    /*
     * `locked` gates on the QUEUE only. Health returning null means the health route refused or the
     * API did not answer — neither is a reason to hide a queue that loaded perfectly well, and
     * gating on it would show a two-factor prompt for an unrelated fault.
     */
    const lockedBlock = PAGE.slice(PAGE.indexOf('const locked ='), PAGE.indexOf('if (locked)'));
    expect(lockedBlock).toContain("tab === 'moderation' && held === null");
    expect(lockedBlock).not.toContain('aiHealth');
  });
});
