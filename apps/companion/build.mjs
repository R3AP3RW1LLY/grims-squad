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
  /*
   * ★ koffi STAYS OUTSIDE THE BUNDLE ★
   *
   * It resolves a platform-specific `.node` binary at runtime, and esbuild has no loader for one —
   * bundling it fails outright. External means the require survives into dist/main.cjs and Node
   * resolves it from node_modules the way koffi expects, picking the right prebuild for the
   * platform.
   *
   * Consequence for packaging: electron-builder must NOT pack it into the asar. See asarUnpack in
   * electron-builder.yml — a `.node` inside an asar cannot be dlopen'd.
   */
  external: ['electron', 'koffi'],
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });

/*
 * The two renderers, bundled as browser ESM.
 *
 * ★ A DIFFERENT TARGET FROM THE TWO ABOVE, AND IT MATTERS ★
 *
 * Those are Node running inside Electron's main process. These run in a Chromium page with
 * `nodeIntegration: false` and `sandbox: true` — there is no `require`, no `process`, and no module
 * resolution. `platform: 'browser'` and `format: 'esm'` produce a single file the page can load with
 * one <script type="module">, which is the only shape that works under that CSP.
 *
 * Preact rather than React: ~4KB against ~140KB, in an app whose entire dependency list was two
 * packages, for a UI that is a nav shell and some panels. `jsx: automatic` with `jsxImportSource`
 * means no `h` import in every file and no pragma comments.
 */
const renderer = {
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  // Sourcemaps are worth their size here: an exception inside a transparent overlay window has no
  // console anybody will look at, so the stack in the log is the only diagnosis available.
  sourcemap: true,
  minify: true,
  logLevel: 'info',
};

await mkdir('dist/renderer', { recursive: true });

await build({ ...renderer, entryPoints: ['src/renderer/app.tsx'], outfile: 'dist/renderer/app.js' });
await build({
  ...renderer,
  entryPoints: ['src/renderer/overlay.tsx'],
  outfile: 'dist/renderer/overlay.js',
});

await cp('src/renderer/index.html', 'dist/renderer/index.html');
await cp('src/renderer/overlay.html', 'dist/renderer/overlay.html');

/*
 * The theme, as a plain file rather than an import.
 *
 * ★ NOT `import './theme.css'` FROM app.tsx ★
 *
 * esbuild's css loader would emit `dist/renderer/app.css` and then NOT inject it — so a <link> tag
 * would still be needed, and a second file named app.css would collide with the bundle's own
 * output. One copy and one <link> is the entire mechanism, and it is the one both HTML shells
 * already expect.
 */
await cp('src/renderer/theme.css', 'dist/renderer/theme.css');

/*
 * The brand fonts, copied from the website's own set.
 *
 * ★ BUNDLED, NOT FETCHED ★
 *
 * The window's CSP is `default-src 'none'` and the app is expected to work with no network at all —
 * a member whose connection is down should still see the app they installed, not a fallback face.
 * Fetching from Google Fonts would also announce every launch of this app to a third party, from a
 * desktop program that has no other reason to talk to anyone but us.
 *
 * The same files the site serves, so "matches the website" is literal rather than approximate.
 */
await cp('src/renderer/fonts', 'dist/renderer/fonts', { recursive: true });

/*
 * The squadron lockup for the login screen. Exported once from `brand/full-logo.png` — trimmed of
 * its transparent margin and resized to 640px wide, which is twice the 320px it renders at so it
 * stays sharp on a high-DPI screen.
 */
await cp('src/renderer/img', 'dist/renderer/img', { recursive: true });

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


