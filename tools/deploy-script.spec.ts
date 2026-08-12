import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Properties of the deploy script that nothing else can check.
 *
 * ★ WHY THIS FILE EXISTS: TWO FIXES THAT DID NOT FIX ANYTHING ★
 *
 * Both shipped on 2026-08-05, both declared done on a single observation, and both were wrong in
 * a way no test could notice because the deploy script had no tests at all.
 *
 *   `nice -n 19 docker compose build` lowers the priority of the CLI CLIENT. The compiling happens
 *   inside the Docker daemon, and `ps -o ni` showed dockerd and every build process at nice 0
 *   throughout. The squadron owner's companion app timed out through two consecutive deploys with
 *   that code in place, and `/` measured FIFTEEN SECONDS mid-build.
 *
 *   `docker builder prune --keep-storage 40GB` caps the RECLAIMABLE cache, not the total. With
 *   185 GB of cache of which 24 GB was unused, it reclaimed exactly nothing — 24 is already under
 *   40 — and the disk climbed back to 76% within three deploys of being cleared.
 *
 * AGENTS.md §8.5: "Bugs get a regression test first. No fix lands without the test that would have
 * caught it." Neither of those had one. These are that debt, paid.
 *
 * ★ THEY ASSERT AGAINST THE OLD FILE TOO ★
 *
 * A source scan that only checks today's content proves nothing about whether it would have caught
 * yesterday's bug — it passes the moment the fix is present and would have passed a hundred other
 * ways. Each test below is also run against the exact commit that carried the broken version, and
 * must fail there. That is what makes it a regression test rather than a description.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SCRIPT = join(REPO, 'infra', 'scripts', 'deploy.sh');

const current = readFileSync(SCRIPT, 'utf8');

/**
 * The script as it stood before a given fix.
 *
 * Read from git rather than copied here, so the "before" cannot drift out of step with reality — a
 * hand-pasted snapshot rots the first time somebody reformats the file.
 *
 * ★ EACH BUG HAS ITS OWN ANCHOR, AND THEY ARE NOT THE SAME COMMIT ★
 *
 * The first version of this file anchored both regressions to one commit and the cache assertion
 * failed immediately: that fix had landed two pull requests earlier, so the parent already had it.
 * A regression test pointed at the wrong "before" proves nothing while looking rigorous, which is
 * the same species of mistake as the fixes it exists to guard.
 */
