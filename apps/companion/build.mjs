import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Bundles the Electron halves to CommonJS.
 *
 * ★ WHY BUNDLE RATHER THAN JUST RUN tsc ★
 *
 * A preload script running with `sandbox: true` MUST be CommonJS — Electron
 * loads it in a context with no ESM loader at all. And the main process pulls
 * in @grims/shared, a workspace package that would otherwise have to be
 * resolvable from inside a packaged asar, which it is not.
 *
 * Bundling makes both problems disappear: two self-contained .cjs files with
 * nothing to resolve at runtime except electron itself.
 */

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Provided by the runtime. Bundling it would pull a copy of Electron's own
  // API surface into the file, which does not work and is not small.
  external: ['electron'],
  logLevel: 'info',
};

const TRAY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAOElEQVR42mP4X8jAgIT/U4jhZlHTUBTDqW0o3HBaGArGowaPGjxq8KjBowaTbDDNCnqaVk1Ur0wBkRKCMUOoeWwAAAAASUVORK5CYII=';

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });

await mkdir('dist/renderer', { recursive: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');

/*
 * The tray icon.
 *
 * Generated rather than committed as a binary: a 22px orange square is the
 * placeholder until somebody draws the squadron badge, and a checked-in PNG
 * nobody can diff is a worse placeholder than eleven lines of code.
 */
if (!existsSync('dist/renderer/tray.png')) {
  await writeFile('dist/renderer/tray.png', Buffer.from(TRAY_PNG_BASE64, 'base64'));
}
