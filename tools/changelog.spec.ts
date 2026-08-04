import { describe, it, expect } from 'vitest';
import {
  sectionsFor,
  humanizeSubject,
  firstParagraph,
  parseGitLog,
  buildRelease,
  renderMarkdown,
  renderSql,
  type ChangelogCommit,
} from './changelog.mjs';

/**
 * The changelog generator's pure core.
 *
 * The CLI shell (argument parsing, git invocation, the deployed-SHA marker) is
 * exercised by running the tool; what these tests pin is the part that decides
 * WHAT MEMBERS ARE TOLD — which section a change lands in, how much of the
 * commit's own prose survives, and whether the SQL mode can be trusted with
 * prose containing any quoting a person can type.
 */

describe('sectionsFor — which shelf a commit lands on', () => {
  it('MANDATORY: web files are Website, companion files are Companion App', () => {
    expect(sectionsFor(['apps/web/src/app/page.tsx'])).toEqual(['website']);
    expect(sectionsFor(['apps/companion/src/config.ts'])).toEqual(['companion']);
  });

  it('MANDATORY: a commit touching web AND companion lands in both', () => {
    const sections = sectionsFor(['apps/web/src/x.tsx', 'apps/companion/src/y.ts']);
    expect(sections).toContain('website');
    expect(sections).toContain('companion');
  });

  it('api, worker, bot and packages are Platform', () => {
    for (const file of [
      'apps/api/src/main.ts',
      'apps/worker/src/daemon.ts',
      'apps/bot/src/index.ts',
      'packages/shared/src/permissions.ts',
    ]) {
      expect(sectionsFor([file]), file).toEqual(['platform']);
    }
  });

  it('infra and tooling are Platform too — a deploy note that hides "the deploy machinery changed" misleads', () => {
    expect(sectionsFor(['infra/scripts/deploy.sh'])).toEqual(['platform']);
    expect(sectionsFor(['tools/changelog.mjs'])).toEqual(['platform']);
  });

  it('an empty file list still lands somewhere rather than vanishing', () => {
    expect(sectionsFor([])).toEqual(['platform']);
  });
});

describe('humanizeSubject — strip the machinery, keep the words', () => {
  it('MANDATORY: removes the type(scope): prefix and capitalises what remains', () => {
    expect(humanizeSubject('feat(shipyard): name a hull, or name a budget')).toBe(
      'Name a hull, or name a budget',
    );
    expect(humanizeSubject('fix(nav): the signed-in navbar was the sidebar in disguise')).toBe(
      'The signed-in navbar was the sidebar in disguise',
    );
  });

  it('handles a bare type and a breaking-change marker', () => {
    expect(humanizeSubject('chore: prune the build cache')).toBe('Prune the build cache');
    expect(humanizeSubject('feat!: drop the legacy pairing flow')).toBe(
      'Drop the legacy pairing flow',
    );
  });

  it('leaves a subject with no prefix alone apart from the capital', () => {
    expect(humanizeSubject('the deploy took fifteen minutes')).toBe(
      'The deploy took fifteen minutes',
    );
  });

  it('does not eat a subject that is ONLY a prefix-shaped string', () => {
    // Degenerate, but a generator that returns '' here renders a heading with
    // no text — worse than showing the odd subject as written.
    expect(humanizeSubject('fix:  ')).toBe('fix:');
  });
});

describe('firstParagraph — the part written for a reader', () => {
  it('takes the first paragraph and stops at the first blank line', () => {
    expect(firstParagraph('The opening statement.\n\nImplementation notes nobody needs.')).toBe(
      'The opening statement.',
    );
  });

  it('MANDATORY: a paragraph ending in a colon brings along what it introduces', () => {
    // "Two waves, both specced to the bone:" alone is a drum roll without the
    // song — the introduced paragraph is the actual content.
    const body = 'Two waves, both specced to the bone:\n\nThe first wave did X.\n\nTrailing notes.';
    expect(firstParagraph(body)).toBe('Two waves, both specced to the bone:\n\nThe first wave did X.');
  });

  it('an empty body produces an empty detail, not a crash', () => {
    expect(firstParagraph('')).toBe('');
  });
});

describe('parseGitLog — the wire format', () => {
  const REC = '\u0001';
  const UNIT = '\u0002';
  const END = '\u0003';

  it('MANDATORY: recovers sha, subject, body and files from a two-commit log', () => {
    const raw =
      `${REC}aaaa${UNIT}feat(x): first subject\n\nFirst body.\n${END}\n\napps/web/src/a.tsx\npackages/shared/src/b.ts\n` +
      `${REC}bbbb${UNIT}fix: second subject\n${END}\n\napps/companion/src/c.ts\n`;

    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      sha: 'aaaa',
      subject: 'feat(x): first subject',
      body: 'First body.',
      files: ['apps/web/src/a.tsx', 'packages/shared/src/b.ts'],
    });
    expect(commits[1]).toMatchObject({ sha: 'bbbb', body: '', files: ['apps/companion/src/c.ts'] });
  });

  it('is not confused by prose — only the control separators structure the parse', () => {
    const raw = `${REC}cccc${UNIT}docs: subject\n\nA body with ## headings, 'quotes' and --flags.\n${END}\n\nREADME.md\n`;
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.body).toContain('## headings');
  });
});

describe('the assembled release', () => {
  const commits: ChangelogCommit[] = [
    {
      sha: 'a'.repeat(40),
      subject: 'feat(web): a website change',
      body: 'Why the website changed.',
      files: ['apps/web/src/x.tsx'],
    },
    {
      sha: 'b'.repeat(40),
      subject: 'feat(api): a platform change',
      body: 'Why the API changed.',
      files: ['apps/api/src/y.ts'],
    },
  ];

  const release = buildRelease({
    fromSha: 'c'.repeat(40),
    toSha: 'd'.repeat(40),
    commits,
    generatedAt: '2026-08-04T00:00:00.000Z',
  });

  it('MANDATORY: per-section markdown carries the commit prose, not a summary of it', () => {
    expect(release.websiteMd).toBe('### A website change\n\nWhy the website changed.');
    expect(release.platformMd).toBe('### A platform change\n\nWhy the API changed.');
    expect(release.companionMd).toBe('');
  });

  it('the stdout rendering says plainly when a section has nothing', () => {
    const md = renderMarkdown(release);
    expect(md).toContain('## Companion App');
    expect(md).toContain('_Nothing in this range touched the companion app._');
  });

  it('MANDATORY: the SQL mode dollar-quotes, and moves its tag when the prose contains it', () => {
    const hostile = buildRelease({
      fromSha: 'e'.repeat(40),
      toSha: 'f'.repeat(40),
      commits: [
        {
          sha: 'a'.repeat(40),
          subject: "feat: quoting torture",
          body: "It's got 'quotes', \"doubles\", $grimslog$ itself, and a ; semicolon.",
          files: ['apps/api/src/z.ts'],
        },
      ],
      generatedAt: '2026-08-04T00:00:00.000Z',
    });

    const sql = renderSql(hostile);
    // The default tag appears in the CONTENT, so the quoting must have chosen
    // a longer one — otherwise the statement truncates mid-prose.
    expect(sql).toContain('$grimslogx$');
    expect(sql).toContain('INSERT INTO changelog_releases');
    expect(sql).toContain(`'${'e'.repeat(40)}'`);
  });
});