function scriptBefore(fixCommit: string): string | null {
  try {
    return execFileSync('git', ['show', `${fixCommit}^:infra/scripts/deploy.sh`], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    /*
     * A shallow clone or a detached checkout without that history. Skipped rather than failed: the
     * forward assertions still hold, and a CI runner that fetched one commit must not fail a
     * quality gate for it.
     */
    return null;
  }
}

/** True when the build step bounds how many images compile at once. */
function boundsBuildParallelism(script: string): boolean {
  return /COMPOSE_PARALLEL_LIMIT=\d+/.test(script);
}

/** True when the cache is pruned in a way that can actually reduce the total on disk. */
function boundsBuildCache(script: string): boolean {
  // An unfiltered prune drops everything unused; the disk-threshold clear handles the rest.
  const unfiltered = /docker builder prune --force\s*>/.test(script);
  const clearsWhenTight = /builder prune --all --force/.test(script);
  return unfiltered && clearsWhenTight;
}

describe('the build cannot starve the site it is deploying', () => {
  it('MANDATORY: the number of images compiled at once is bounded', () => {
    /*
     * The measurement that settled it, same box, mid-build:
     *   six in parallel  →  /  15.0s,  /forum  14.9s
     *   two in parallel  →  /   1.2s,  /forum   1.8s
     *
     * Reducing the number of compilers is what works. Asking the scheduler to referee six of them
     * does not, because the request never reaches the process doing the work.
     */
    expect(
      boundsBuildParallelism(current),
      'deploy.sh no longer limits build parallelism — six images compiling at once took / to 15s',
    ).toBe(true);
  });

  it('MANDATORY: it would have failed on the revision that shipped the broken fix', () => {
    // e80cac9 is where COMPOSE_PARALLEL_LIMIT arrived, after `nice` had been tried and failed.
    const before = scriptBefore('e80cac9');
    if (before === null) return; // shallow clone; see the note on the helper

    expect(
      boundsBuildParallelism(before),
      'the "before" revision already bounds parallelism, so this test proves nothing',
    ).toBe(false);
  });

  it('nice is kept, but is not the thing being relied on', () => {
    /*
     * Correct for the client and free, so it stays — but if it is ever the ONLY protection here,
     * the site is unprotected and looks protected, which is worse than neither.
     */
    if (/nice -n/.test(current)) {
      expect(boundsBuildParallelism(current)).toBe(true);
    }
  });
});

describe('the build cache cannot fill the disk', () => {
  it('MANDATORY: the prune can actually reduce the total, not only the reclaimable', () => {
    /*
     * `--keep-storage N` is a cap on what is RECLAIMABLE. With 24 GB reclaimable and a 40 GB
     * budget it evicts nothing, however large the total — which is precisely what happened while
     * the disk went from 55% back to 79%.
     */
    expect(
      boundsBuildCache(current),
      'deploy.sh prunes only with --keep-storage again, which caps reclaimable and not the total',
    ).toBe(true);
  });

  it('MANDATORY: it would have failed on the revision that shipped the broken fix', () => {
    // d74f227 is where the unfiltered prune and the disk-threshold clear replaced --keep-storage.
    const before = scriptBefore('d74f227');
    if (before === null) return;

    expect(
      boundsBuildCache(before),
      'the "before" revision already bounds the cache, so this test proves nothing',
    ).toBe(false);
  });
});

describe('the production box does no compiling', () => {
  /*
   * ★ THE THIRD AND FINAL ATTEMPT AT THE SAME BUG ★
   *
   * `nice` did not reach the daemon. `COMPOSE_PARALLEL_LIMIT=2` reached it and helped enormously —
   * sixteen minutes of 0.24s pages — and still could not cover the peak: when the Next.js image
   * began compiling, `/` took 19.95 seconds. Fewer compilers is better than more, and no number of
   * them is none.
   *
   * The squadron owner's decision, 2026-08-05: build in CI, and let production pull. This test is
   * what stops the build step from creeping back in the next time somebody wants a quick local fix
   * on the box, which is exactly how it got there the first time.
   */

  /** True when the deploy fetches prebuilt images rather than compiling them. */
  function fetchesRatherThanCompiles(script: string): boolean {
    // Any `compose build` of the service images means the box is compiling again, whatever else it
    // also does. The pull must be present too — a script that neither builds nor pulls deploys
    // whatever happens to be lying in the local cache.
    const compiles = /\$COMPOSE[^\n]*\bbuild\b[^\n]*\bapi\b/.test(script);
    const fetches = /\$COMPOSE[^\n]*\bpull\b[^\n]*\bapi\b/.test(script);
    return fetches && !compiles;
  }

  it('MANDATORY: the deploy pulls its images instead of building them', () => {
    expect(
      fetchesRatherThanCompiles(current),
      'deploy.sh compiles images on the production box again — that is what took / to 19.95s',
    ).toBe(true);
  });

  it('MANDATORY: it would have failed on every revision that built on the box', () => {
    // ffddd23 is the last revision that compiled during a deploy.
    const before = scriptBefore('ffddd23');
    if (before === null) return; // shallow clone; see the note on the helper

    expect(
      fetchesRatherThanCompiles(before),
      'the "before" revision already pulls, so this test proves nothing',
    ).toBe(false);
  });

  it('MANDATORY: the images it fetches are named by the revision being deployed', () => {
    /*
     * `latest` would make "what is production running" unanswerable — the exact question
     * deployed.sha exists to answer — and would turn a rollback back into a rebuild, since the
     * previous revision's image would no longer be reachable by name.
     */
    expect(
      /GRIMS_IMAGE_TAG="\$TARGET_SHA"/.test(current),
      'the deploy no longer pins images to the commit it is deploying',
    ).toBe(true);
  });

  it('MANDATORY: a rollback pulls the old images rather than rebuilding them', () => {
    /*
     * The rollback used to run `compose build` — six images compiled during a failed deploy, on a
     * box already in trouble, to restore a service that was down. Tagging by SHA is what makes the
     * cheap path available; this is what keeps it taken.
     */
    const rollback = current.slice(current.indexOf('rollback() {'));
    const body = rollback.slice(0, rollback.indexOf('\n}'));

    expect(body, 'the rollback still compiles images at the worst possible moment').not.toMatch(
      /\bbuild\b/,
    );
    expect(body, 'the rollback does not fetch the previous revision by name').toMatch(
      /GRIMS_IMAGE_TAG="\$PREVIOUS_SHA"/,
    );
  });
});

describe('pulling images cannot fill the disk the way building them did', () => {
  /*
   * ★ THE RISK THIS MIGRATION CREATED, WRITTEN DOWN BEFORE IT COST ANYTHING ★
   *
   * Moving the build to CI removes the build cache from this box — and replaces it with something
   * that grows the same way. Every deploy pulls six images tagged with its commit, and a tagged
   * image is never dangling, so `docker image prune` in its default form will not touch a single
   * one of them. Twenty deploys is twenty full sets, sitting there indefinitely.
   *
   * The build cache reaching 188 GB was found by a member reporting a slow site. This is the same
   * shape of failure, foreseeable this time, so it gets its test before it gets its incident
   * rather than after — which is the whole of AGENTS.md §8.5 read forwards instead of backwards.
   */
  it('MANDATORY: superseded images are removed, not merely dangling ones', () => {
    /*
     * A bare `docker image prune --force` removes only untagged layers and would reclaim nothing
     * here, exactly as `--keep-storage 40GB` reclaimed nothing from the build cache. Removing
     * SHA-tagged images requires either an age filter or --all.
     */
    expect(
      /docker image prune[^\n]*(--filter|--all)/.test(current),
      'deploy.sh does not remove superseded images — every deploy leaves six tagged images behind forever',
    ).toBe(true);
  });

  it('MANDATORY: the routine prune still leaves something to roll back to', () => {
    /*
     * `--all` on every deploy would delete the previous revision's images the moment the new ones
     * start, turning the cheap rollback this migration was designed around back into a slow pull
     * at the worst possible moment. The unconditional prune must be age-filtered; --all belongs
     * only behind the disk-pressure branch.
     */
    const pruneLines = current.split('\n').filter((l) => /docker image prune/.test(l));
    expect(pruneLines.length, 'no image prune at all').toBeGreaterThan(0);

    const unconditional = pruneLines.filter((l) => !/--filter/.test(l));
    for (const line of unconditional) {
      expect(
        line.trim().startsWith('#') || /^\s{2,}/.test(line),
        `an unfiltered image prune runs on every deploy: ${line.trim()} — the previous revision would be gone before it could be rolled back to`,
      ).toBe(true);
    }
  });
});

describe('CI builds exactly what the deploy pulls', () => {
  /*
   * ★ MOVING THE BUILD MOVED THE WAYS IT CAN BE WRONG ★
   *
   * A build on the box read the box's own .env, so it could not disagree with production about
   * anything. A build in CI can — and it fails SILENTLY, because a wrong image starts perfectly
   * well and only misbehaves once a member is looking at it.
   *
   * Two ways for the two files to drift apart, both caught here:
   *
   *   A service gains an image the workflow does not build. The deploy pulls, gets nothing, and
   *   either fails or serves a stale revision that nobody chose.
   *
   *   A build ARG is added to compose and not to the workflow. Next inlines NEXT_PUBLIC_* at build
   *   time, so the image bakes the Dockerfile's fallback — https://45-63-35-93.sslip.io — into
   *   every canonical URL, OpenGraph tag and absolute link on the site. Production would look
   *   fine, be fine, and tell Google it lives at an IP address.
   */
  const compose = readFileSync(join(REPO, 'infra', 'docker', 'compose.prod.yml'), 'utf8');
  const workflow = readFileSync(join(REPO, '.github', 'workflows', 'images.yml'), 'utf8');

  it('MANDATORY: every image production pulls is one CI builds', () => {
    const pulled = new Set(
      [...compose.matchAll(/image:\s*ghcr\.io\/[^/]+\/[^/]+\/([\w-]+):/g)].map((m) => m[1]),
    );
    const built = new Set([...workflow.matchAll(/- image:\s*([\w-]+)/g)].map((m) => m[1]));

    expect(pulled.size, 'no ghcr images found in compose.prod.yml — has the path changed?').toBeGreaterThan(0);

    for (const name of pulled) {
      expect(built, `compose pulls "${name}" but images.yml never builds it`).toContain(name);
    }
  });

  it('MANDATORY: every build arg production supplies is one CI supplies', () => {
    /*
     * Read from compose rather than listed here, so adding an arg cannot pass this test by being
     * forgotten in two places at once.
     */
    /*
     * Scanned by indentation rather than by regex. The first version used `\s+` to gather the
     * block, which happily ran past `args:` into `environment:` and demanded CI pass NODE_ENV —
     * a test failing for a reason that has nothing to do with what it claims to check.
     */
    const lines = compose.split('\n');
    const argNames: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const opener = /^(\s*)args:\s*$/.exec(lines[i] ?? '');
      if (!opener) continue;

      const depth = (opener[1] ?? '').length;
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j] ?? '';
        const indent = /^(\s*)\S/.exec(line);
        if (!indent || (indent[1] ?? '').length <= depth) break; // dedented out of the block
        const key = /^\s*([A-Z_][\w]*):/.exec(line);
        if (key?.[1]) argNames.push(key[1]);
      }
    }

    expect(argNames.length, 'no build args found in compose.prod.yml — has the format changed?').toBeGreaterThan(0);

    for (const arg of argNames) {
      expect(
        workflow,
        `compose builds with ${arg} but images.yml does not pass it — the image will bake the Dockerfile's fallback`,
      ).toContain(arg);
    }
  });

  it('MANDATORY: the site URL CI bakes in is the one members actually visit', () => {
    /*
     * The Dockerfile's fallback is the box's raw IP via sslip.io. Correct as a last resort for a
     * developer with no .env; catastrophic as the value shipped to 107 members, and invisible
     * until somebody notices a share preview pointing at 45-63-35-93.
     */
    expect(
      workflow,
      'images.yml no longer names grims-squad.com, so the built site would advertise an IP address',
    ).toContain('https://grims-squad.com');
  });
});

