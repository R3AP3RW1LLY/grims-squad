/**
 * DI token for the members store.
 *
 * A symbol rather than the class, because the controller depends on the
 * INTERFACE and esbuild does not emit decorator metadata — Nest cannot infer a
 * provider from an interface type, and injecting the concrete class would make
 * the controller untestable without a database (found the hard way in P1.2,
 * where every route 500ed under tsx but passed under tsc).
 */
export const MEMBERS_STORE = Symbol('MembersStore');
export const ACCOUNT_STORE = Symbol('AccountStore');

export type { MembersStore, MemberRow } from './members.store.js';
export type { AccountStore, SessionSummary, ExportBundle } from './account.store.js';
