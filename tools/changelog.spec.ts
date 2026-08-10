import { describe, it, expect } from 'vitest';
import {
  fitForMembers,
  sectionsFor,
  humanizeSubject,
  firstParagraph,
  parseGitLog,
  buildRelease,
  renderMarkdown,
  renderSql,
  buildAnnouncement,
  renderAnnounceSql,
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
      body: 'Why the website changed.\n\nMembers: What members see on the website.',
      files: ['apps/web/src/x.tsx'],
    },
    {
      sha: 'b'.repeat(40),
      subject: 'feat(api): a platform change',
      body: 'Why the API changed.\n\nMembers: What members see across the platform.',
      files: ['apps/api/src/y.ts'],
    },
  ];

  const release = buildRelease({
    fromSha: 'c'.repeat(40),
    toSha: 'd'.repeat(40),
    commits,
    generatedAt: '2026-08-04T00:00:00.000Z',
  });

  it('MANDATORY: per-section markdown carries the MEMBER-FACING prose, not the commit body', () => {
    /*
     * Changed 2026-08-06. This used to assert the commit body was published verbatim, which is how
     * "the planner believed market_entries held 30,281 rows" and a production IP address nearly
     * reached 107 members. A commit body is written for whoever maintains this in a year; the
     * `Members:` trailer is written for the squadron.
     */
    expect(release.websiteMd).toBe('What members see on the website.');
    expect(release.platformMd).toBe('What members see across the platform.');
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
          body: "Members: It's got 'quotes', \"doubles\", $grimslog$ itself, and a ; semicolon.",
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

describe('the deploy announcement — what the whole squadron is told', () => {
  const commits: ChangelogCommit[] = [
    {
      sha: 'a'.repeat(40),
      subject: 'feat(web): a website change',
      body: 'Why the website changed.',
      files: ['apps/web/src/x.tsx'],
    },
    {
      sha: 'b'.repeat(40),
      subject: 'feat(companion): a companion change',
      body: 'Why the companion changed.',
      files: ['apps/companion/src/y.ts'],
    },
    {
      sha: 'c'.repeat(40),
      subject: 'feat(api): a platform change',
      body: 'Why the API changed.',
      files: ['apps/api/src/z.ts'],
    },
  ];

  const release = buildRelease({
    fromSha: 'e'.repeat(40),
    toSha: 'f'.repeat(40),
    commits,
    generatedAt: '2026-08-04T00:00:00.000Z',
    version: '0.5.1',
  });

  it('MANDATORY: the approved content shape — headline, count, one bullet per member-facing shelf, link', () => {
    const { content } = buildAnnouncement(release, 'https://grims-squad.com');
    expect(content).toBe(
      [
        '📡 **The hub just updated — v0.5.1**',
        '',
        '3 changes are live, including:',
        '• A website change',
        '• A companion change',
        '',
        'Full changelog: https://grims-squad.com/changelog',
      ].join('\n'),
    );
  });

  it('the forum copy is titled per version and condenses every section to subject bullets', () => {
    const { forumTitle, forumBody } = buildAnnouncement(release, 'https://grims-squad.com');
    expect(forumTitle).toBe('Hub update — v0.5.1');
    expect(forumBody).toContain('## Website\n\n- A website change');
    expect(forumBody).toContain('## Companion App\n\n- A companion change');
    expect(forumBody).toContain('## Platform\n\n- A platform change');
    // The Discord message leads the forum copy, so both audiences read the same opening.
    expect(forumBody.startsWith('📡 **The hub just updated — v0.5.1**')).toBe(true);
  });

  it('a commit landing in both member-facing sections is bulleted once, not stuttered', () => {
    const shared = buildRelease({
      fromSha: 'e'.repeat(40),
      toSha: 'f'.repeat(40),
      commits: [
        {
          sha: 'a'.repeat(40),
          subject: 'feat: one number for both surfaces',
          body: '',
          files: ['apps/web/src/x.tsx', 'apps/companion/src/y.ts'],
        },
        {
          sha: 'b'.repeat(40),
          subject: 'feat(companion): a companion-only change',
          body: '',
          files: ['apps/companion/src/z.ts'],
        },
      ],
      generatedAt: '2026-08-04T00:00:00.000Z',
      version: '0.5.1',
    });
    const { content } = buildAnnouncement(shared, 'https://grims-squad.com');
    expect(content).toContain('• One number for both surfaces');
    expect(content).toContain('• A companion-only change');
    expect(content.match(/• One number for both surfaces/g)).toHaveLength(1);
  });

  it('a platform-only deploy announces honestly, without inventing bullets', () => {
    const platformOnly = buildRelease({
      fromSha: 'e'.repeat(40),
      toSha: 'f'.repeat(40),
      commits: [commits[2] as ChangelogCommit],
      generatedAt: '2026-08-04T00:00:00.000Z',
      version: '0.5.1',
    });
    const { content } = buildAnnouncement(platformOnly, 'https://grims-squad.com');
    expect(content).toContain('1 change is live.');
    expect(content).not.toContain('•');
    expect(content).not.toContain('including:');
  });

  it('MANDATORY truncation-safety: a monstrous subject cannot push the message past Discord', () => {
    const monstrous = buildRelease({
      fromSha: 'e'.repeat(40),
      toSha: 'f'.repeat(40),
      commits: [
        {
          sha: 'a'.repeat(40),
          subject: `feat(web): ${'x'.repeat(5000)}`,
          body: '',
          files: ['apps/web/src/x.tsx'],
        },
      ],
      generatedAt: '2026-08-04T00:00:00.000Z',
      version: '0.5.1',
    });
    const { content } = buildAnnouncement(monstrous, 'https://grims-squad.com');
    // The bot's truncateForDiscord is the hard 2000 guarantee; this clamp is what
    // keeps the message READABLE rather than merely deliverable.
    expect(content.length).toBeLessThan(2000);
    expect(content).toContain('…');
  });

  it('a version-less range still announces, keyed on the revision rather than a fiction', () => {
    const unversioned = buildRelease({
      fromSha: 'e'.repeat(40),
      toSha: 'f'.repeat(40),
      commits: [commits[0] as ChangelogCommit],
      generatedAt: '2026-08-04T00:00:00.000Z',
      version: null,
    });
    const { content, forumTitle } = buildAnnouncement(unversioned, 'https://grims-squad.com');
    expect(content).toContain('📡 **The hub just updated**');
    expect(forumTitle).toBe(`Hub update — ${'f'.repeat(8)}`);
  });

  it('MANDATORY: the announce SQL dollar-quotes everything member-visible and targets announcements', () => {
    const sql = renderAnnounceSql(release, "https://grims-squad.com/it's$grimslog$");
    expect(sql).toContain('INSERT INTO announcements');
    expect(sql).toContain(`'deploy'`);
    // The hostile URL contains the default tag, so the quoting must have moved it.
    expect(sql).toContain('$grimslogx$');
  });

  it('trims a trailing slash from the public URL rather than linking //changelog', () => {
    const { content } = buildAnnouncement(release, 'https://grims-squad.com/');
    expect(content).toContain('Full changelog: https://grims-squad.com/changelog');
  });
});

/**
 * What must never reach a page every member reads.
 *
 * ★ IT SHIPPED ONCE — 2026-08-05 ★
 *
 * The squadron owner reported a bug in strong terms; I quoted them word for word in a commit body
 * because that is how this repository writes; and the changelog did exactly what it promises,
 * carrying the author's own words through to the public page. Every member read it.
 *
 * Their instruction was that it must never happen again — and a discipline that has to be
 * remembered at the moment somebody is quoting an angry bug report is not a discipline. The tool
 * guards instead.
 *
 * The git history is untouched. This is about PUBLICATION, and nothing else.
 */
describe('fitForMembers', () => {
  it('MANDATORY: drops a paragraph quoting language a changelog must not carry', () => {
    const detail = 'The sign-in callback failed.\n\n*"what the fuck! fix this shit."*';

    expect(fitForMembers(detail)).toBe('The sign-in callback failed.');
  });

  it('MANDATORY: keeps the engineering note that came with it', () => {
    /*
     * A whole paragraph rather than a masked word: `f***` in a release note is still obviously a
     * quotation of somebody swearing and reads worse than the explanation standing alone. Every
     * commit names its change in the subject line, so this costs a sentence and never an entry.
     */
    const detail =
      '*"this is shit!"*\n\nBrowsers now get an error page; the app still gets the data it needs.';

    expect(fitForMembers(detail)).toBe(
      'Browsers now get an error page; the app still gets the data it needs.',
    );
  });

  it('MANDATORY: Scunthorpe is a place, not a swear word', () => {
    /*
     * Without word boundaries this is the classic false positive, and Elite's galaxy is full of
     * procedurally generated names. A release note silently deleted by a system name would be a
     * bug nobody could ever explain.
     */
    const detail = 'Route planning now handles the run out to Scunthorpe Dock correctly.';
    expect(fitForMembers(detail)).toBe(detail);
  });

  it('ordinary prose is untouched, including the colon-introduction shape', () => {
    const detail = 'Two waves, both specced to the bone:\n\nThe first wave landed.';
    expect(fitForMembers(detail)).toBe(detail);
  });

  it('an entry that was ONLY a quote becomes empty rather than half a sentence', () => {
    // The subject line still names the change, so the entry survives without its detail.
    expect(fitForMembers('*"what the fuck"*')).toBe('');
  });
});

describe('members are told what changed for them, not how it was built', () => {
  /*
   * ★ SQUADRON OWNER, TWICE ★
   *
   * 2026-08-05: "do not ever show anything like this in the changelog again", after a commit body
   * quoting them swearing was published verbatim. `fitForMembers` was the answer to that one.
   *
   * 2026-08-06: the same mechanism was about to publish "The planner believed market_entries held
   * 30,281 rows... pg_stat_user_tables reported last_analyze = never", and the production worker
   * box's PUBLIC IP ADDRESS, to 107 members.
   *
   * The first fix treated a symptom. The cause is that commit bodies are written for whoever
   * maintains this in a year — they are supposed to be full of table names and measurements — and
   * publishing them to members was never going to work by filtering hard enough.
   *
   * So a commit now SAYS what members should be told, in a `Members:` trailer, or it says nothing
   * to them at all. An infrastructure change genuinely is not member news, and a changelog that
   * omits it is more honest than one that describes a WireGuard tunnel to people who fly ships.
   */

  it('MANDATORY: a commit with no Members: trailer is not published to members', () => {
    const release = buildRelease({
      fromSha: 'a',
      toSha: 'b',
      generatedAt: '2026-08-06T07:00:00.000Z',
      commits: [
        {
          sha: 'deadbeef',
          subject: 'feat(infra): the primary stops running the workers',
          body: 'They now run on their own machine (149.248.39.225) over a WireGuard tunnel.',
          files: ['apps/web/src/page.tsx'],
        },
      ],
    });

    expect(
      release.websiteMd,
      'an untagged engineering commit reached the member-facing changelog',
    ).toBe('');
  });

  it('MANDATORY: a Members: trailer is what gets published', () => {
    const release = buildRelease({
      fromSha: 'a',
      toSha: 'b',
      generatedAt: '2026-08-06T07:00:00.000Z',
      commits: [
        {
          sha: 'deadbeef',
          subject: 'fix(perf): the planner believed market_entries held 30,281 rows',
          body: [
            'It held 18,847,651, and pg_stat_user_tables reported last_analyze = never.',
            '',
            'Members: Colonisation pages are fast again — the "where to buy" list was taking over',
            'a minute and often came back empty. It now answers in under a second.',
          ].join('\n'),
          files: ['apps/web/src/page.tsx'],
        },
      ],
    });

    expect(release.websiteMd).toContain('Colonisation pages are fast again');
    expect(release.websiteMd, 'engineering detail leaked past the trailer').not.toContain(
      'pg_stat_user_tables',
    );
    expect(release.websiteMd, 'the raw row count leaked').not.toContain('18,847,651');
  });

  it('MANDATORY: an address never reaches members even inside a Members: trailer', () => {
    /*
     * Belt and braces. The trailer is written by hand and a hand can paste an IP into it; the
     * consequence of that mistake is publishing infrastructure to the internet, so it is worth
     * catching in two places rather than one.
     */
    const release = buildRelease({
      fromSha: 'a',
      toSha: 'b',
      generatedAt: '2026-08-06T07:00:00.000Z',
      commits: [
        {
          sha: 'deadbeef',
          subject: 'fix: something',
          body: 'Members: Ingestion moved to 149.248.39.225 and is faster now.',
          files: ['apps/web/src/page.tsx'],
        },
      ],
    });

    expect(release.websiteMd, 'a server address was published to members').not.toMatch(
      /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    );
  });

  it('the trailer still loses a paragraph that quotes swearing', () => {
    const release = buildRelease({
      fromSha: 'a',
      toSha: 'b',
      generatedAt: '2026-08-06T07:00:00.000Z',
      commits: [
        {
          sha: 'deadbeef',
          subject: 'fix: something',
          body: 'Members: We fixed the shit out of this.',
          files: ['apps/web/src/page.tsx'],
        },
      ],
    });

    expect(release.websiteMd).not.toContain('shit');
  });
});

/**
 * ★ A RELEASE WENT OUT WITH AN EMPTY CHANGELOG — 2026-08-10 ★
 *
 * The colonisation shopping list was rebuilt that day: fleet carriers dropped from it, each
 * material named at ONE station instead of six, a fresh "nobody has bought these yet" list. A panel
 * members read before deciding where to fly, changed completely.
 *
 * The commit carried no `Members:` trailer, so this tool published nothing — correctly, by its own
 * rules — and said nothing about having published nothing. The deploy reported success, the
 * changelog row went in empty, and the first anybody would have known was noticing the page had
 * changed under them.
 *
 * ★ THE OMISSION IS THE DESIGN; THE SILENCE IS NOT ★
 *
 * Leaving plumbing out is right and stays. But the tool can tell the two apart: a commit that
 * touched `apps/web/` was somebody meaning to change what members see, and producing nothing for
 * that section is worth a sentence to whoever is watching the deploy.
 *
 * Reported, never enforced — a type-only refactor under `apps/web/` genuinely is not member news,
 * and a tool that refused to record a release over a missing sentence would turn a missing note
 * into a missing changelog.
 */
describe('a release that says nothing about a member-facing change says so', () => {
  const release = (commits) =>
    buildRelease({
      fromSha: 'a'.repeat(40),
      toSha: 'b'.repeat(40),
      commits,
      generatedAt: '2026-08-10T22:00:00.000Z',
    });

  it('★ MANDATORY: the website changed and nobody wrote a member note — that is named ★', () => {
    /*
     * This is 4ddb936 in miniature: real work under apps/web, a body written for engineers, no
     * trailer. Before this existed the tool returned three empty sections and exited 0.
     */
    const out = release([
      {
        sha: 'c'.repeat(40),
        subject: 'feat(colonisation): a shopping route, not a shopping record',
        body: 'The panel listed every station the squadron had ever bought at.',
        files: ['apps/web/src/app/(hub)/colonisation/[id]/purchase-catalogue.tsx'],
      },
    ]);

    expect(out.websiteMd, 'the rules are unchanged: no trailer still means no entry').toBe('');
    expect(
      out.silentSections,
      'the website changed and the release is silent about it, and nothing said so',
    ).toEqual(['website']);
  });

  it('★ MANDATORY: plumbing stays silent WITHOUT complaint — that is the design ★', () => {
    /*
     * The half that must not regress. An index, a CI retry, a deploy script: genuinely not member
     * news, deliberately omitted, and warning about them would train everybody to ignore the
     * warning that matters.
     */
    const out = release([
      {
        sha: 'd'.repeat(40),
        subject: 'fix(deploy): the box had been running a deploy script from 30 July',
        body: 'A copy taken once on 30 July and never taken again.',
        files: ['infra/scripts/deploy.sh', 'tools/deploy-script.spec.ts'],
      },
    ]);

    expect(out.platformMd).toBe('');
    expect(out.silentSections, 'plumbing with no note is not a problem to report').toEqual([]);
  });

  it('MANDATORY: a commit that DOES tell members is not reported as silent', () => {
    const out = release([
      {
        sha: 'e'.repeat(40),
        subject: 'feat(colonisation): a shopping route',
        body:
          'Engineering detail nobody outside this repo needs.\n\n' +
          'Members: Where the squadron has bought it is now a route — no fleet carriers, and each ' +
          'material is listed at a single station so two people do not fly for the same Steel.',
        files: ['apps/web/src/app/(hub)/colonisation/[id]/purchase-catalogue.tsx'],
      },
    ]);

    expect(out.websiteMd).toContain('no fleet carriers');
    expect(out.silentSections).toEqual([]);
  });

  it('MANDATORY: it names every silent section, not just the first', () => {
    // A release that changes both apps and says nothing about either must report both, or the
    // second one is exactly as invisible as it was before.
    const out = release([
      {
        sha: 'f'.repeat(40),
        subject: 'feat(colonisation): route on both surfaces',
        body: 'No trailer here either.',
        files: [
          'apps/web/src/lib/api.ts',
          'apps/companion/src/renderer/colonisation.tsx',
        ],
      },
    ]);

    expect([...out.silentSections].sort()).toEqual(['companion', 'website']);
  });

  it('a range with no commits at all reports nothing to report', () => {
    // A redeploy of the same revision. There is no silence to complain about when nothing shipped.
    expect(release([]).silentSections).toEqual([]);
  });
});