describe('the datastores are never published to the world', () => {
  /*
   * ★ THE ONE MISTAKE THAT WOULD MATTER MOST — 2026-08-06 ★
   *
   * Moving the workers to a second box means Postgres and Redis must become reachable from another
   * machine, and the obvious way to do that is the catastrophic one. `ports: ['5432:5432']` binds
   * EVERY interface including the public IP, and Docker writes its own iptables rules that sit in
   * FRONT of ufw — so a ufw deny does not save you. 107 members' data on a public IP behind
   * nothing but a password, found by scanners within hours.
   *
   * compose.prod.yml's own header already says this. This is what makes it true rather than
   * merely written down.
   *
   * The link is a WireGuard tunnel, so the bind address is the tunnel's own and traffic can only
   * arrive from a peer holding the key.
   */
  const compose = readFileSync(join(REPO, 'infra', 'docker', 'compose.prod.yml'), 'utf8');

  /** Every `ports:` entry belonging to one service, read by indentation. */
  function publishedPorts(service: string): string[] {
    const lines = compose.split('\n');
    const start = lines.findIndex((l) => l.trimEnd() === `  ${service}:`);
    if (start === -1) return [];

    const out: string[] = [];
    let inPorts = false;
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (/^ {2}\S/.test(line)) break; // the next service began
      if (/^ {4}ports:\s*$/.test(line)) {
        inPorts = true;
        continue;
      }
      if (!inPorts) continue;
      const entry = /^ {6}-\s*['"]?([^'"#\s]+)/.exec(line);
      if (entry?.[1]) out.push(entry[1]);
      else if (/^ {4}\S/.test(line)) inPorts = false; // a sibling key ended the list
    }
    return out;
  }

  for (const service of ['postgres', 'redis']) {
    it(`MANDATORY: ${service} is bound to an address, never every interface`, () => {
      for (const entry of publishedPorts(service)) {
        /*
         * A published port must carry a bind address — "ADDR:host:container", three parts. Two
         * parts means every interface. That is the whole assertion.
         */
        expect(
          entry.split(':').length,
          `${service} publishes "${entry}" with no bind address — that is every interface, including the public IP`,
        ).toBeGreaterThanOrEqual(3);

        expect(entry, `${service} publishes "${entry}" on the wildcard address`).not.toMatch(
          /^0\.0\.0\.0:/,
        );
      }
    });

    it(`MANDATORY: ${service} fails closed when the bind address is unset`, () => {
      /*
       * A bare ${VAR} expands to EMPTY when unset, and compose reads ":5432:5432" as every
       * interface — the same disaster, produced by forgetting one line in .env. The fallback must
       * be loopback, so a missing variable makes the workers unable to connect (loud, harmless)
       * rather than making the database public (silent, fatal).
       */
      for (const entry of publishedPorts(service)) {
        const variable = /^\$\{([A-Z_]+)(?::-([^}]*))?\}/.exec(entry);
        if (!variable) continue; // a hard-coded address cannot be unset

        expect(
          variable[2],
          `${service} binds to \${${variable[1]}} with no fallback — unset means every interface`,
        ).toBeDefined();
        expect(
          variable[2],
          `${service}'s bind fallback is "${variable[2]}", which is not loopback`,
        ).toBe('127.0.0.1');
      }
    });
  }
});

