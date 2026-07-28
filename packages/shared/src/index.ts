// @grims/shared — Zod schemas, DTOs, enums and the permission bitmask.
// Used by BOTH ends. A DTO changes here and both fail to compile until they agree.
export * from './permissions.js';
export * from './errors.js';
export * from './dto/common.js';
export * from './redirect.js';

export {
  EARLIEST_PROMOTION_AT,
  PromotionsNotYetPermittedError,
  assertPromotionsPermitted,
  promotionsPermitted,
} from './promotion-floor.js';

export { NonceService, formatNonce, NONCE_TTL_MS } from './nonce.service.js';
export type { NonceStore, NonceClaim, CheckResult, CheckOutcome } from './nonce.service.js';

export {
  JOURNAL_EVENTS,
  EVENT_FIELDS,
  isAllowedEvent,
  pickAllowedFields,
  isLiveGameVersion,
  telemetryCategoryFor,
  isBaselineCategory,
  BASELINE_CATEGORIES,
  OPTIONAL_CATEGORIES,
  canonicalJson,
} from './journal/journal-events.js';
export {
  ELITE_RANK_LADDERS,
  ELITE_RANK_LABELS,
  eliteRankName,
  describeEliteRanks,
  describeInaraRanks,
  allEliteRanks,
} from './journal/elite-ranks.js';
export type { EliteRankKey, EliteRankStanding } from './journal/elite-ranks.js';

export type {
  JournalEventName,
  JournalCategory,
  TelemetryCategoryName,
} from './journal/journal-events.js';
export {
  journalPathCandidates,
  noJournalsAdvice,
  isJournalFile,
  JOURNAL_FILE_PATTERN,
} from './journal/journal-paths.js';
export type { Platform, PathContext } from './journal/journal-paths.js';
export {
  expectedSquadronName,
  sameSquadron,
  evaluateSquadron,
  type SquadronCheckOutcome,
} from './squadron.js';
