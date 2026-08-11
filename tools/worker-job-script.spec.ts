import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What a cron-run worker job actually hands to docker.
 *
 * ★ THE BUG THIS IS THE REGRESSION TEST FOR — 2026-08-11 ★
 *
 * compose.prod.yml names every image `...:${GRIMS_IMAGE_TAG:-latest}`. deploy.sh exports that
 * variable to the sha it is rolling out. The crontab did not, so the nightly reconcile silently
 * resolved `:latest` — a tag deploy.sh never moves, twenty-one hours stale on the day this was
 * found, with no upper bound on the drift.
 *
 * It surfaced by accident. A promotion dry run against production said it would promote two
 * members; the same job, same database, run from the deployed sha, correctly held both back. The
 * difference was the image. Had the promotion cron been installed in the shape the reconcile one
 * was, its first unattended run would have announced two promotions to the whole squadron from
 * code the tenure rule had never been compiled into.
 *
 * ★ WHY THESE RUN THE SCRIPT INSTEAD OF READING IT ★
 *
 * A source scan asserting `worker-job.sh` contains the string `GRIMS_IMAGE_TAG` would have passed
 * against a script that set the variable without exporting it, set it after the exec line, or set
 * it and then had compose ignore it. The failure being defended against is a variable not reaching
 * a child process, so the test puts a fake `docker` on the other side and reads what arrived.
 * AGENTS.md §8.5, and the same reasoning as the module-cycle guard: prove it bites.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SCRIPT = join(REPO, 'infra', 'scripts', 'worker-job.sh');
const CRONTAB = join(REPO, 'infra', 'cron', 'root.crontab');

/** Git Bash accepts `D:/x`, not `D:\x`. Harmless on Linux, where there is nothing to replace. */
const forBash = (p: string): string => p.replace(/\\/g, '/');

const DEPLOYED = 'aa11bb22cc33dd44ee55ff6677889900aabbccdd';