describe('the primary does not run the workers any more', () => {
  /*
   * ★ THE STEP THAT UNDOES ITSELF IF FORGOTTEN — 2026-08-06 ★
   *
   * The resident daemon and the EDDN subscriber moved to their own machine, because the nightly
   * galaxy import took the primary to load 23 and made the companion app wait EIGHTY-EIGHT SECONDS
   * while four unpigz processes decompressed a 4 GB dump on the cores serving members.
   *
   * Stopping them on the primary is not enough on its own. `docker compose up -d` starts whatever
   * the file declares, so the very next deploy would start them again — and then TWO EDDN
   * collectors would be writing every station, interleaving delete-and-insert over the same rows.
   * The advisory lock stops that becoming corruption; it does not stop it becoming a machine you
   * pay for that does nothing, while the primary goes back to being the thing that ingests.
   *
   * So they are gone from compose.prod.yml, and this is what keeps them gone.
   *
   * `worker` STAYS. It is the one-shot container the deploy runs migrations and the catalogue seed
   * in, it exits when it is done, and it is behind the `jobs` profile so nothing starts it by
   * accident. Removing it would break every deploy.
   */
  const compose = readFileSync(join(REPO, 'infra', 'docker', 'compose.prod.yml'), 'utf8');

  for (const service of ['worker-daemon', 'eddn-collector']) {
    it(`MANDATORY: compose.prod.yml no longer declares ${service}`, () => {
      const declared = compose.split('\n').some((l) => l.trimEnd() === `  ${service}:`);
      expect(
        declared,
        `compose.prod.yml declares ${service} again — the next deploy will start it on the primary alongside the one on the ingestion box`,
      ).toBe(false);
    });

    it(`MANDATORY: the deploy never starts ${service} on this box`, () => {
      const starts = new RegExp(`\\$COMPOSE[^\\n]*up -d[^\\n]*\\b${service}\\b`).test(current);
      expect(
        starts,
        `deploy.sh runs "up -d ${service}" — that is the primary taking the work back`,
      ).toBe(false);
    });
  }

  it('MANDATORY: the one-shot worker survives, or every deploy breaks', () => {
    /*
     * The opposite mistake, and an easy one to make while deleting the other two: this is what
     * `prisma migrate deploy` and the catalogue seed run inside.
     */
    expect(
      compose.split('\n').some((l) => l.trimEnd() === '  worker:'),
      'compose.prod.yml no longer declares the one-shot worker — migrations and seeding have nothing to run in',
    ).toBe(true);
    expect(current, 'the deploy no longer runs migrations in the worker container').toMatch(
      /--profile jobs run --rm[^\n]*worker/,
    );
  });
});

