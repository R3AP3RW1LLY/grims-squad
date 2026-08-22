/**
 * The build book — a plan as one printable file.
 *
 * ★ SQUADRON OWNER ★
 *
 * "the build guide generator is also not anywhere i can find it?"
 *
 * It was never built. What existed were one-off scripts in a scratch directory reading hardcoded
 * JSON off one machine, printing one system's book once. This produces the same document from a
 * plan that lives in the database, for any system, on demand.
 *
 * ★ WHY IT IS ONE SELF-CONTAINED FILE ★
 *
 * It is downloaded, opened from a folder, and printed — often on a second machine, often offline.
 * Every external stylesheet, script or image is a page that renders differently, or blank, at
 * exactly the moment somebody needs it. So everything is inline and nothing is fetched.
 *
 * ★ AND WHY THE IDS MATTER MORE THAN THE PROSE ★
 *
 * A member reads this beside the game, with the planner in a browser they cannot see at the same
 * time. Every row carries its build id and body id so it can be typed straight into the game's own
 * planner. A row without them is a row somebody has to go and look up — which is the work the book
 * exists to remove.
 */

export interface BookSite {
  /** Build order. The sequence the plan says to build in. */
  readonly order: number;
  /** The game's own id for the structure, e.g. `hermes`. Typed into the planner verbatim. */
  readonly buildId: string;
  readonly displayName: string;
  /** The body it goes on, in the game's spelling, e.g. `B 8 a`. */
  readonly body: string;
  readonly tier: number;
  readonly totalTonnes: number;
  readonly built: boolean;
}

export interface BookPlan {
  readonly systemName: string;
  readonly architect: string;
  readonly generatedAt: Date;
  readonly sites: readonly BookSite[];
  /**
   * What this system is for, and what would make it a bad idea.
   *
   * ★ SQUADRON OWNER, 2026-08-18 ★
   *
   * The books written by hand for the Col 285 systems led with the reasoning and only then gave the
   * build order, because somebody reading a printed sheet in a cockpit needs to know WHY before
   * they need to know what is next.
   *
   * Optional: a plan for a system nobody has surveyed still prints its build order, and a book that
   * refused to render without advice would be worse than one that renders without it.
   */
  readonly advice?: BookAdvice | undefined;
}

/** The reasoning half of a book. Computed facts and, where there is one, the assistant's paragraph. */
export interface BookAdvice {
  readonly headline: string | null;
  /** Computed from the survey, so it is safe to print as fact. */
  readonly reasons: readonly string[];
  /**
   * Printed in their OWN block rather than mixed into the reasons.
   *
   * A book is read away from the screen, with nobody to ask. "Four ringed gas giants" and "every
   * body is 194,000 Ls out" are both true and only one of them decides whether to go — so the
   * objection cannot be a bullet among strengths.
   */
  readonly warnings: readonly string[];
  readonly prose: string;
}

/**
 * Names arrive from the planner, where a member typed them.
 *
 * This document is written to disk and opened in a browser. A book that executes what somebody put
 * in a plan name is one that cannot be handed round the squadron.
 */
const esc = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Six digits unspaced are misread, and these are the numbers people plan hauling runs around. */
const num = (n: number): string => Number(n).toLocaleString('en-GB');

/**
 * The reasoning, printed before the build order.
 *
 * ★ WHY IT COMES FIRST ★
 *
 * The books written by hand for the Col 285 systems opened with what the system is FOR and only
 * then listed what to build, because a printed sheet is read away from the screen with nobody to
 * ask. Somebody who knows why they are going can adapt when the plan meets reality; somebody
 * holding an ordered list cannot.
 *
 * ★ AND WHY THE WARNINGS ARE THEIR OWN BLOCK ★
 *
 * "Four ringed gas giants" and "every body is 194,000 Ls out" are both true, and only one of them
 * decides whether to go. Mixed into a list of strengths the objection reads as a caveat; on its own,
 * above the build order, it reads as what it is.
 *
 * Empty string when there is no advice — a plan for an unsurveyed system still prints its builds.
 */
