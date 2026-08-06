#!/usr/bin/env node
/**
 * The changelog generator.
 *
 *   node tools/changelog.mjs [--from <ref>] [--to <ref>] [--repo <path>]
 *                            [--json | --sql | --write-pending
 *                             | --announce-sql [--public-url <url>]]
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
 *   --announce-sql   an INSERT into `announcements` (kind 'deploy', with the
 *                    forum carbon-copy half), for piping into psql right after
 *                    the changelog INSERT — the bot and the API deliver it
 *                    from there. Takes --public-url (or $PUBLIC_URL) for the
 *                    changelog link members are sent to
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
/**
 * Language that must not appear on a page every member reads.
 *
 * ★ ONE OF THESE SHIPPED — 2026-08-05 ★
 *
 * The squadron owner reported a bug in strong terms, it was quoted word for word into a commit
 * body because that is how this repository writes, and this tool did exactly what it promises:
 * carried the author's own words through to the public changelog. Every member read it.
 *
 * ★ WHY THE TOOL GUARDS RATHER THAN THE AUTHOR REMEMBERING ★
 *
 * The rule this file is built on — preserve the voice, never compress it — is right for the
 * repository and blind to the difference between a commit log and a publication. The next person
 * to write one of these is quoting somebody who was angry, which is precisely when the words are
 * most worth recording internally and least suitable for a members' page. A discipline that must
 * be remembered at the worst possible moment is not a discipline.
 *
 * ★ WORD BOUNDARIES ARE LOAD-BEARING ★
 *
 * Without them this is the Scunthorpe problem, and Elite's galaxy is full of procedurally
 * generated names. A release note silently deleted by a system name would be a bug nobody could
 * ever explain.
 *
 * The git history is untouched. This affects only what is PUBLISHED.
 */
const NOT_FOR_MEMBERS =
  /\b(fuck\w*|shit\w*|bollocks|bastard\w*|wank\w*|cunt\w*|arsehole\w*|asshole\w*)\b/i;

/**
 * Drops any paragraph of a detail that quotes such language.
 *
 * A whole paragraph rather than a masked word: `f***` in a release note is still recognisably a
 * quotation of somebody swearing, and reads worse than the engineering note standing on its own.
 * Every commit names its change in the subject line, so this costs a sentence and never an entry.
 */
/**
 * Anything shaped like an IPv4 address. Redacted from everything published, without exception.
 *
 * On 2026-08-06 the changelog was about to publish the production ingestion box's public address to
 * 107 members, because it appeared in a commit body where it belonged. A commit body is written for
 * whoever maintains this in a year and is supposed to name hosts; a release note is read by
 * everybody. The two have different audiences, and this is where they part.
 */
const LOOKS_LIKE_AN_ADDRESS = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

/**
 * What a commit wants members told — if it says.
 *
 * ★ THE RULE: SAY IT DELIBERATELY, OR SAY NOTHING ★
 *
 * Publishing the first paragraph of a commit body was the old behaviour and it was never going to
 * work. Those paragraphs are full of table names, row counts and hostnames because that is what a
 * useful commit message contains. Filtering them hard enough to be member-safe means filtering them
 * until they say nothing.
 *
 * The squadron owner has now been let down by this twice: once by a body quoting them swearing, and
 * once — caught before it shipped — by "the planner believed market_entries held 30,281 rows" and a
 * production IP address heading for the release notes.
 *
 * So a change members should hear about carries a `Members:` trailer written for them, and a change
 * that is genuinely not member news — a tunnel, an index, a CI retry — carries none and is omitted.
 * A changelog that leaves out the plumbing is more honest than one that describes it to people who
 * fly ships.
 *
 * The trailer runs to the next blank line or the end of the body, so it may be a sentence or a
 * short paragraph.
 *
 * ★ A SQUASH MERGE WILL EAT IT, AND DID — 2026-08-06 ★
 *
 * `gh pr merge --squash` writes the PULL REQUEST TITLE as the commit message and discards every
 * commit body in the branch. The first release to use this mechanism was merged that way and the
 * changelog came out completely empty: three carefully written trailers, none of them in git any
 * more.
 *
 * So the trailer has to survive the merge, which means one of:
 *
 *   `gh pr merge --squash --body "$(...)"`, passing the trailers explicitly, or
 *   a merge commit rather than a squash, which keeps every body.
 *
 * Nothing here can detect the difference — by the time this code runs, the words are already gone.
 * The check that would catch it is looking at the changelog preview before deploying, which is why
 * `--sql` is not the only mode this tool has.
 */