describe('a flaky registry does not abort a deploy', () => {
  /*
   * ★ MEASURED TWICE ON 2026-08-06 ★
   *
   * The registry returned "error reading from server: EOF" mid-layer, twice in one evening — once
   * pulling onto the ingestion box, once during the deploy of #119. Both succeeded on an immediate
   * retry; neither was a real failure.
   *
   * The second one cost more than a retry would have. The deploy aborted at the fetch step, so the
   * rollback ran, and production was left running `:latest` images with `deployed.sha` naming a
   * revision that was no longer what the repository held. "What is production running" became
   * unanswerable, which is the exact question tagging by SHA exists to answer.
   *
   * A network read is allowed to fail. Making the whole deploy fatal on the first attempt turns
   * ordinary internet weather into an outage in the release process.
   */
  it('MANDATORY: the image fetch retries before giving up', () => {
    const fetchStep = current.slice(current.indexOf('say "Fetching images"'));
    const step = fetchStep.slice(0, fetchStep.indexOf('# ────'));

    expect(
      /for\s+\w+\s+in|while\s+|until\s+/.test(step),
      'the image fetch has no retry loop — one transient EOF from the registry aborts the deploy',
    ).toBe(true);
    expect(step, 'the retry does not back off between attempts').toMatch(/sleep\s+/);
  });

  it('MANDATORY: it still fails loudly once the retries are exhausted', () => {
    /*
     * Retrying forever is the opposite mistake: a deploy that hangs is worse than one that stops,
     * because nobody is watching a script that has not said anything.
     */
    const fetchStep = current.slice(current.indexOf('say "Fetching images"'));
    const step = fetchStep.slice(0, fetchStep.indexOf('# ────'));

    expect(step, 'the fetch no longer dies when the images genuinely are not there').toMatch(/die /);
  });
});

describe('the deploy still refuses to start without its configuration', () => {
  it('every announcement channel is required in the preflight', () => {
    /*
     * Unset means the bot queues rows silently and nobody hears about a release, a promotion or a
     * colonisation project. The preflight is the only thing that turns that into a loud failure at
     * the one moment somebody is watching.
     */
    for (const key of [
      'DISCORD_ANNOUNCE_CHANNEL_ID',
      'DISCORD_PROMOTIONS_CHANNEL_ID',
      'DISCORD_COLONY_CHANNEL_ID',
      'DISCORD_RELEASE_CHANNEL_ID',
    ]) {
      expect(current, `${key} is no longer required before a deploy may proceed`).toContain(key);
    }
  });
});

/**
 * ★ THE BOX RAN A DEPLOY SCRIPT FROM 30 JULY FOR ELEVEN DAYS — FOUND 2026-08-10 ★
 *
 * `/srv/grims/deploy.sh` was a COPY of `infra/scripts/deploy.sh`, taken once and never taken again.
 * This file kept improving; the box's copy did not, and nothing anywhere compared the two.
 *
 * By the time anybody looked, the running entrypoint was missing the backup pruning (61 dumps and
 * 101 GB on the disk that also holds Postgres), every required-variable check added since, the
 * changelog and announcement steps, and the line that reads PUBLIC_URL from the env file — so its
 * health gate had been pronouncing the site healthy by probing the old sslip.io hostname rather than
 * the domain members actually use.
 *
 * ★ AND EVERY TEST IN THIS FILE PASSED THROUGHOUT ★
 *
 * That is the part worth pinning. The tests above read `infra/scripts/deploy.sh` from the repo, and
 * the repo's copy was always correct. Nothing was wrong with the file under test; the wrong file was
 * being run. A source scan cannot see that, so the guard has to be structural: the entrypoint must
 * be something that CANNOT hold a stale copy, and the script must keep it installed.
 */
