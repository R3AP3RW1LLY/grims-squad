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
  commitCount: number;
  websiteMd: string;
  companionMd: string;
  platformMd: string;
  entries: ChangelogEntry[];
}

export declare const GIT_LOG_FORMAT: string;

export declare function sectionsFor(files: readonly string[]): string[];
export declare function humanizeSubject(subject: string): string;
export declare function firstParagraph(body: string): string;
export declare function parseGitLog(raw: string): ChangelogCommit[];
export declare function buildRelease(input: {
  fromSha: string;
  toSha: string;
  commits: ChangelogCommit[];
  generatedAt: string;
}): ChangelogRelease;
export declare function renderMarkdown(release: ChangelogRelease): string;
export declare function renderSql(release: ChangelogRelease): string;
