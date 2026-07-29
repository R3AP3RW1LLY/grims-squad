/** DI tokens. Symbols, not classes — esbuild emits no decorator metadata (P1.2). */
export const PAIRING_SERVICE = Symbol('PairingService');
export const INGEST_SERVICE = Symbol('JournalIngestService');
export const CONSENT_SERVICE = Symbol('ConsentService');

export type { PairingService, DeviceTokenRecord } from './pairing.service.js';
export type { JournalIngestService, IncomingEvent } from './journal-ingest.service.js';
