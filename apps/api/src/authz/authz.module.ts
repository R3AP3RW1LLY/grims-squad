import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { Redis } from 'ioredis';
import { PermissionService } from './permission.service.js';
import { AclDbService } from './acl-db.service.js';
import { PrismaPermissionStore, RedisPermissionCache } from './permission.store.prisma.js';
import { RequiresPermissionGuard } from './requires-permission.guard.js';
import { ViewAsService } from './view-as.service.js';
import { ViewAsGuard } from './view-as.guard.js';
import { PrismaRoleMaskStore } from './role-mask.store.prisma.js';
import { WebmasterService, parseBootstrapIds } from './webmaster.js';
import { PrismaWebmasterStore } from './webmaster.store.prisma.js';

/**
 * `@Global` because permission checks belong everywhere. Threading an import
 * through every feature module adds ceremony without adding safety, and the one
 * module that forgets it is the one with an unguarded route.
 */
@Global()
@Module({
  providers: [
    {
      provide: PermissionService,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) =>
        new PermissionService(
          new PrismaPermissionStore(prisma),
          new RedisPermissionCache(new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')),
        ),
    },
    RequiresPermissionGuard,
    ViewAsGuard,
    {
      /*
       * ★ THE RANK PREVIEW, AND WHY IT IS IN THE AUTHZ MODULE ★
       *
       * Squadron owner, 2026-08-01: officers need to see the site as another rank sees it. The nav,
       * the permission guard and every page that asks "may I" must agree about the answer, or the
       * preview shows one rank's sidebar over another rank's pages — which looks like the
       * permissions themselves are broken.
       *
       * So it lives beside the thing it narrows, in the @Global module, and everything that needs a
       * mask for a REQUEST goes through it.
       */
      provide: ViewAsService,
      inject: [PermissionService, PrismaClient],
      useFactory: (permissions: PermissionService, prisma: PrismaClient) =>
        new ViewAsService(permissions, new PrismaRoleMaskStore(prisma)),
    },
    {
      /*
       * ★ INV-002's ENFORCEMENT POINT — the thing that was missing ★
       *
       * `withPrincipal` existed, worked, failed closed, and had zero callers.
       * The invariant was reported as covered by a test that called the
       * extension directly, which proves the extension rather than its
       * application. This provider is what makes the invariant true of the
       * running system.
       *
       * Exported from a @Global module so that when P2 writes the first forum
       * repository there is nothing to wire — the correct client is already
       * injectable, and `acl-usage.spec.ts` fails the build if that repository
       * reaches for the plain one instead.
       */
      provide: AclDbService,
      inject: [PrismaClient, PermissionService],
      useFactory: (prisma: PrismaClient, permissions: PermissionService) =>
        new AclDbService(prisma, permissions),
    },
    {
      /*
       * ★ THE RECOVERY PATH, FINALLY CONNECTED ★
       *
       * WebmasterService was written, documented and tested against an
       * in-memory fake, and never provided to anything. Its own comment calls
       * applyBootstrap "the recovery path" — and it could not run, because
       * there was no store behind it and nothing called it.
       *
       * The visible symptom: on a platform with exactly one account, nobody
       * could reach the admin console at all.
       *
       * The bootstrap list is CONFIGURATION rather than data on purpose. An
       * attacker who fully compromises an account still cannot add themselves
       * to it without server access, so there is always a way back in that they
       * cannot close from inside the application.
       */
      provide: WebmasterService,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) =>
        new WebmasterService(new PrismaWebmasterStore(prisma), {
          bootstrapDiscordIds: parseBootstrapIds(process.env['WEBMASTER_BOOTSTRAP_DISCORD_IDS']),
        }),
    },
  ],
  exports: [
    AclDbService,
    PermissionService,
    RequiresPermissionGuard,
    ViewAsGuard,
    ViewAsService,
    WebmasterService,
  ],
})
export class AuthzModule {}
