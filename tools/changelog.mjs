#!/usr/bin/env node
/**
 * The changelog generator.
 *
 *   node tools/changelog.mjs [--from <ref>] [--to <ref>] [--repo <path>]
 *                            [--json | --sql | --write-pending]
 *
 * Reads `git log <from>..<to>` and turns it into the member-facing changelog:
 * every commit classified by the files it touched (apps/web → Website,
 * apps/companion → Companion App, everything else → Platform; a commit that
 * touches web AND companion lands in both), the subject humanized, and the
 * body's first paragraph carried along as the detail.
 *
 * ★ WHY THE COMMIT MESSAGES ARE THE CHANGELOG, VERBATIM ★
 *
 * The commit messages in this repository are already prose — each one says
 * what changed and why in complete sentences, because AGENTS.md demands it.
 * Summarising them again would be a second, worse draft of writing that
 * already exists, so this tool's whole job is classification and formatting:
 * it strips the `type(scope):` machinery, capitalises what remains, and keeps
 * the author's own words for the detail. Preserve the voice; never compress it.
 *
 * ★ WHERE THE DEFAULT --from COMES FROM ★
 *
 * The deploy script (infra/scripts/deploy.sh, step 8) writes the revision it
 * just shipped to /srv/grims/deployed.sha. That marker is the honest answer to
 * "what is production running" — the repo checkout's HEAD moves on every fetch
 * whether or not a deploy followed. On a machine without the marker (any dev
 * box), --from is required and the error says so; `--from origin/main` is the
 * usual local choice.
 *
 * Output modes, one per run:
 *   (default)        the full changelog as markdown, to stdout
 *   --json           the structured release (per-section markdown + entries)
 *   --sql            an INSERT into changelog_releases, for piping into psql
 *                    at deploy time — see deploy.sh step 8
 *   --write-pending  writes .changelog-pending.json at the repo root
 *                    (gitignored), which GET /v1/changelog/pending serves to
 *                    webmasters as the "built but not deployed" preview
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ────────────────────────────────────────────────── pure, tested functions */

/**
 * Which changelog sections a commit belongs to, from the files it touched.
 *
 * Everything that is not one of the two member-facing apps is Platform — the
 * API, the worker, the bot, the collector, every package, and the infra and
 * tooling that ship them. That is deliberate breadth rather than laziness: a
 * deploy note that silently omits "the deploy machinery changed" is how the
 * next incident starts with an out-of-date mental model.
 */
export function sectionsFor(files) {
  const out = new Set();
  for (const file of files) {
    if (file.startsWith('apps/web/')) out.add('website');
    else if (file.startsWith('apps/companion/')) out.add('companion');
    else out.add('platform');
  }
  // An empty commit still shipped; Platform is the only honest shelf for it.
  if (out.size === 0) out.add('platform');
  return [...out];
}

/**
 * `feat(shipyard): name a hull, or name a budget` → `Name a hull, or name a budget`.
 *
 * Only the conventional-commit machinery is removed. The words are the
 * author's and stay exactly as written apart from the leading capital.
 */
export function humanizeSubject(subject) {
  const stripped = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s+/i, '').trim();
  if (stripped === '') return subject.trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * The first paragraph of a commit body, verbatim.
 *
 * First paragraph rather than the whole body because bodies here often carry
 * implementation notes and review trails after the opening statement — the
 * opening paragraph is the part written for a reader, and the full message
 * remains one `git show` away.
 */
export function firstParagraph(body) {
  const paragraphs = body.split(/\n[ \t]*\n/).map((p) => p.trim());
  const taken = [];
  for (const paragraph of paragraphs) {
    if (paragraph === '') break;
    taken.push(paragraph);
    /*
     * A paragraph ending in a colon is an INTRODUCTION — "Two waves, both
     * specced to the bone:" — and cutting there ships the drum roll without
     * the song. So the paragraph it introduces comes along, and the loop
     * continues for as long as each addition keeps introducing the next.
     */
    if (!paragraph.endsWith(':')) break;
  }
  return taken.join('\n\n');
}

