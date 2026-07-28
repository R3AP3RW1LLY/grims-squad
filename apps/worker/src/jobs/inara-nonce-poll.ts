import { PrismaClient } from '@grims/db';
import {
  InaraAdapter,
  InaraNotApprovedError,
  InaraApiError,
  INARA_APP_NAME,
  INARA_APP_VERSION,
} from '@grims/ed-clients';
import { NonceService } from '@grims/shared';
import { PrismaNonceStore } from '@grims/db';

/**
 * Polls Inara for outstanding nonce claims (P1.8b).
 *
 * ★ WHY THIS IS A WORKER JOB AND NOT A REQUEST HANDLER ★
 *
 * Inara allows two calls a MINUTE globally (INV-033). With ten claims open the
 * queue is five minutes deep, and no member can be left holding an HTTP
 * connection for that. So the member gets a code immediately and this job
 * completes the verification in the background.
 *
 * ★ DEGRADES ALONE ★
 *
 * "Inara being unavailable or unapproved degrades this path only — nothing else
 * breaks." Every failure mode below stops THIS job and touches nothing else:
 * officer-manual verification, role sync, promotions and the site all keep
 * working. Inara is an upgrade over asking an officer, never a dependency.
 */

export interface PollSummary {
  readonly checked: number;
  readonly verified: number;
  readonly stillPending: number;
  readonly expired: number;
  readonly conflicts: number;
  readonly errors: number;
  /** True when the job gave up early — a revoked key, or Inara being down. */
  readonly abandoned: boolean;
  readonly note: string | null;
}

/**
 * How many claims one run will look at.
 *
 * At two calls a minute, twenty claims is a ten-minute run. Beyond that the job
 * overlaps the next scheduled run and both compete for the same budget, which
 * is slower than doing less.
 */
const MAX_PER_RUN = 20;

export async function pollInaraNonces(
  nonce: NonceService,
  inara: InaraAdapter,
  now: Date = new Date(),
): Promise<PollSummary> {
  const due = (await nonce.duePolls(now)).slice(0, MAX_PER_RUN);

  let verified = 0;
  let stillPending = 0;
  let expired = 0;
  let conflicts = 0;
  let errors = 0;

  for (const claim of due) {
    let bio: string;
    try {
      const profile = await inara.getCommanderProfile(claim.cmdrName);
      if (profile === null) {
        // Inara has no such commander. Almost always a typo in the name they
        // entered, and indistinguishable from "not created yet" — so it is
        // treated exactly like the code not being there: keep waiting until the
        // nonce expires, then let them start again.
        stillPending += 1;
        continue;
      }
      bio = profile.bio;
    } catch (cause) {
      if (cause instanceof InaraNotApprovedError) {
        /*
         * Our API key is rejected. Every remaining claim will fail the same
         * way, so continuing would burn the whole rate-limit budget proving it.
         * Stop, and say why — this is the failure that needs a human, and it is
         * silent otherwise.
         */
        return {
          checked: verified + stillPending + expired + conflicts + errors,
          verified,
          stillPending,
          expired,
          conflicts,
          errors,
          abandoned: true,
          note: `Inara rejected our API key: ${cause.message}. Officer-manual verification is unaffected.`,
        };
      }

      if (cause instanceof InaraApiError && !cause.retryable) {
        errors += 1;
        continue;
      }

      // Transient. Leave the claim alone and try again next run — it has a
      // 24-hour TTL, so there is plenty of room to be patient.
      errors += 1;
      continue;
    }

    const result = await nonce.checkBio(claim.id, bio, now);
    switch (result.outcome) {
      case 'verified':
        verified += 1;
        break;
      case 'expired':
        expired += 1;
        break;
      case 'conflict':
        conflicts += 1;
        break;
      default:
        // `pending` — THE NORMAL CASE while the member gets round to editing
        // their profile. Counted, never logged as a problem.
        stillPending += 1;
    }
  }

  return {
    checked: due.length,
    verified,
    stillPending,
    expired,
    conflicts,
    errors,
    abandoned: false,
    note: null,
  };
}

/** Entry point. Scheduled every 15 minutes. */
export async function main(): Promise<number> {
  const apiKey = process.env['INARA_API_KEY'] ?? '';
  if (apiKey === '') {
    // Not configured is not a failure. Inara verification is optional and the
    // officer-manual path covers everyone; exiting 0 keeps this out of the
    // alerting until somebody actually asks for it.
    console.error('Inara polling skipped: INARA_API_KEY is not set.');
    return 0;
  }

  const prisma = new PrismaClient();
  try {
    const summary = await pollInaraNonces(
      new NonceService(new PrismaNonceStore(prisma)),
      new InaraAdapter({
        appName: INARA_APP_NAME,
        appVersion: INARA_APP_VERSION,
        apiKey,
        isDeveloped: process.env['NODE_ENV'] !== 'production',
      }),
    );

    console.error(JSON.stringify({ msg: 'inara nonce poll', ...summary }));
    // Non-zero only when the job ABANDONED. A run that found nothing is a
    // perfectly healthy run — most runs are.
    return summary.abandoned ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}
