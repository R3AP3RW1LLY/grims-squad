/**
 * The type surface of `changelog.mjs`, for the test suite and for anything
 * else in the workspace that wants to reuse the generator's pure functions.
 *
 * ★ WHY A DECLARATION FILE RATHER THAN A .ts SOURCE ★
 *
 * The generator must run as `node tools/changelog.mjs` on the production box
 * during a deploy — no tsx, no build step, nothing to install. That forces
 * plain JavaScript. The workspace's tsconfig deliberately checks only .ts
 * files, so this file is how the .mjs keeps a typed boundary the spec can
 * import through without turning allowJs on for the whole package.
 */

export interface ChangelogCommit {
  sha: string;
  subject: string;
  body: string;
  files: string[];
}

export interface ChangelogEntry {
  sha: string;
  subject: string;
  detail: string;
  sections: string[];
}

export interface ChangelogRelease {
  fromSha: string;
  toSha: string;
  generatedAt: string;
  version: string | null;
  commitCount: number;
  websiteMd: string;
  companionMd: string;
  platformMd: string;
  entries: ChangelogEntry[];
  /**
   * Member-facing sections where something shipped and nothing was said about it.
   *
   * `'website'` and `'companion'` only — platform is the plumbing shelf and is silent by design,
   * so including it would fire on nearly every release and train everybody to ignore the warning.
   */
  silentSections: Array<'website' | 'companion'>;
}

/** The deploy announcement's three member-facing texts — see buildAnnouncement. */
export interface DeployAnnouncement {
  content: string;
  forumTitle: string;
  forumBody: string;
}

export declare const GIT_LOG_FORMAT: string;

export declare function sectionsFor(files: readonly string[]): string[];
export declare function humanizeSubject(subject: string): string;
export declare function firstParagraph(body: string): string;
/**
 * Drops any paragraph of a detail quoting language a members' page must not carry.
 *
 * Publication hygiene, not censorship of the repository: the commit body keeps every word, and
 * only what is PUBLISHED is filtered. See the note on `NOT_FOR_MEMBERS` in changelog.mjs for why
 * the tool guards rather than trusting whoever writes the next commit to remember.
 */
export declare function fitForMembers(detail: string): string;
export declare function parseGitLog(raw: string): ChangelogCommit[];
export declare function buildRelease(input: {
  fromSha: string;
  toSha: string;
  commits: ChangelogCommit[];
  generatedAt: string;
  version?: string | null;
}): ChangelogRelease;
export declare function renderMarkdown(release: ChangelogRelease): string;
export declare function renderSql(release: ChangelogRelease): string;
export declare function buildAnnouncement(
  release: ChangelogRelease,
  publicUrl: string,
): DeployAnnouncement;
export declare function renderAnnounceSql(release: ChangelogRelease, publicUrl: string): string;

export declare function memberSummary(body: string): string;