// Control characters as record separators: no commit message can contain
// them, so the parse cannot be confused by prose — which for this repository's
// essay-length messages is a real risk with any printable delimiter.
const REC = '\u0001';
const UNIT = '\u0002';
const END = '\u0003';

/**
 * The `--format` argument matching parseGitLog below. Git's own %x hex
 * placeholders, so no raw control character ever appears in source or on a
 * command line — git materialises them in its output and nowhere else.
 */
export const GIT_LOG_FORMAT = '%x01%H%x02%B%x03';

/**
 * Parses `git log --format=<GIT_LOG_FORMAT> --name-only` output into
 * `{ sha, subject, body, files }` records, newest first.
 */
export function parseGitLog(raw) {
  const commits = [];
  for (const chunk of raw.split(REC)) {
    if (chunk.trim() === '') continue;
    const unitAt = chunk.indexOf(UNIT);
    const endAt = chunk.indexOf(END);
    if (unitAt === -1 || endAt === -1) continue;

    const sha = chunk.slice(0, unitAt).trim();
    const message = chunk.slice(unitAt + 1, endAt);
    const files = chunk
      .slice(endAt + 1)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');

    const [subjectLine, ...bodyLines] = message.split('\n');
    commits.push({
      sha,
      subject: (subjectLine ?? '').trim(),
      body: bodyLines.join('\n').trim(),
      files,
    });
  }
  return commits;
}

/**
 * The whole release, built from parsed commits: one entry per commit per
 * section, and the three per-section markdown documents the database stores.
 */
/**
 * The platform version, read from the companion's package.json — the copy the version-sync spec
 * holds equal to PLATFORM_VERSION, and the one file this tool can reach without importing
 * TypeScript. Null when unreadable rather than a crash: a changelog without a version is still a
 * changelog.
 */