function renderAdvice(advice: BookAdvice | undefined): string {
  if (advice === undefined) return '';

  const warnings =
    advice.warnings.length === 0
      ? ''
      : `<div class="warn"><strong>Before you commit to this system</strong><ul>${advice.warnings
          .map((w) => `<li>${esc(w)}</li>`)
          .join('')}</ul></div>`;

  const reasons =
    advice.reasons.length === 0
      ? ''
      : `<ul class="reasons">${advice.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;

  const prose =
    advice.prose === ''
      ? ''
      : `<div class="prose">${advice.prose
          // Split on a regex, not a newline literal: writing this file through a shell heredoc ate
          // the escape and left an unterminated string. Same trap the bytea guard records.
          .split(/\r?\n/)
          .filter((line) => line.trim() !== '')
          .map((line) => `<p>${esc(line)}</p>`)
          .join('')}</div>`;

  return `<section class="advice">
    ${advice.headline === null ? '' : `<h2>${esc(advice.headline)}</h2>`}
    ${warnings}
    ${reasons}
    ${prose}
  </section>`;
}

export function renderBuildBook(plan: BookPlan): string {
  /*
   * The total is what is LEFT, not what the system will eventually contain. Including finished
   * sites would overstate the remaining work by everything already delivered — on the one document
   * somebody carries away from the screen that could have corrected it.
   */
  const outstanding = plan.sites
    .filter((s) => !s.built)
    .reduce((sum, s) => sum + s.totalTonnes, 0);

  const rows =
    plan.sites.length === 0
      ? `<tr><td colspan="6" class="empty">Nothing planned in this system yet.</td></tr>`
      : [...plan.sites]
          .sort((a, b) => a.order - b.order)
          .map(
            (s) => `<tr class="${s.built ? 'done' : ''}">
    <td class="n">${s.order}</td>
    <td>${esc(s.displayName)}</td>
    <td class="id">${esc(s.buildId)}</td>
    <td class="id">${esc(s.body)}</td>
    <td class="n">T${s.tier}</td>
    <td class="n">${num(s.totalTonnes)}${s.built ? ' <span class="tag">built</span>' : ''}</td>
  </tr>`,
          )
          .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(plan.systemName)} — build book</title>
<style>
  /*
   * Inline, and deliberately plain. This is printed as often as it is read on a screen, and a
   * design that depends on a colour it cannot print is a design that fails on paper.
   */
  :root { color-scheme: light; }
  body { font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 19px; margin: 0 0 2px; letter-spacing: 0.04em; }
  .sub { color: #555; margin: 0 0 18px; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #555; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* The ids are the working part of every row, so they are set apart from the prose. */
  .id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
  .done { color: #777; }
  .done td { text-decoration: line-through; }
  .tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; text-decoration: none; }
  .empty { color: #777; font-style: italic; }
  .total { margin-top: 16px; font-size: 13px; }
  @media print {
    /* Printed, this is carried to a desk. Margins come from the printer, and rows must not split. */
    body { margin: 0; }
    tr { break-inside: avoid; }
    thead { display: table-header-group; }
  }
  .advice { margin: 0 0 6mm; }
  .advice h2 { font-size: 12pt; margin: 0 0 2mm; }
  .advice .reasons { margin: 0 0 3mm; padding-left: 5mm; font-size: 10pt; }
  .advice .prose p { margin: 0 0 2mm; font-size: 10pt; }
  /* Its own box, above the build order -- see renderAdvice for why. */
  .warn { border-left: 2.5pt solid #b4501e; background: #fbf4ef; padding: 2.5mm 4mm; margin: 0 0 3mm; }
  .warn ul { margin: 1.5mm 0 0; padding-left: 5mm; font-size: 10pt; }
</style>
</head>
<body>
<h1>${esc(plan.systemName)}</h1>
<p class="sub">
  Build book for ${esc(plan.architect)} &middot; generated ${esc(plan.generatedAt.toISOString().slice(0, 10))}
</p>
${renderAdvice(plan.advice)}
<table>
  <thead>
    <tr><th class="n">#</th><th>Structure</th><th>Build id</th><th>Body</th><th class="n">Tier</th><th class="n">Tonnes</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>

<p class="total"><strong>${num(outstanding)} t</strong> still to deliver across ${plan.sites.filter((s) => !s.built).length} outstanding site(s).</p>
</body>
</html>
`;
}
