import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What `rememberAuthor` is allowed to write.
 *
 * ★ THE MISTAKE THIS EXISTS TO CATCH ★
 *
 * `rememberAuthor` takes its name from a message, so it can name people who have left the squadron —
 * the six the owner found showing as raw snowflakes on the activity tab. A message carries a USER,
 * and a user has no nickname and no roles: both belong to guild MEMBERSHIP.
 *
 * The tempting tidy-up is to make its upsert look like the one in `syncMemberNames`, which writes
 * nick and roles as well. Doing that would set both to null for every member on their next message —
 * quietly replacing a hundred working nicknames to fix six missing names, and looking like a
 * deliberate reset in the diff.
 *
 * No test could catch it: the counts stay correct, the page still renders, and the names just get
 * worse. So this reads the source and holds the boundary directly.
 *
 * `main.ts` starts a Discord client on import, so it cannot be imported into a test at all. Reading
 * it as text is the only way to assert anything about it — the same approach `cron-coverage.spec.ts`
 * takes with the crontab, and for the same reason.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(join(HERE, 'main.ts'), 'utf8');

/** The body of `rememberAuthor`, from its signature to the function that follows it. */
function rememberAuthorBody(): string {
  const start = MAIN.indexOf('async function rememberAuthor');
  expect(start, 'rememberAuthor has been renamed or removed').toBeGreaterThan(-1);

  const end = MAIN.indexOf('async function handle', start);
  expect(end, 'could not find where rememberAuthor ends').toBeGreaterThan(start);

  return MAIN.slice(start, end);
}

describe('rememberAuthor', () => {
  it('MANDATORY: never writes membership fields it cannot know', () => {
    const body = rememberAuthorBody();

    // Assignments only. The doc comment above the function names both fields on purpose, explaining
    // why they are absent, and must not fail its own test.
    const forbidden = ['nick:', 'roles:'].filter((field) => body.includes(field));

    expect(
      forbidden,
      `rememberAuthor writes ${forbidden.join(' and ')}, which a message cannot supply. For anyone ` +
        `still in the guild this overwrites a real value with null on their very next message.`,
    ).toEqual([]);
  });

  it('MANDATORY: writes the fields a message actually carries', () => {
    const body = rememberAuthorBody();

    // Without these it is an expensive no-op — the row appears, and the page still shows a number.
    for (const field of ['username:', 'globalName:']) {
      expect(body, `rememberAuthor no longer writes ${field}`).toContain(field);
    }
  });
});