export function readPlatformVersion(repo) {
  try {
    const pkg = JSON.parse(readFileSync(join(repo, 'apps', 'companion', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null;
  } catch {
    return null;
  }
}

export function buildRelease({ fromSha, toSha, commits, generatedAt, version = null }) {
  const entries = commits.map((commit) => ({
    sha: commit.sha,
    subject: humanizeSubject(commit.subject),
    detail: firstParagraph(commit.body),
    sections: sectionsFor(commit.files),
  }));

  const sectionMd = (key) =>
    entries
      .filter((entry) => entry.sections.includes(key))
      .map((entry) =>
        entry.detail === '' ? `### ${entry.subject}` : `### ${entry.subject}\n\n${entry.detail}`,
      )
      .join('\n\n');

  return {
    fromSha,
    toSha,
    generatedAt,
    version,
    commitCount: commits.length,
    websiteMd: sectionMd('website'),
    companionMd: sectionMd('companion'),
    platformMd: sectionMd('platform'),
    entries,
  };
}

/** The human-readable stdout rendering of a release. */
export function renderMarkdown(release) {
  const section = (title, md, emptyLine) =>
    `## ${title}\n\n${md === '' ? `_${emptyLine}_` : md}`;

  return [
    `# Grim's Squad changelog — ${release.version === null ? '' : `v${release.version}, `}${release.fromSha.slice(0, 8)}..${release.toSha.slice(0, 8)}`,
    `_${release.commitCount} commit${release.commitCount === 1 ? '' : 's'}, generated ${release.generatedAt}._`,
    section('Website', release.websiteMd, 'Nothing in this range touched the website.'),
    section('Companion App', release.companionMd, 'Nothing in this range touched the companion app.'),
    section('Platform', release.platformMd, 'Nothing in this range touched the platform.'),
    '',
  ].join('\n\n');
}

/**
 * The INSERT the deploy script pipes into psql.
 *
 * Dollar-quoted rather than escaped: the markdown is commit prose and can
 * contain any quoting a person can type, and a dollar tag that provably does
 * not appear in the content is immune to all of it. The SHAs are validated as
 * 40-hex before they get near this string, so the single quotes around them
 * are safe by construction.
 */
/** Version quoted only when it is provably plain semver-ish text — same doctrine as the SHAs. */
function sqlVersion(version) {
  return version !== null && /^[0-9A-Za-z.-]+$/.test(version) ? `'${version}'` : 'NULL';
}

export function renderSql(release) {
  const quote = (text) => {
    let tag = 'grimslog';
    while (text.includes(`$${tag}$`)) tag += 'x';
    return `$${tag}$${text}$${tag}$`;
  };
  return [
    `INSERT INTO changelog_releases (from_sha, to_sha, version, website_md, companion_md, platform_md)`,
    `VALUES ('${release.fromSha}', '${release.toSha}', ${sqlVersion(release.version)}, ${quote(release.websiteMd)}, ${quote(release.companionMd)}, ${quote(release.platformMd)});`,
    '',
  ].join('\n');
}

/* ─────────────────────────────────────────────────────────────── the CLI */

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function fail(message) {
  console.error(`changelog: ${message}`);
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { from: null, to: 'HEAD', repo: null, mode: 'markdown' };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') opts.from = argv[(i += 1)];
    else if (arg === '--to') opts.to = argv[(i += 1)];
    else if (arg === '--repo') opts.repo = argv[(i += 1)];
    else if (arg === '--json') opts.mode = 'json';
    else if (arg === '--sql') opts.mode = 'sql';
    else if (arg === '--write-pending') opts.mode = 'pending';
    else fail(`unknown argument: ${arg}`);
  }

  // The repo defaults to the checkout this script lives in, so it works from
  // any working directory — deploy.sh passes --repo explicitly anyway.
  const repoRoot = resolve(opts.repo ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));

  if (opts.from === null || opts.from === undefined) {
    const marker = process.env.CHANGELOG_DEPLOYED_SHA_FILE ?? '/srv/grims/deployed.sha';
    try {
      opts.from = readFileSync(marker, 'utf8').trim();
    } catch {
      fail(
        `no --from given and the deployed-revision marker (${marker}) is not readable. ` +
          `On the production box the deploy script writes it; anywhere else, pass --from ` +
          `explicitly — "--from origin/main" is the usual local choice.`,
      );
    }
  }

  // Resolved to full SHAs up front: `--sql` interpolates these into SQL, and
  // 40 hex characters is the only shape allowed to travel that path.
  const resolveSha = (ref) => {
    let sha;
    try {
      sha = git(repoRoot, ['rev-parse', `${ref}^{commit}`]).trim();
    } catch {
      fail(`cannot resolve "${ref}" in ${repoRoot}`);
    }
    if (!/^[0-9a-f]{40}$/.test(sha)) fail(`"${ref}" resolved to something that is not a commit SHA`);
    return sha;
  };
  const fromSha = resolveSha(opts.from);
  const toSha = resolveSha(opts.to);

  // Merges carry no work of their own in this repository — trunk-based, and
  // every change rides a real commit — so they are noise here.
  const raw = git(repoRoot, [
    'log',
    '--no-merges',
    `--format=${GIT_LOG_FORMAT}`,
    '--name-only',
    `${fromSha}..${toSha}`,
  ]);
  const commits = parseGitLog(raw);

  const release = buildRelease({
    fromSha,
    toSha,
    commits,
    generatedAt: new Date().toISOString(),
    version: readPlatformVersion(repoRoot),
  });

  if (opts.mode === 'sql' && commits.length === 0) {
    // A redeploy of the same revision must not write an empty release row —
    // an entry that says "nothing changed" is clutter, not a changelog.
    process.stdout.write(`-- no commits between ${fromSha} and ${toSha}; nothing to record\n`);
    return;
  }

  if (opts.mode === 'json') {
    process.stdout.write(`${JSON.stringify(release, null, 2)}\n`);
  } else if (opts.mode === 'sql') {
    process.stdout.write(renderSql(release));
  } else if (opts.mode === 'pending') {
    const target = resolve(repoRoot, '.changelog-pending.json');
    writeFileSync(target, `${JSON.stringify(release, null, 2)}\n`, 'utf8');
    console.error(`changelog: wrote ${release.commitCount} commit(s) to ${target}`);
  } else {
    process.stdout.write(renderMarkdown(release));
  }
}

// Guarded so the exported functions can be imported by the test suite without
// the import itself running a git command. pathToFileURL rather than string
// comparison against argv, because Windows paths need real URL encoding.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