let dir: string;
let record: string;
let fakeDocker: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worker-job-'));
  record = join(dir, 'record.txt');

  /*
   * The fake stands in for docker and writes down what it was handed. `${VAR-<unset>}` and not
   * `${VAR:-<unset>}`: the empty string and "never set" are different bugs and this must tell them
   * apart.
   */
  fakeDocker = join(dir, 'docker');
  writeFileSync(
    fakeDocker,
    ['#!/usr/bin/env bash', 'echo "TAG=${GRIMS_IMAGE_TAG-<unset>}" >> "$RECORD"', 'echo "ARGS=$*" >> "$RECORD"', ''].join(
      '\n',
    ),
    { mode: 0o755 },
  );
  chmodSync(fakeDocker, 0o755);

  writeFileSync(join(dir, 'deployed.sha'), `${DEPLOYED}\n`);
  writeFileSync(join(dir, '.env'), 'POSTGRES_PASSWORD=irrelevant\n');
  mkdirSync(join(dir, 'repo'), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Run {
  readonly status: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly handedToDocker: string;
}

function runJob(args: string[], over: Record<string, string> = {}): Run {
  const env = {
    ...process.env,
    REPO: forBash(join(dir, 'repo')),
    ENV_FILE: forBash(join(dir, '.env')),
    SHA_FILE: forBash(join(dir, 'deployed.sha')),
    DOCKER: forBash(fakeDocker),
    RECORD: forBash(record),
    ...over,
  };

  let status = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bash', [forBash(SCRIPT), ...args], { env, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }

  let handedToDocker = '';
  try {
    handedToDocker = readFileSync(record, 'utf8');
  } catch {
    handedToDocker = '';
  }

  return { status, stdout, stderr, handedToDocker };
}

describe('the image a cron job runs', () => {
  it('★ MANDATORY: docker is handed the DEPLOYED sha, not latest ★', () => {
    const out = runJob(['apps/worker/dist/promote.js']);

    expect(out.status, out.stderr).toBe(0);
    expect(out.handedToDocker, 'the variable must reach the child, not merely be assigned').toContain(
      `TAG=${DEPLOYED}`,
    );
    expect(out.handedToDocker).not.toContain('TAG=<unset>');
  });

  it('★ MANDATORY: the old crontab line resolves to `latest` — the bug, reproduced ★', () => {
    /*
     * This is what was installed on the box, and it must fail here, or the test above proves
     * nothing about whether it would have caught anything.
     *
     *   cd /srv/grims/repo && docker compose ... --profile jobs run --rm worker node .../main.js
     *
     * No wrapper, so no variable, so compose falls through to its own `:-latest` default.
     */
    execFileSync(
      'bash',
      ['-c', `"$DOCKER" compose --profile jobs run --rm worker node apps/worker/dist/main.js`],
      { env: { ...process.env, DOCKER: forBash(fakeDocker), RECORD: forBash(record) }, encoding: 'utf8' },
    );

    const handed = readFileSync(record, 'utf8');
    expect(handed, 'the unpinned form leaves the tag unset — this is the whole defect').toContain(
      'TAG=<unset>',
    );

    // And the default it then falls through to is `latest`, straight from the compose file.
    const compose = readFileSync(join(REPO, 'infra', 'docker', 'compose.prod.yml'), 'utf8');
    expect(compose).toMatch(/grims-squad\/worker:\$\{GRIMS_IMAGE_TAG:-latest\}/);
  });

  it('★ MANDATORY: an unreadable sha REFUSES — it does not fall back ★', () => {
    /*
     * The defect was never `latest` being the wrong value. It was a SILENT fallback turning "I
     * cannot tell what is deployed" into "run something and say nothing". Failing closed is the fix.
     */
    const out = runJob(['apps/worker/dist/promote.js'], { SHA_FILE: forBash(join(dir, 'no-such-file')) });

    expect(out.status, 'a job on an unknown revision must not run').not.toBe(0);
    expect(out.handedToDocker, 'docker must never have been called').toBe('');
    expect(out.stderr).toMatch(/refusing/i);
  });

  it('★ MANDATORY: an EMPTY sha file refuses too ★', () => {
    // A truncated write during a deploy is the realistic way this file goes bad, and an empty tag
    // would produce `worker:` — a confusing docker error rather than a clear refusal.
    writeFileSync(join(dir, 'deployed.sha'), '\n');
    const out = runJob(['apps/worker/dist/promote.js']);

    expect(out.status).not.toBe(0);
    expect(out.handedToDocker).toBe('');
    expect(out.stderr).toMatch(/empty/i);
  });

  it('MANDATORY: the job and its flags reach node in order', () => {
    // `--live --post` are the two barriers in front of announcing promotions to the squadron.
    // Losing or reordering them is the difference between a dry run and a public announcement.
    const out = runJob(['apps/worker/dist/promote.js', '--live', '--post']);

    expect(out.handedToDocker).toContain(
      'run --rm worker node apps/worker/dist/promote.js --live --post',
    );
  });

  it('MANDATORY: it names the profile, or compose will not create the worker at all', () => {
    const out = runJob(['apps/worker/dist/main.js']);
    expect(out.handedToDocker).toContain('--profile jobs');
  });

  it('says which revision it ran, so the log can answer that later', () => {
    // The reconcile log could not, which is how twenty-one hours of drift went unnoticed.
    const out = runJob(['apps/worker/dist/main.js']);
    expect(out.stdout).toContain(DEPLOYED.slice(0, 12));
  });

  it('refuses with a usage message rather than running an empty `node`', () => {
    const out = runJob([]);
    expect(out.status).not.toBe(0);
    expect(out.handedToDocker).toBe('');
  });
});

describe('the crontab that is actually installed', () => {
  const crontab = readFileSync(CRONTAB, 'utf8');
  const jobLines = crontab
    .split('\n')
    .filter((l) => /^\s*[\d*]/.test(l) && !/^\s*(CRON_TZ|SHELL|MAILTO)/.test(l));

  it('★ MANDATORY: no job invokes docker compose directly ★', () => {
    /*
     * The guard that stops this being reintroduced by the next person adding a job. Every entry
     * goes through the wrapper, which is the only place the tag is resolved.
     */
    expect(jobLines.length, 'a crontab with no jobs would pass this vacuously').toBeGreaterThan(0);

    for (const line of jobLines) {
      expect(line, `this job would run :latest — ${line.trim()}`).not.toMatch(/docker\s+compose/);
      expect(line).toMatch(/worker-job\.sh/);
    }
  });

  it('★ MANDATORY: promotions run daily, not on the 1st of the month ★', () => {
    /*
     * The owner's change: "promotes based on length of time and promotion requirements ... instead
     * of running this on the first of the month". A `0 0 1 * *` here would hold a member who
     * qualified on the 3rd for twenty-nine days.
     */
    const promote = jobLines.find((l) => l.includes('promote.js'));
    expect(promote, 'the promotion job must be present — it was absent from the box for a fortnight').
      toBeDefined();

    const schedule = promote?.trim().split(/\s+/).slice(0, 5).join(' ');
    expect(schedule).toBe('15 0 * * *');
    expect(promote).toContain('--live');
    expect(promote).toContain('--post');
  });

  it('MANDATORY: the timezone is pinned to UTC', () => {
    // Promotions are defined in UTC. A host on summer time would run them an hour early for half
    // the year.
    expect(crontab).toMatch(/^CRON_TZ=UTC$/m);
  });

  it('MANDATORY: the documented crontab does not teach the unpinned form', () => {
    /*
     * docs/scheduled-jobs.md carried the promotion line in the broken shape — the doc is where the
     * next job gets copied from, so a fix that leaves it there fixes nothing for the next person.
     */
    const doc = readFileSync(join(REPO, 'docs', 'scheduled-jobs.md'), 'utf8');
    const fenced = /```cron\n([\s\S]*?)```/.exec(doc)?.[1] ?? '';

    expect(fenced, 'the doc must still show a crontab').not.toBe('');
    for (const line of fenced.split('\n').filter((l) => /^\s*[\d*]/.test(l))) {
      expect(line, `the doc teaches an unpinned job — ${line.trim()}`).not.toMatch(/docker\s+compose/);
    }
  });
});
