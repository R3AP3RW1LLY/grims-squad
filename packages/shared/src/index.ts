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
export * from './ai-learning.js';
export * from './ai-knowledge.js';
export * from './reputation.js';
export * from './job-channels.js';
export * from './promotion.js';
export * from './signature-design.js';
export * from './orphan-media.js';
export * from './errors.js';
export * from './dto/common.js';
export * from './redirect.js';

export {
  EARLIEST_PROMOTION_AT,
  PromotionsNotYetPermittedError,
  assertPromotionsPermitted,
  promotionsPermitted,
} from './promotion-floor.js';

/*
 * The colonisation simulation. Exported from here so the website and the companion app run the
 * IDENTICAL rules — two copies would drift, and the half that drifted would be the one deciding
 * whether a fortnight of hauling is legal.
 */
export {
  NO_EFFECTS,
  prerequisiteName,
  simulatePlan,
  surchargedCost,
} from './colony-simulation.js';
export type {
  SimBuildType,
  SimProblem,
  SimResult,
  SimSite,
  SimStep,
  SystemEffects,
} from './colony-simulation.js';

export {
  ECONOMIES,
  WEAK_LINK_STRENGTH,
  bodyBuffs,
  bodyEconomies,
  resolveEconomies,
  strongLinkStrength,
} from './colony-economy.js';
export type {
  EconAudit,
  EconBody,
  EconBuildType,
  EconSite,
  Economy,
  EconomyResult,
  EconomyScores,
  SiteEconomy,
} from './colony-economy.js';

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
  humanizeCommanderName,
  overrideActionFor,
  rankForDisplay,
  resolveMemberRank,
  MAX_NICK,
  LEADERSHIP_CEILING,
  type HeldRole,
  type OverrideAction,
} from './nickname.js';
export {
  TELEMETRY_CATALOGUE,
  REQUIRED_CATEGORY,
  undescribedEvents,
  categoryOf,
  type CatalogueGroup,
  type CatalogueEntry,
} from './journal/telemetry-catalogue.js';
export { tenureBetween, formatTenure, tenureFrom, type Tenure } from './tenure.js';
export {
  VIEW_AS_COOKIE,
  VIEW_AS_MAX_AGE_SEC,
  VIEW_AS_REFUSAL,
  VIEW_AS_EXEMPT_PATHS,
  PREVIEW_UNKNOWN_ROLE_MASK,
  previewMask,
  previewAllows,
  isExemptFromPreview,
  isWrite,
  readPreviewRoleId,
} from './view-as.js';
export {
  BUILD_HOSTS,
  SUPPORTED_BUILD_HOSTS,
  sourceOf,
  coverageOf,
  type BuildSource,
  type SlotGroup,
  type FittedModule,
  type Engineering,
  type ShipBuild,
  type ImportResult,
  type ImportCoverage,
  BUILD_ROLES,
  BUILD_ROLE_LABELS,
  BUILD_ROLE_TARGETS,
  classifyBuild,
  buildProgress,
  type BuildRole,
  type BuildRoleProgress,
  BUILD_VISIBILITIES,
  BUILD_VISIBILITY_LABELS,
  BUILD_VISIBILITY_NOTES,
  isBuildVisibility,
  isShareToken,
  SHARE_TOKEN_ALPHABET,
  SHARE_TOKEN_LENGTH,
  type BuildVisibility,
} from './ship-build.js';