describe('the deploy entrypoint cannot go stale', () => {
  const bootstrap = readFileSync(join(REPO, 'infra', 'scripts', 'deploy-bootstrap.sh'), 'utf8');

  it('★ MANDATORY: the bootstrap runs the deploy script from the ref, not a copy of it ★', () => {
    expect(bootstrap, 'the bootstrap does not fetch, so it would run whatever the box last had')
      .toMatch(/git -C .* fetch/);
    expect(
      bootstrap,
      'the bootstrap does not read the script out of the ref being deployed',
    ).toMatch(/git -C .* show .*infra\/scripts\/deploy\.sh/);
    expect(bootstrap, 'the bootstrap never hands control to the real script').toMatch(/exec /);
  });

  it('★ MANDATORY: the bootstrap holds no deploy logic to fall behind on ★', () => {
    /*
     * The whole point. A bootstrap that grew steps would be the same bug with a later date on it —
     * so anything that belongs to deploying is forbidden here, and this fails the moment somebody
     * starts moving work into it.
     */
    for (const forbidden of [
      'docker compose',
      'migrate',
      'pg_dump',
      'curl',
      'KEEP_BACKUPS',
      'psql',
    ]) {
      expect(
        bootstrap.includes(forbidden),
        `the bootstrap has grown "${forbidden}" — it is becoming a second deploy script, which is ` +
          'exactly the thing that went stale',
      ).toBe(false);
    }
  });

  it('★ MANDATORY: it extracts to a temp file rather than executing inside the repo ★', () => {
    /*
     * A symlink into the repo would be the obvious fix and a subtle disaster: the deploy's own
     * fetch and checkout rewrite files in the repo — including the script being executed — and bash
     * reads a script incrementally, so a running deploy can jump into the middle of a different
     * version of itself.
     */
    expect(bootstrap, 'the bootstrap executes a file the deploy itself rewrites mid-run').toMatch(
      /mktemp/,
    );
  });

  it('★ MANDATORY: the deploy reinstalls the entrypoint, so the two cannot drift again ★', () => {
    expect(
      current,
      'nothing keeps /srv/grims/deploy.sh in step, so a hand-run of this script leaves a stale ' +
        'entrypoint behind exactly as before',
    ).toContain('deploy-bootstrap.sh');
    expect(current, 'the entrypoint repair does not actually install anything').toMatch(
      /install .*deploy-bootstrap\.sh|install .*BOOTSTRAP/,
    );
  });

  it('the entrypoint repair cannot fail a deploy that already succeeded', () => {
    // Housekeeping, after the health gate. A verified-up site must never be reported as a failure
    // because it could not rewrite a helper script.
    const step = current.slice(current.indexOf('BOOTSTRAP='));
    expect(step, 'the entrypoint repair dies instead of warning').not.toMatch(/\bdie /);
    expect(step, 'a failed repair says nothing at all').toMatch(/warn /);
  });
});

/**
 * ★ THE AI TUNNEL IS PART OF THE DEPLOY NOW — SQUADRON OWNER, 2026-08-10 ★
 *
 * "ensuring its running and connected should also be part of the deployment process!"
 *
 * Every AI feature — the assistant, the knowledge search, the screening, the artwork — answers
 * through a reverse SSH tunnel to a machine in the owner's house. When it is down, NOTHING says so:
 * the features time out one request at a time on member-facing pages, and the first anybody knows
 * is somebody reporting that the assistant "does not work".
 *
 * ★ THE PATH IS THE PART THAT GOES WRONG ★
 *
 * `AI_BASE_URL` ends in `/v1` — it is the OpenAI-compatible surface — so the models list is
 * `$URL/models`. Probing `/api/tags` against it returns 404 from a perfectly healthy tunnel, which
 * is exactly how this check was nearly written to report a working AI as broken. Measured on
 * production while writing it: `/v1/api/tags` → 404, `/v1/models` → the five models.
 */
