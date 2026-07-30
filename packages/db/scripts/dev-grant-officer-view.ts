/**
 * Lets the webmaster read the officers' board — ON A DEVELOPER'S MACHINE ONLY.
 *
 * ★ WHY THIS IS A SCRIPT AND NOT AN `if (NODE_ENV === 'development')` ★
 *
 * Squadron owner, 2026-07-29: "officers category should only be visible to
 * officers. non-officers should not have the ability to view unless permission to a
 * specific user is provided ... allow the webmaster to see this in development env
 * only please!"
 *
 * The obvious implementation is an environment check inside the visibility test.
 * That is the one place it must not go. An environment branch inside an
 * authorisation decision means THE CODE PATH PRODUCTION TAKES IS ONE DEVELOPMENT
 * NEVER RUNS — every local test exercises the permissive branch, and the restrictive
 * branch ships unexercised. It is also a single typo (`'developement'`, a `!==`, a
 * missing NODE_ENV in a container) away from being permissive in production, and
 * nothing would look wrong.
 *
 * So the permission mask is IDENTICAL in every environment, and development simply
 * carries an extra grant that somebody added on purpose. Production is correct by
 * DEFAULT rather than by remembering to unset something, and the difference between
 * environments is visible in the database — `SELECT … FROM role_permission_grants`
 * answers "why can I see this" — instead of being invisible in a conditional.
 *
 * ★ IT REFUSES TO RUN ANYWHERE BUT DEVELOPMENT ★
 *
 * Belt and braces, because a script that grants a permission is exactly the sort of
 * thing that gets run against the wrong DATABASE_URL at 2am. Three independent
 * refusals below, each of which alone would be enough.
 *
 * Usage:
 *   pnpm --filter @grims/db dev:grant-officer-view          # grant
 *   pnpm --filter @grims/db dev:grant-officer-view --revoke # take it back
 */
import { PrismaClient } from '@prisma/client';

/** FORUM_VIEW_OFFICER, bit 4. Spelled out because this file must not import the app. */
const FORUM_VIEW_OFFICER = 16n;

/**
 * Refuses to run against anything that is not plainly a local development database.
 *
 * Checked BEFORE connecting, so a mistake costs nothing.
 */
function assertDevelopment(): void {
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production') {
    throw new Error(
      'NODE_ENV=production. This script exists so that production does NOT have this grant.',
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Refusing to guess which database this is.');
  }

  /*
   * The host check is the one that actually protects anything: NODE_ENV is unset far
   * more often than it is wrong, and a developer running against the production
   * DATABASE_URL by accident is the realistic failure. Production is a Vultr host
   * reached over the network; development is localhost.
   */
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();

  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'postgres';
  if (!isLocal) {
    throw new Error(
      `DATABASE_URL points at "${host}", which is not a local database. ` +
        'This grant is development-only by design — see the comment at the top of this file.',
    );
  }
}

async function main(): Promise<void> {
  const revoke = process.argv.includes('--revoke');
  assertDevelopment();

  const prisma = new PrismaClient();
  try {
    const role = await prisma.role.findUnique({ where: { key: 'webmaster' } });
    if (!role) {
      throw new Error('No role with key "webmaster". Has the seed run?');
    }

    /*
     * Read-modify-write in TypeScript rather than arithmetic in SQL. Postgres has no
     * bitwise operator for NUMERIC — perm_mask is NUMERIC(40,0) because the mask
     * exceeds 64 bits — so `perm_mask | 16` does not exist and `div()`/`-` is how the
     * migrations do it. In a script there is no reason to be clever: BigInt has real
     * bitwise operators.
     *
     * ★ `.toFixed(0)`, NEVER `.toString()` ★
     *
     * Prisma maps NUMERIC to a decimal.js Decimal, whose `toString()` switches to
     * EXPONENTIAL NOTATION at 1e21 — and ALL_PERMISSIONS is 1.19e21, so every
     * all-permission role is over the line:
     *
     *   .toString()  ->  '1.197902339489246755887e+21'   BigInt() throws on this
     *   .toFixed(0)  ->  '1197902339489246755887'        correct
     *
     * The first version of this script used `toString()` and died with "Cannot
     * convert 1.197902339489246755887e+21 to a BigInt" — loudly, which is the good
     * outcome. The bad outcome would have been a mask that parsed as something
     * plausible.
     *
     * The rest of the codebase already gets this right: role-admin.store.prisma.ts
     * and permission.store.prisma.ts convert with `toFixed(0)` at the store boundary,
     * so `RoleRecord.permMask` is a bigint everywhere above it. This script talked to
     * Prisma directly and skipped that boundary, which is exactly why it hit a trap
     * the application does not.
     */
    const current = BigInt(role.permMask.toFixed(0));
    const held = (current & FORUM_VIEW_OFFICER) !== 0n;
    const next = revoke ? current & ~FORUM_VIEW_OFFICER : current | FORUM_VIEW_OFFICER;

    if (next === current) {
      console.log(
        revoke
          ? 'Already revoked — the webmaster role does not hold FORUM_VIEW_OFFICER.'
          : 'Already granted — the webmaster role holds FORUM_VIEW_OFFICER.',
      );
      return;
    }

    await prisma.role.update({
      where: { key: 'webmaster' },
      data: { permMask: next.toString() },
    });

    console.log(
      `${revoke ? 'Revoked' : 'Granted'} FORUM_VIEW_OFFICER on the webmaster role.\n` +
        `  before ${current}  (bit ${held ? 'set' : 'clear'})\n` +
        `  after  ${next}\n\n` +
        'This is a LOCAL change. Production deliberately does not have it, and no\n' +
        'migration will add it — see 20260729222000_webmaster_cannot_read_officers.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
