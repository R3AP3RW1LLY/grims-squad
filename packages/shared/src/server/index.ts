// Server-only surface of @grims/shared. Imported as `@grims/shared/server`.
//
// Kept behind a subpath because it pulls in `node:crypto`. The root entry is
// bundled into the browser, and a Node builtin reaching that bundle is either a
// build failure or — worse — a polyfilled cipher doing something unintended.
export * from './crypto.js';
