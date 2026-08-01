/** DI tokens. Symbols, not classes — esbuild emits no decorator metadata (P1.2). */
export const DASHBOARD_STORE = Symbol('DASHBOARD_STORE');
export const ADMIN_STORE = Symbol('AdminStore');
export const ROLE_ADMIN = Symbol('RoleAdminService');
export const MAPPING_ADMIN = Symbol('MappingAdminService');
export const DISCORD_MODERATION = Symbol('DiscordModeration');

export type {
  AdminStore,
  ActivityRow,
  MemberRow,
  SquadMemberRow,
  AuditRow,
  AuditFilter,
} from './admin.store.js';
export type { RoleAdminService, MaskPreview } from './role-admin.service.js';
export type { MappingAdminService, MappingRecord } from './mapping-admin.service.js';
