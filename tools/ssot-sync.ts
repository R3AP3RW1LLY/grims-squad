#!/usr/bin/env tsx
/**
 * SSOT SYNC — copy the SSOT sources into their generated locations.
 *
 * This is the ONLY correct direction. If `pnpm ssot:check` fails, run this —
 * never edit the copy to match the SSOT, because that is the drift, not the cure
 * (AGENTS.md §1, ADR-020).
 *
 * To change a contract: edit the ssot/ file, then run this, then let the
 * implementation follow.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const COPIES: ReadonlyArray<{ source: string; copy: string }> = [
  { source: 'ssot/03-data/schema.prisma', copy: 'packages/db/prisma/schema.prisma' },
  { source: 'ssot/04-contracts/permissions.ts', copy: 'packages/shared/src/permissions.ts' },
];

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let changed = 0;

for (const { source, copy } of COPIES) {
  const src = resolve(REPO, source);
  const dst = resolve(REPO, copy);

  if (!existsSync(src)) {
    console.error(`Missing SSOT source: ${source}`);
    process.exit(1);
  }

  const content = readFileSync(src, 'utf8');
  const current = existsSync(dst) ? readFileSync(dst, 'utf8') : null;

  if (current === content) {
    console.log(dim(`  unchanged  ${copy}`));
    continue;
  }

  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, content, 'utf8');
  console.log(`${green('  synced   ')} ${copy}  ${dim(`<- ${source}`)}`);
  changed += 1;
}

console.log('');
if (changed > 0) {
  console.log(green(`Synced ${changed} file(s) from ssot/.`));
  console.log(dim('If schema.prisma changed, generate a migration next:'));
  console.log(dim('  pnpm --filter @grims/db exec prisma migrate dev --create-only'));
  console.log(dim('  ...then add any hand-written DDL from ssot/03-data/indexes.md'));
} else {
  console.log(green('Already in sync.'));
}
