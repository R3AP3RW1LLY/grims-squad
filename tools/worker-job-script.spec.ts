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
const INGESTION_CRONTAB = join(REPO, 'infra', 'cron', 'ingestion-box.crontab');

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
    .filter((l) => /^\s*[\d*]/.test(l) && !/^\s*(CRON_TZ|SHELL|MAILTO|COMPOSE_FILE)/.test(l));

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

describe('the two boxes, and what each one runs', () => {
  const primary = readFileSync(CRONTAB, 'utf8');
  const ingestion = readFileSync(INGESTION_CRONTAB, 'utf8');

  const jobs = (crontab: string): string[] =>
    crontab
      .split(/\r?\n/)
      .filter((l) => /^\s*[\d*]/.test(l) && !/^\s*(CRON_TZ|SHELL|MAILTO|COMPOSE_FILE)/.test(l));

  it('★ MANDATORY: the reconcile runs on EXACTLY ONE box ★', () => {
    /*
     * ★ THE BUG, FOUND 2026-08-11 ★
     *
     * `0 3 * * * ... main.js` sat in the primary's crontab AND in /etc/cron.d/grims-worker on the
     * ingestion box. Two containers reconciled Discord roles against the same database at the same
     * minute every night, and nothing had ever noticed — both runs do the same work, so the second
     * simply finds nothing left to fix and exits cleanly.
     *
     * That is the shape of the failure this guards: not a crash, but silent duplicated work that
     * looks exactly like success from either side.
     */
    const runners = [
      ...jobs(primary).filter((l) => l.includes('dist/main.js')),
      ...jobs(ingestion).filter((l) => l.includes('dist/main.js')),
    ];

    expect(runners, `the reconcile is scheduled ${runners.length} times across the two boxes`)
      .toHaveLength(1);
  });

  it('★ MANDATORY: no job is scheduled on both boxes ★', () => {
    // The general form of the rule above, so the next job added cannot repeat it.
    const scriptOf = (line: string): string => /dist\/([\w-]+\.js)/.exec(line)?.[1] ?? line.trim();

    const onPrimary = new Set(jobs(primary).map(scriptOf));
    const both = jobs(ingestion).map(scriptOf).filter((s) => onPrimary.has(s));

    expect(both, `scheduled on BOTH boxes: ${both.join(', ')}`).toEqual([]);
  });

  it('★ MANDATORY: the ingestion box names its own compose file ★', () => {
    /*
     * compose.workers.yml, not compose.prod.yml. That box has no api and no web service at all, so
     * a job pointed at the primary's stack asks compose to resolve services which are not there.
     */
    expect(ingestion).toMatch(/^COMPOSE_FILE=infra\/docker\/compose\.workers\.yml$/m);
    expect(primary, 'the primary uses the default and must not need to say so')
      .not.toMatch(/^COMPOSE_FILE=/m);
  });

  it('MANDATORY: the sweeps are on the ingestion box, the promotion run is not', () => {
    // The owner's choice, 2026-08-11: background work on the box that exists for it; the primary
    // keeps only the member-facing ceremony.
    const ingestionScripts = jobs(ingestion).join(' ');
    expect(ingestionScripts).toContain('inara-sync.js');
    expect(ingestionScripts).toContain('daily-audit.js');
    expect(ingestionScripts).toContain('main.js');

    expect(jobs(primary).join(' '), 'promotions stay on the primary').toContain('promote.js');
    expect(ingestionScripts, 'and are not duplicated here').not.toContain('promote.js');
  });

  it('MANDATORY: no ingestion job invokes docker compose inline', () => {
    /*
     * The property that matters is that a job cannot resolve `:latest` by accident. An inline
     * `docker compose` in a crontab has no GRIMS_IMAGE_TAG in scope and always will.
     */
    expect(jobs(ingestion).length).toBeGreaterThan(0);
    for (const line of jobs(ingestion)) {
      expect(line, `this job would run :latest — ${line.trim()}`).not.toMatch(/docker\s+compose/);
    }
  });

  it('★ MANDATORY: every ingestion job goes through a wrapper, and only one is unpinned ★', () => {
    /*
     * ★ grims-embed IS KNOWN-UNPINNED, AND SAYING SO IS THE POINT — 2026-08-13 ★
     *
     * Four embedding schedules were restored to this box after `crontab <file>` silently deleted
     * them. They call `/usr/local/bin/grims-embed`, a wrapper that predates worker-job.sh and runs
     * compose.workers.yml directly — so it still resolves `:latest` rather than the deployed sha.
     *
     * That is a real defect and it is TRACKED HERE rather than waved through, because the honest
     * choices were to fix it in the same breath as an outage restoration (changing a job that had
     * just been proved working) or to write it down. It is written down.
     *
     * The list is exact: adding a second unpinned job fails this test, and fixing grims-embed to
     * pin the tag also fails it — which is the correct prompt to delete the exemption.
     */
    const unpinned = jobs(ingestion).filter((l) => !/worker-job\.sh/.test(l));

    for (const line of unpinned) {
      expect(line, `unexpected unpinned job — ${line.trim()}`).toMatch(/grims-embed/);
    }

    expect(unpinned, 'exactly the four embedding schedules, no more').toHaveLength(4);
  });

  it('MANDATORY: the commander audit does not collide with the promotion run', () => {
    /*
     * Both were documented at `15 0`. Two jobs pulling the whole roster in the same minute, on two
     * machines, against one database is avoidable contention — and the audit is the one with no
     * deadline, so it moves.
     */
    const audit = jobs(ingestion).find((l) => l.includes('daily-audit.js'));
    const promote = jobs(primary).find((l) => l.includes('promote.js'));

    const at = (line: string | undefined): string =>
      (line ?? '').trim().split(/\s+/).slice(0, 5).join(' ');

    expect(at(audit)).not.toBe(at(promote));
  });

  it('MANDATORY: role-sync is in NEITHER crontab — it lives in the daemon', () => {
    /*
     * Squadron owner, 2026-08-11. As a cron entry it is 1,440 container starts a day, each paying
     * Node and Prisma boot to run a handful of indexed queries, and the runbook already blames
     * container churn for a load incident. It runs as a tick inside the daemon that is already up.
     */
    expect(jobs(primary).join(' ')).not.toContain('role-sync');
    expect(jobs(ingestion).join(' ')).not.toContain('role-sync');
  });
});
