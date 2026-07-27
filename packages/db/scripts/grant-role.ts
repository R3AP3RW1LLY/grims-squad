/**
 * Grants a platform role to a member, from the command line.
 *
 *   pnpm grant-role <handle> <role-key> --confirm
 *
 * Lives inside packages/db rather than a top-level scripts/ directory so that
 * @prisma/client resolves: a file outside every workspace package has no
 * node_modules to reach.
 *
 * ★ WHY THIS EXISTS ★
 *
 * The very first superuser cannot be granted through the admin console, because
 * reaching the console requires the permission the grant would confer. Every
 * system with roles has this bootstrap problem, and the usual answer is somebody
 * pasting UPDATE statements into psql at midnight — which is unaudited,
 * unreviewed, and one typo away from granting the wrong person everything.
 *
 * So: a script that does exactly one thing, records it in the audit log the same
 * way the console would, and refuses anything it was not asked to do.
 *
 * ★ SAFEGUARDS ★
 *
 * - Names the member by HANDLE, not by uuid. Nobody knows a uuid, and a mistyped
 *   one is a valid-looking identifier for somebody else entirely.
 * - Prints what it is about to do and requires --confirm. Reading it back is
 *   the point; a script that acts on its first argument is a script that acts on
 *   a shell-history mistake.
 * - Writes source `system`, so nightly reconciliation leaves it alone. A grant
 *   made here has no Discord role behind it and would otherwise be revoked on
 *   the next run.
 * - Audited with actorId null and a reason, because "how did this person become
 *   a superuser" is a question somebody will eventually ask.
 */
import { PrismaClient } from '@prisma/client';

const [, , handleArg, roleKeyArg, ...rest] = process.argv;
const confirmed = rest.includes('--confirm');

async function main(): Promise<number> {
  if (handleArg === undefined || roleKeyArg === undefined) {
    console.error('Usage: grant-role.ts <handle> <role-key> [--confirm]');
    console.error('Example: grant-role.ts pebblemerchant webmaster --confirm');
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { handle: handleArg },
      select: { id: true, handle: true, displayName: true, status: true },
    });
    if (user === null) {
      // Listing candidates rather than just failing: the usual cause is that
      // the member has not signed in yet, and knowing that is the fix.
      const known = await prisma.user.findMany({ select: { handle: true }, take: 20 });
      console.error(`No member with handle "${handleArg}".`);
      console.error(
        known.length === 0
          ? 'There are NO users at all yet — sign in with Discord once first.'
          : `Known handles: ${known.map((u) => u.handle).join(', ')}`,
      );
      return 1;
    }

    const role = await prisma.role.findUnique({
      where: { key: roleKeyArg },
      select: { id: true, key: true, name: true, permMask: true },
    });
    if (role === null) {
      const keys = await prisma.role.findMany({ select: { key: true }, orderBy: { rankOrder: 'asc' } });
      console.error(`No role with key "${roleKeyArg}".`);
      console.error(`Known roles: ${keys.map((r) => r.key).join(', ')}`);
      return 1;
    }

    const already = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      select: { source: true },
    });

    console.log('');
    console.log(`  Member : ${user.displayName} (@${user.handle})  status=${user.status}`);
    console.log(`  Role   : ${role.name}  [${role.key}]`);
    console.log(`  Mask   : ${role.permMask.toFixed(0)}`);
    console.log(`  Source : system  (invisible to nightly reconciliation)`);
    console.log('');

    if (already !== null) {
      console.log(`Already granted (source: ${already.source}). Nothing to do.`);
      return 0;
    }

    if (!confirmed) {
      // The whole safeguard. Read the four lines above, then say so.
      console.log('Nothing written. Re-run with --confirm to apply.');
      return 0;
    }

    await prisma.$transaction([
      prisma.userRole.create({
        data: { userId: user.id, roleId: role.id, source: 'system' },
      }),
      prisma.auditLog.create({
        data: {
          // No actor: this happened outside the application, at a shell. Naming
          // the recipient as the actor would read as a self-grant.
          actorId: null,
          actorType: 'system',
          action: 'role.grant',
          targetType: 'user',
          targetId: user.id,
          before: { roles: 'unchanged' },
          after: {
            role: role.key,
            source: 'system',
            reason: 'Granted from scripts/grant-role.ts — bootstrap, outside the admin console.',
          },
        },
      }),
    ]);

    console.log(`Granted ${role.name} to @${user.handle}.`);
    console.log('');
    console.log('Next: enrol two-factor at /settings/security, then open /app.');
    console.log('The admin console needs BOTH the permission and a fresh 2FA step-up.');
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('grant-role failed:', err);
    process.exitCode = 1;
  });
