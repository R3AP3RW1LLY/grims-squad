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
</style>
</head>
<body>
<h1>${esc(plan.systemName)}</h1>
<p class="sub">
  Build book for ${esc(plan.architect)} &middot; generated ${esc(plan.generatedAt.toISOString().slice(0, 10))}
</p>

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