describe('the deploy says whether the AI is actually reachable', () => {
  it('★ MANDATORY: it probes the AI at all ★', () => {
    expect(current, 'nothing in the deploy checks the AI tunnel').toMatch(/AI_BASE_URL/);
  });

  it('★ MANDATORY: it asks for /models, not /api/tags ★', () => {
    /*
     * The whole failure this test exists for. A healthy tunnel answers 404 to /api/tags because the
     * base already ends in /v1, so the wrong path turns a working AI into a nightly false alarm —
     * and a warning that is usually wrong is one nobody reads when it is right.
     */
    const step = current.slice(current.indexOf('AI_BASE='));
    expect(step, 'the AI probe uses a path that 404s against a healthy tunnel').not.toMatch(
      /api\/tags/,
    );
    expect(step, 'the AI probe does not ask for the models list').toMatch(/\/models/);
  });

  it('★ MANDATORY: an unreachable AI warns and does NOT stop the deploy ★', () => {
    /*
     * The AI is one feature among many, and blocking a security fix because a desktop at home is
     * asleep would be the wrong trade. Loud, not fatal.
     */
    const step = current.slice(current.indexOf('AI_BASE='), current.indexOf('# ─', current.indexOf('AI_BASE=')));
    expect(step, 'a sleeping desktop at home now blocks every deploy').not.toMatch(/\bdie /);
    expect(step, 'an unreachable AI passes in silence').toMatch(/warn /);
  });

  it('MANDATORY: the warning names what stops working, so it is actionable', () => {
    const step = current.slice(current.indexOf('AI_BASE='));
    expect(
      /assistant|knowledge|artwork/i.test(step),
      'the warning does not say which features are affected, so nobody can judge whether to care',
    ).toBe(true);
  });

  it('an unset AI_BASE_URL is skipped rather than reported as broken', () => {
    // A deployment with no AI configured is a valid arrangement, not a fault to warn about on
    // every single deploy.
    const step = current.slice(current.indexOf('AI_BASE='));
    expect(step, 'no guard on the variable being set at all').toMatch(/-n \$AI_BASE|-n "\$AI_BASE"/);
  });
});

/**
 * ★ THE ROLLBACK WAS UNREACHABLE — PRODUCTION OUTAGE, 2026-08-10 ★
 *
 * This script has had a rollback since it was written, wired as `trap 'rollback' ERR`. It had never
 * once run. Bash does not fire an ERR trap when a script calls `exit`, and every failure path here
 * goes through `die`, which does exactly that.
 *
 * So on 2026-08-10 the gate that exists for this — `wait_healthy api` seeing "Restarting" — fired
 * correctly, printed its refusal, and exited. The API was left broken and the WEB container was
 * left already swapped to the new revision, so production served a newer website against an older
 * API: a button calling an endpoint that did not exist. Nothing was undone.
 *
 * The tests below are the four outcomes, because the failure was never in one line — it was in
 * which of them the handler runs for.
 */
describe('a failed deploy actually rolls itself back', () => {
  it('★ MANDATORY: the trap is on EXIT, because `die` calls exit and ERR never sees it ★', () => {
    /*
     * The bug, in one assertion. `trap 'rollback' ERR` looks exactly like a working rollback and is
     * dead code — which is why it survived from the day the script was written until a deploy
     * needed it.
     */
    /*
     * Code lines only. The comment above the rollback quotes `trap 'rollback' ERR` verbatim while
     * explaining why it never worked — documentation that must not fail the test describing it.
     */
    const code = current
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');

    expect(code, 'the rollback still hangs off ERR, which `die` bypasses').not.toMatch(
      /trap\s+'rollback'\s+ERR/,
    );
    expect(current, 'nothing traps EXIT, so no failure path can roll back').toMatch(
      /trap\s+'on_exit'\s+EXIT/,
    );
  });

  it('★ MANDATORY: a preflight failure rolls back NOTHING ★', () => {
    /*
     * EXIT fires on every exit, including one before a single container has moved. Rolling back
     * there would restart healthy containers to "undo" a deploy that never started — downtime
     * caused by the thing meant to prevent it.
     */
    expect(current, 'no SWAPPED guard — a preflight failure would restart production').toMatch(
      /SWAPPED == 1/,
    );
    expect(current, 'SWAPPED is never initialised, and `set -u` would abort the deploy').toMatch(
      /^SWAPPED=0$/m,
    );
    expect(current, 'SWAPPED is never set, so a real failure would not roll back').toMatch(
      /^SWAPPED=1$/m,
    );
  });

  it('★ MANDATORY: a SUCCESSFUL deploy is not rolled back on the way out ★', () => {
    // The opposite mistake, and a worse one: undoing a deploy that worked, every single time.
    expect(current, 'no VERIFIED guard — every successful deploy would roll itself back').toMatch(
      /VERIFIED == 0/,
    );
    expect(current, 'VERIFIED is never initialised').toMatch(/^VERIFIED=0$/m);
    expect(current, 'VERIFIED is never set after the gates pass').toMatch(/^VERIFIED=1$/m);
  });

  it('★ MANDATORY: the rollback restores the WEB too, not just the API ★', () => {
    /*
     * The specific shape of the outage. Only the API had been put back by hand, so production ran a
     * newer web against an older API and every new button 404ed.
     */
    const step = current.slice(current.indexOf('rollback() {'), current.indexOf('on_exit()'));
    expect(step, 'the rollback leaves the web on the failed revision').toMatch(
      /up -d api web bot/,
    );
  });

  it('★ MANDATORY: the rollback proves it worked rather than assuming ★', () => {
    /*
     * Every command in the rollback ends in `|| true` so a failure cannot cascade — which also
     * means it cannot be noticed. "rolled back" printed over a still-dead site is the worst possible
     * ending, because the operator reads it and walks away.
     */
    const step = current.slice(current.indexOf('rollback() {'), current.indexOf('on_exit()'));
    expect(step, 'the rollback never checks whether the site came back').toMatch(/v1\/health/);
    expect(step, 'a failed rollback is not reported as needing a person').toMatch(
      /ROLLBACK DID NOT RESTORE/,
    );
  });

  it('VERIFIED is set only after the public checks, not before them', () => {
    // Set too early it disarms the rollback while the gates are still running, which is the same
    // as having no rollback at all.
    const verifiedAt = current.indexOf('VERIFIED=1');
    expect(current.indexOf('check /v1/health 200'), 'VERIFIED is set before the health gate').
      toBeLessThan(verifiedAt);
    expect(current.indexOf('check /roster 307'), 'VERIFIED is set before the last gate').
      toBeLessThan(verifiedAt);
  });
});

