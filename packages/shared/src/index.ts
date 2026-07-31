// @grims/shared — Zod schemas, DTOs, enums and the permission bitmask.
// Used by BOTH ends. A DTO changes here and both fail to compile until they agree.
export * from './permissions.js';
export * from './rich-document.js';
export * from './forum-signature.js';
export * from './fonts.js';
export * from './ship-names.js';
export * from './ai.js';
export * from './ai-image.js';
export * from './ai-studio.js';
export * from './ai-corpus.js';
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
  NEVER_SENT,
  isSendable,
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
export {
  composeNickname,
  rankForDisplay,
  resolveMemberRank,
  MAX_NICK,
  LEADERSHIP_CEILING,
  type HeldRole,
} from './nickname.js';
export {
  TELEMETRY_CATALOGUE,
  REQUIRED_CATEGORY,
  undescribedEvents,
  categoryOf,
  type CatalogueGroup,
  type CatalogueEntry,
} from './journal/telemetry-catalogue.js';
