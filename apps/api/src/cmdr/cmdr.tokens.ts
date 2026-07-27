/** DI token. Symbol, not the class — esbuild emits no decorator metadata (P1.2). */
export const CMDR_SERVICE = Symbol('CmdrService');

export type { CmdrService, ClaimRecord, QueueEntry, CmdrStore } from './cmdr.service.js';
