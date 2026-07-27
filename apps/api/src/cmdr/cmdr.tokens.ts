/** DI token. Symbol, not the class — esbuild emits no decorator metadata (P1.2). */
export const CMDR_SERVICE = Symbol('CmdrService');
export const NONCE_SERVICE = Symbol('NonceService');
export const INARA_LINK = Symbol('InaraLinkService');

export type { CmdrService, ClaimRecord, QueueEntry, CmdrStore } from './cmdr.service.js';
export type { NonceService, NonceClaim, CheckResult } from '@grims/shared';
export type { InaraLinkService, LinkStatus } from './inara-link.service.js';