describe('the ingestion box', () => {
  /**
   * ★ THE SECOND BOX, WHICH THIS SCRIPT USED TO LEAVE BEHIND ★
   *
   * infra/runbooks/workers-second-box.md §9 said from the day that box was stood up that deploy.sh
   * "deploys one machine ... a deploy updates the primary and leaves the workers on the old
   * revision". It was never implemented, and on 2026-08-11 the box was found running the build from
   * PR #144 while production ran thirteen commits ahead.
   */

  it('★ MANDATORY: it deploys the workers only AFTER the primary health gate ★', () => {
    /*
     * The safety property. Shipping the workers a build the member-facing box could not serve would
     * take down ingestion for a revision we are about to roll back — and this runs inside the
     * section that only executes once the public URL has answered.
     */
    const verify = current.indexOf('Recording the release');
    const workers = current.indexOf('deploy_workers');

    expect(verify, 'the record section must exist').toBeGreaterThan(0);
    expect(workers, 'the ingestion step must exist').toBeGreaterThan(0);
    expect(workers, 'the ingestion box is deployed after the primary is proved healthy')
      .toBeGreaterThan(verify);
  });

  it('★ MANDATORY: a failure there must not fail the deploy or trigger rollback ★', () => {
    /*
     * The primary is UP and members are being served. Failing here would report a failure that is
     * not one and — far worse — the EXIT trap would roll a healthy site back to punish the other
     * machine. The workers stay on their previous revision, which the wrapper enforces itself.
     */
    const block = current.slice(current.indexOf('deploy_workers()'), current.indexOf('─────', current.indexOf('deploy_workers()')) + 1);

    expect(block, 'no `die` in the ingestion step').not.toMatch(/(^|[^a-z])die[^a-z]/);
    expect(current, 'the failure is still reported loudly').toMatch(/ingestion box FAILED/);
  });

  it('★ MANDATORY: it retries a PULL failure — it races the image build ★', () => {
    /*
     * The first real run failed exactly this way: api, web, bot and worker had finished building
     * but eddn-collector had not, so the box refused the pull and rolled itself back. The primary
     * needs four images and starts the moment they exist; this box needs a fifth.
     *
     * A deploy that needs a human to re-run it minutes later is one that gets forgotten, and
     * forgetting is how that box ended up thirteen commits behind.
     */
    expect(current).toMatch(/could not pull images/);
    expect(current, 'and it waits between attempts').toMatch(/sleep 60/);
  });

  it('★ MANDATORY: it does NOT retry a failure that is not about images ★', () => {
    // A daemon that starts and dies is a real failure. Retrying it five times only takes five times
    // as long to say so.
    const guard = current.slice(current.indexOf('deploy_workers()'));
    const bail = guard.indexOf('!= *"could not pull images"*');
    const retry = guard.indexOf('sleep 60');

    expect(bail, 'a non-image failure is detected').toBeGreaterThan(0);
    expect(bail, 'and it bails out BEFORE reaching the wait').toBeLessThan(retry);
    expect(guard.slice(bail, retry)).toMatch(/return 1/);
  });

  it('MANDATORY: the revision is passed to a key restricted server-side', () => {
    // infra/scripts/worker-box-deploy.sh is pinned as the forced command for this key, so it cannot
    // open a shell or read a file even if this script is wrong.
    expect(current).toMatch(/"root@\$\{WORKERS_HOST\}" "deploy \$TARGET_SHA"/);
  });
});
