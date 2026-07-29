import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

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

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });

await mkdir('dist/renderer', { recursive: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');

/*
 * The squadron badge, used for the tray, the taskbar, the window and the
 * installer.
 *
 * Copied from build/ rather than kept in two places: electron-builder already
 * reads build/icon.png for the packaged app and the installer, and a tray icon
 * that drifted out of step with the installer icon would look like two
 * different programs.
 */
await cp('build/tray.png', 'dist/renderer/tray.png');
await cp('build/tray@2x.png', 'dist/renderer/tray@2x.png');
await cp('build/icon.png', 'dist/renderer/icon.png');
/*
 * The .ico as well, for the RUNNING window on Windows.
 *
 * `BrowserWindow({ icon })` given a 512px PNG shows a downscaled mess in the
 * title bar and Alt-Tab. Given an .ico, Windows picks the size it needs.
 * Packaging uses this same file, so the running app and the installed shortcut
 * cannot show different marks.
 */
await cp('build/icon.ico', 'dist/renderer/icon.ico');