export function memberSummary(body) {
  /*
   * Scanned by line rather than matched by one regular expression.
   *
   * The first version used /^[ \t]*Members:([\s\S]*?)(?:\n\n|$)/im and silently truncated every
   * trailer to its first line: under the `m` flag `$` means end of LINE, so the alternation
   * matched immediately. The preview showed "The companion app connects reliably again. It had
   * been asking the hub" and stopped mid-sentence — which would have been published exactly like
   * that.
   */
  const lines = (body ?? '').split('\n');
  const start = lines.findIndex((line) => /^[ \t]*Members:/i.test(line));
  if (start === -1) return '';

  const collected = [(lines[start] ?? '').replace(/^[ \t]*Members:[ \t]*/i, '')];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '') break; // the trailer is one paragraph
    collected.push(line.trim());
  }

  const text = collected.join(' ').replace(/\s+/g, ' ').trim();
  return fitForMembers(text).replace(LOOKS_LIKE_AN_ADDRESS, '[redacted]').trim();
}

export function fitForMembers(detail) {
  return detail
    .split(/\n[ \t]*\n/)
    .filter((paragraph) => !NOT_FOR_MEMBERS.test(paragraph))
    .join('\n\n')
    .trim();
}

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
    // Published, not logged. Empty unless the commit says what members should be told — see
    // `memberSummary`. The commit body itself keeps every word.
    detail: memberSummary(commit.body),
    sections: sectionsFor(commit.files),
  }));

  /*
   * Only entries that said something to members, and ONLY what they said.
   *
   * The subject is not published either. It is written for the same engineer the body is — the
   * preview of this release had members reading "### The planner believed market_entries held
   * 30,281 rows" above a paragraph about colonisation pages being fast. A heading that has to be
   * translated is worse than no heading, and the member-facing sentence already names its own
   * subject.
   */
  const sectionMd = (key) =>
    entries
      .filter((entry) => entry.sections.includes(key) && entry.detail !== '')
      .map((entry) => entry.detail)
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

/** The dollar-quoter both SQL modes share — see renderSql's header for why not escaping. */
function dollarQuote(text) {
  let tag = 'grimslog';
  while (text.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${text}$${tag}$`;
}

export function renderSql(release) {
  return [
    `INSERT INTO changelog_releases (from_sha, to_sha, version, website_md, companion_md, platform_md)`,
    `VALUES ('${release.fromSha}', '${release.toSha}', ${sqlVersion(release.version)}, ${dollarQuote(release.websiteMd)}, ${dollarQuote(release.companionMd)}, ${dollarQuote(release.platformMd)});`,
    '',
  ].join('\n');
}

/* ─────────────────────────────────────────── the deploy announcement */

/**
 * The longest a bullet's subject may run in the Discord announcement.
 *
 * Discord rejects — not trims — any message over 2000 characters, and the bot's own truncation
 * is the hard guarantee. Clamping here as well keeps the announcement READABLE rather than
 * merely deliverable: a commit subject is a sentence, and two sentences plus the frame sit
 * comfortably inside the limit whatever anybody writes.
 */
const ANNOUNCE_SUBJECT_MAX = 200;

function clampSubject(subject) {
  return subject.length <= ANNOUNCE_SUBJECT_MAX
    ? subject
    : `${subject.slice(0, ANNOUNCE_SUBJECT_MAX - 1)}…`;
}

/**
 * The deploy announcement — the owner's approved copy, one per deploy.
 *
 * The Discord content leads with one website subject and one companion subject, because those
 * are the two shelves members feel; the platform work is in the full changelog the link points
 * to. The forum body is the same message plus every subject, condensed to a bullet list per
 * section — a browsable summary, with the site's changelog page remaining the whole story.
 */
export function buildAnnouncement(release, publicUrl) {
  const base = publicUrl.replace(/\/+$/, '');
  const headline =
    release.version === null
      ? '📡 **The hub just updated**'
      : `📡 **The hub just updated — v${release.version}**`;

  /*
   * One commit routinely lands in BOTH member-facing sections (a shared component moves), and
   * naming it twice reads like a stutter. The companion bullet therefore takes the first
   * companion subject the website bullet did not already claim.
   */
  const firstIn = (key, taken = null) => {
    const entry = release.entries.find(
      (e) => e.sections.includes(key) && clampSubject(e.subject) !== taken,
    );
    return entry === undefined ? null : clampSubject(entry.subject);
  };
  const webSubject = firstIn('website');
  const bullets = [webSubject, firstIn('companion', webSubject)]
    .filter((subject) => subject !== null)
    .map((subject) => `• ${subject}`);

  const countLine =
    release.commitCount === 1 ? '1 change is live' : `${release.commitCount} changes are live`;

  const content = [
    headline,
    '',
    // A deploy with nothing member-facing still announces honestly, just without bullets.
    bullets.length === 0 ? `${countLine}.` : `${countLine}, including:`,
    ...bullets,
    '',
    `Full changelog: ${base}/changelog`,
  ].join('\n');

  const section = (title, key) => {
    const subjects = release.entries
      .filter((e) => e.sections.includes(key))
      .map((e) => `- ${e.subject}`);
    return subjects.length === 0 ? null : `## ${title}\n\n${subjects.join('\n')}`;
  };
  const sections = [
    section('Website', 'website'),
    section('Companion App', 'companion'),
    section('Platform', 'platform'),
  ].filter((s) => s !== null);

  return {
    content,
    forumTitle:
      release.version === null
        ? `Hub update — ${release.toSha.slice(0, 8)}`
        : `Hub update — v${release.version}`,
    forumBody: [content, ...sections].join('\n\n'),
  };
}

