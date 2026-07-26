#!/usr/bin/env tsx
/**
 * SSOT DRIFT CHECK
 *
 * This is the mechanism the entire SSOT model depends on (ADR-019, ADR-020).
 *
 * `ssot/` is the source; several artefacts are copied or generated into the
 * codebase. The moment someone edits the copy instead of the source, `ssot/`
 * stops being the single source of truth and quietly becomes documentation —
 * and nothing announces it. Across many sessions with fresh context, that is not
 * a risk, it is an inevitability unless a machine checks.
 *
 * The fix for a failure here is ALWAYS to change the SSOT first, then re-copy.
 * Editing the copy to match is the drift, not the cure.
 *
 * Exit 0 = in sync. Exit 1 = drift.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Copy {
  readonly source: string;
  readonly copy: string;
  readonly why: string;
}

/** Byte-identical copies. `prisma format` runs on the SSOT side so both are canonical. */
const COPIES: readonly Copy[] = [
  {
    source: 'ssot/03-data/schema.prisma',
    copy: 'packages/db/prisma/schema.prisma',
    why: 'The data model. Rewriting it instead of copying is the #1 P0 failure.',
  },
  {
    source: 'ssot/04-contracts/permissions.ts',
    copy: 'packages/shared/src/permissions.ts',
    why: 'The authorization model. Drift here is a security defect, not a style one.',
  },
];

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let failures = 0;

function fail(title: string, detail: string): void {
  failures += 1;
  console.error(`${red('DRIFT')}  ${title}`);
  console.error(detail.replace(/^/gm, '       '));
  console.error('');
}

function ok(title: string): void {
  console.log(`${green('  ok ')}  ${title}`);
}

// ---------------------------------------------------------------- copies ----
for (const { source, copy, why } of COPIES) {
  const src = resolve(REPO, source);
  const dst = resolve(REPO, copy);

  if (!existsSync(src)) {
    fail(`${source} is missing`, 'The SSOT source does not exist.');
    continue;
  }
  if (!existsSync(dst)) {
    fail(`${copy} is missing`, `Expected a copy of ${source}.\n${why}`);
    continue;
  }

  const a = readFileSync(src, 'utf8');
  const b = readFileSync(dst, 'utf8');

  if (a === b) {
    ok(`${copy} matches ${source}`);
    continue;
  }

  // Point at the first differing line so the fix is obvious.
  const al = a.split('\n');
  const bl = b.split('\n');
  let line = 0;
  while (line < Math.max(al.length, bl.length) && al[line] === bl[line]) line += 1;

  fail(
    `${copy} has drifted from ${source}`,
    [
      why,
      '',
      `First difference at line ${line + 1}:`,
      `  ssot: ${JSON.stringify(al[line] ?? '<end of file>')}`,
      `  copy: ${JSON.stringify(bl[line] ?? '<end of file>')}`,
      '',
      'FIX: change the SSOT file, then re-copy. Never edit the copy to match.',
      '     pnpm ssot:sync',
    ].join('\n'),
  );
}

// ------------------------------------------------- invariants have tests ----
/**
 * Every invariant due by the CURRENT phase must have a passing `@INV-nnn` test.
 *
 * Phasing is not a convenience: demanding all 47 from P0 is unsatisfiable until
 * P8, and the predictable result is that the first agent to hit red CI adds an
 * exemption list — killing the one mechanism that makes invariants real
 * (ARCH-ADV A1).
 */
const PHASE_ORDER = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'] as const;

function currentPhase(): string {
  const status = readFileSync(resolve(REPO, 'ssot/STATUS.md'), 'utf8');
  const m = /^Phase:\s*\*\*(?:pre-)?(P\d)/m.exec(status);
  // "pre-P0" means nothing is due yet.
  if (/^Phase:\s*\*\*pre-/m.test(status)) return 'PRE';
  return m?.[1] ?? 'P0';
}

function phaseIndex(p: string): number {
  return PHASE_ORDER.indexOf(p as (typeof PHASE_ORDER)[number]);
}

const invariantsMd = readFileSync(resolve(REPO, 'ssot/02-domain/invariants.md'), 'utf8');
interface DeclaredInvariant {
  readonly id: string;
  readonly severity: string;
  readonly due: string;
}

const declared: DeclaredInvariant[] = [];
for (const m of invariantsMd.matchAll(/^\*\*INV-(\d{3})\*\*\s+`(\w+)`\s+`due:(P\d)`/gm)) {
  const [, num, severity, due] = m;
  if (num === undefined || severity === undefined || due === undefined) continue;
  declared.push({ id: `INV-${num}`, severity, due });
}

const undeclared = [...invariantsMd.matchAll(/^\*\*INV-(\d{3})\*\*(?!\s+`\w+`\s+`due:P\d`)/gm)];
if (undeclared.length > 0) {
  fail(
    `${undeclared.length} invariant(s) carry no \`due:Pn\` marker`,
    [
      'Every invariant must declare the phase by which it needs a test.',
      'Without it, a new invariant silently skips the coverage gate.',
      `Offending: ${undeclared.map((m) => `INV-${m[1]}`).join(', ')}`,
    ].join('\n'),
  );
}

if (declared.length === 0) {
  fail('No invariants parsed from invariants.md', 'The format may have changed.');
} else {
  const phase = currentPhase();
  const due =
    phase === 'PRE' ? [] : declared.filter((i) => phaseIndex(i.due) <= phaseIndex(phase));
  const notYet = declared.length - due.length;

  // Collect every @INV-nnn tag present in the test suite.
  const tagged = new Set<string>();
  const { globSync } = await import('node:fs');
  const specs = globSync('{apps,packages,tools}/**/*.spec.ts', { cwd: REPO }) as string[];
  for (const f of specs) {
    const body = readFileSync(resolve(REPO, f), 'utf8');
    for (const m of body.matchAll(/@(INV-\d{3})/g)) {
      const id = m[1];
      if (id !== undefined) tagged.add(id);
    }
  }

  const missing = due.filter((i) => !tagged.has(i.id));
  if (missing.length > 0) {
    fail(
      `${missing.length} invariant(s) are due by ${phase} but have no tagged test`,
      [
        'An invariant without a passing @INV-nnn test is an unbuilt invariant (ADR-016).',
        `Missing: ${missing.map((i) => `${i.id} (due ${i.due})`).join(', ')}`,
      ].join('\n'),
    );
  } else {
    ok(
      `invariants: ${due.length} due by ${phase}, ${due.length} covered` +
        (notYet > 0 ? dim(` · ${notYet} not yet due`) : ''),
    );
  }
  // Not-yet-due invariants are reported as a COUNT, never as a pass.
  if (notYet > 0) {
    const upcoming = [...new Set(declared.filter((i) => !due.includes(i)).map((i) => i.due))].sort();
    console.log(dim(`        ${notYet} invariant(s) not yet due (${upcoming.join(', ')})`));
  }
}

// ------------------------------------------------------------------ done ----
console.log('');
if (failures > 0) {
  console.error(red(`SSOT drift check FAILED — ${failures} problem(s).`));
  console.error(dim('The SSOT is the law. Change it first, then let the code follow.'));
  process.exit(1);
}
console.log(green('SSOT drift check passed.'));
