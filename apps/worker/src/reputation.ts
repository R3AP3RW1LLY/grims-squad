import { PrismaClient } from '@grims/db';
import { runReputation } from './jobs/reputation.js';

/**
 * Nightly reputation.
 *
 * A one-shot, like every other job here: it runs, does the work, exits with a status cron can act
 * on. No resident scheduler — the host's cron already solves timing, retries and overlap, and does
 * it observably from outside the process.
 */
async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const report = await runReputation(db);
    console.log(
      `reputation: ${report.playDays} play-days awarded, ${report.badges} badges earned across ${report.members} members`,
    );
  } catch (e) {
    console.error(`reputation: FAILED — ${e instanceof Error ? e.message : String(e)}`);
    // Non-zero so cron mails it. A job that fails quietly is a job nobody knows is failing.
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

await main();
