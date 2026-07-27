/** DI token. Symbol, not the class — esbuild emits no decorator metadata (P1.2). */
export const ADMIN_STORE = Symbol('AdminStore');
export type { AdminStore, ActivityRow, MemberRow, AuditRow } from './admin.store.js';