/**
 * The INSERT the deploy script pipes into psql AFTER the changelog row lands.
 *
 * Everything member-visible travels dollar-quoted, same doctrine as renderSql: commit prose can
 * contain any quoting a person can type, and so can a URL somebody put in an env file.
 */
export function renderAnnounceSql(release, publicUrl) {
  const announcement = buildAnnouncement(release, publicUrl);
  return [
    `INSERT INTO announcements (kind, content, forum_title, forum_body)`,
    `VALUES ('deploy', ${dollarQuote(announcement.content)}, ${dollarQuote(announcement.forumTitle)}, ${dollarQuote(announcement.forumBody)});`,
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
  const opts = { from: null, to: 'HEAD', repo: null, mode: 'markdown', publicUrl: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') opts.from = argv[(i += 1)];
    else if (arg === '--to') opts.to = argv[(i += 1)];
    else if (arg === '--repo') opts.repo = argv[(i += 1)];
    else if (arg === '--json') opts.mode = 'json';
    else if (arg === '--sql') opts.mode = 'sql';
    else if (arg === '--announce-sql') opts.mode = 'announce';
    else if (arg === '--public-url') opts.publicUrl = argv[(i += 1)];
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

  if ((opts.mode === 'sql' || opts.mode === 'announce') && commits.length === 0) {
    // A redeploy of the same revision must not write an empty release row —
    // an entry that says "nothing changed" is clutter, not a changelog. The
    // same holds a fortiori for announcing it to the whole squadron.
    process.stdout.write(`-- no commits between ${fromSha} and ${toSha}; nothing to record\n`);
    return;
  }

  if (opts.mode === 'json') {
    process.stdout.write(`${JSON.stringify(release, null, 2)}\n`);
  } else if (opts.mode === 'sql') {
    process.stdout.write(renderSql(release));
  } else if (opts.mode === 'announce') {
    /*
     * The link in the announcement must be the address MEMBERS use, which only the caller
     * knows. deploy.sh passes its own PUBLIC_URL; the env fallback covers a by-hand recovery
     * run on the production box, where the variable is already exported.
     */
    const publicUrl = opts.publicUrl ?? process.env.PUBLIC_URL ?? null;
    if (publicUrl === null || publicUrl === '') {
      fail('--announce-sql needs --public-url <url> (or $PUBLIC_URL) for the changelog link');
    }
    process.stdout.write(renderAnnounceSql(release, publicUrl));
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
