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
