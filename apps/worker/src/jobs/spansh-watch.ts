/**
 * Deciding that a construction site has stopped existing, from somebody else's data.
 *
 * ★ WHY THERE IS NO BETTER SIGNAL, WHICH IS THE WHOLE REASON THIS FILE IS SO CAREFUL ★
 *
 * A finished installation or settlement is NOT DOCKABLE. The construction site ceases to exist, so
 * no journal event will ever mention it again, from anybody, ever. EDDN carries seven journal
 * schemas and not one of them is colonisation; Inara's two read endpoints are unrelated; Frontier
 * publishes nothing. The only remaining observable is the site VANISHING from a system's station
 * list, and Spansh is the aggregator that sees the most sources.
 *
 * ★ AND WHY ABSENCE IS THE MOST DANGEROUS KIND OF EVIDENCE THERE IS ★
 *
 * "Not in this response" and "not in the galaxy" are the same bytes. A refresh that has not run, a
 * partial nightly dump, a row served without its station list, a rate limit, a name rendered
 * differently — every one of them looks exactly like a finished build. And the cost is not
 * symmetric: a build closed a day late costs a day, while a build closed WRONGLY tells a squadron
 * to stop hauling to a site that is still live and still counting down.
 *
 * So every rule below is a way of refusing to close. The job prefers to say nothing.
 */

import { completeColonyProject } from '@grims/db';
import type { PrismaClient } from '@grims/db';

/**
 * How many separate absences before a site may be called gone.
 *
 * Two. One is a bad dump; the pair is a pattern. More than two would push the close days past the
 * point where the squadron has already worked it out for themselves.
 */
export const MIN_MISSES = 2;

/**
 * And how far apart those absences must be, in hours.
 *
 * ★ THE COUNT ALONE IS NOT A RULE ★
 *
 * Two polls a minute apart are ONE observation: they read the same cached answer from the same
 * dump. Without a wall-clock span, a daemon on a five-minute timer would close a build ten minutes
 * after a single bad response landed.
 *
 * A day is longer than any refresh cycle Spansh runs and shorter than the patience of somebody
 * waiting to see their build marked finished.
 */
export const MIN_MISS_SPAN_HOURS = 24;

/** What we have observed about one site over time. Small, because it is stored per project. */
export interface SiteLedger {
  /** When Spansh last listed the site. Null until it ever has — see `never-seen`. */
  readonly seenAt: string | null;
  readonly misses: number;
  /** The FIRST absence of the current streak, which is what dates a close. */
  readonly missAt: string | null;
  /**
   * The other stations listed beside the site when we last saw it, normalised.
   *
   * These are what make a later absence mean anything: if the neighbours are still being reported
   * and the site is not, the row was refreshed and the site really is missing from it. If they have
   * gone too, Spansh has handed us a different view of the system and we have learned nothing.
   */
  readonly witnesses: readonly string[];
}

export const EMPTY_LEDGER: SiteLedger = {
  seenAt: null,
  misses: 0,
  missAt: null,
  witnesses: [],
};

export interface ProbedStation {
  readonly name: string;
  readonly marketId: bigint | null;
}

/**
 * What one system lookup produced.
 *
 * `answered: false` is deliberately not an empty station list. The two are different facts and
 * conflating them is exactly how this job would close every build in the squadron during an outage.
 */
export type SystemProbe =
  | { readonly answered: true; readonly stations: readonly ProbedStation[] }
  | { readonly answered: false; readonly why: string };

export interface WatchedProject {
  readonly projectId: string;
  readonly title: string;
  readonly systemName: string;
  /** Null for a build posted before the station name was captured. Unjudgeable, and says so. */
  readonly stationName: string | null;
  readonly marketId: bigint | null;
  /** Last time somebody was physically docked there. First-party evidence the site exists. */
  readonly lastDepotAt: Date | null;
  readonly lastDeliveryAt: Date | null;
}

export type VerdictKind =
  | 'present'
  | 'never-seen'
  | 'unknown'
  | 'no-witness'
  | 'first-miss'
  | 'too-soon'
  | 'contradicted'
  | 'unjudgeable'
  | 'gone';

export interface Verdict {
  readonly kind: VerdictKind;
  readonly ledger: SiteLedger;
  /** Set only for `gone`: the FIRST absence, which is our best estimate of when it finished. */
  readonly goneSince?: Date | null;
}

/**
 * Station names compared the way a person would, and no more loosely than that.
 *
 * Case, punctuation and runs of whitespace are noise — three sources spell one station three ways.
 * Everything else is kept, because the rename this job exists to detect is a SHORTENING: "Orbital
 * Construction Site: Zeta" becomes "Zeta" when it finishes. A substring match would call the
 * finished port the still-live site and the job would never close an orbital build at all.
 *
 * Being strict can only ever cost a close we do not make. If our name never matches theirs we never
 * record a sighting, so the site reports `never-seen` and nothing is closed — never the reverse.
 */
function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Any way of finding the site counts as finding it, because finding it is the SAFE answer. */
function findsSite(project: WatchedProject, stations: readonly ProbedStation[]): boolean {
  const wanted = project.stationName === null ? '' : key(project.stationName);

  for (const station of stations) {
    if (project.marketId !== null && station.marketId !== null && station.marketId === project.marketId) {
      return true;
    }
    if (wanted !== '' && key(station.name) === wanted) return true;
  }
  return false;
}

const laterOf = (a: Date | null, b: Date | null): Date | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
};

/**
 * One site, one Spansh answer, one verdict.
 *
 * Pure: every input is a parameter and `now` is passed in, so each refusal below is reachable from
 * a test. That matters more here than almost anywhere else in the codebase — the whole value of
 * this job is the set of cases in which it declines to act.
 */
export function judgeSite(
  project: WatchedProject,
  probe: SystemProbe,
  ledger: SiteLedger,
  now: Date,
): Verdict {
  // Nothing to look for. Reported rather than silently never closing: "we cannot judge this one" is
  // a fact an operator can act on.
  if (project.stationName === null || project.stationName.trim() === '') {
    return { kind: 'unjudgeable', ledger };
  }

  /*
   * `systemsNear` swallows every failure and returns whatever it had, so a timeout, a rate limit
   * and a genuinely unknown system are indistinguishable at the call site. Counting any of them as
   * an absence would mean an hour of Spansh being down closes builds.
   */
  if (!probe.answered) return { kind: 'unknown', ledger };

  /*
   * A row whose station list was not populated and a system with nothing in it are the same bytes.
   * We cannot tell them apart, so we decline to.
   */
  if (probe.stations.length === 0) return { kind: 'unknown', ledger };

  if (findsSite(project, probe.stations)) {
    return {
      kind: 'present',
      ledger: {
        seenAt: now.toISOString(),
        misses: 0,
        missAt: null,
        // Everything listed beside it, so a later absence has something to be measured against.
        witnesses: probe.stations
          .map((s) => key(s.name))
          .filter((n) => n !== '' && n !== key(project.stationName ?? '')),
      },
    };
  }

  /*
   * ★ THE POSITIVE CONTROL, AND THE MOST IMPORTANT RULE HERE ★
   *
   * If Spansh has never once listed this site, its absence is evidence of nothing: their sources
   * may never have published it, our name may not be their name, or they may hold this system
   * thinly. Without a prior sighting, "absent" means "we have no data" — and closing on no data
   * would close every project in the squadron on the first poll.
   */
  if (ledger.seenAt === null) return { kind: 'never-seen', ledger };

  /*
   * The site is gone from the list AND so is every station we saw beside it. That is not a build
   * finishing — a build finishing removes ONE station. It is a different view of the system, and we
   * learn nothing from it. The ledger is returned untouched so the streak neither grows nor resets.
   */
  const stillListed = new Set(probe.stations.map((s) => key(s.name)));
  if (!ledger.witnesses.some((w) => stillListed.has(w))) {
    return { kind: 'no-witness', ledger };
  }

  /*
   * ★ FIRST-PARTY EVIDENCE BEATS A THIRD-PARTY ABSENCE, ABSOLUTELY ★
   *
   * A depot reading exists only because a commander was physically docked at the construction site;
   * a delivery means somebody handed it cargo. Either one, NEWER than the absence we are
   * accumulating, proves that absence wrong — so the streak is wiped rather than merely tolerated.
   *
   * Only evidence newer than the first miss counts. A delivery from before it is exactly what a
   * build that has since finished looks like.
   */
  const firstMiss = ledger.missAt === null ? null : new Date(ledger.missAt);
  const newest = laterOf(project.lastDepotAt, project.lastDeliveryAt);
  if (firstMiss !== null && newest !== null && newest > firstMiss) {
    return {
      kind: 'contradicted',
      ledger: { ...ledger, misses: 0, missAt: null },
    };
  }

  const misses = ledger.misses + 1;
  // The FIRST absence of the streak is kept, because it is what dates the close.
  const missAt = ledger.missAt ?? now.toISOString();
  const next: SiteLedger = { ...ledger, misses, missAt };

  if (misses < MIN_MISSES) return { kind: 'first-miss', ledger: next };

  const spanMs = now.getTime() - new Date(missAt).getTime();
  if (spanMs < MIN_MISS_SPAN_HOURS * 3_600_000) return { kind: 'too-soon', ledger: next };

  /*
   * Dated to the FIRST miss rather than to now. That is the honest estimate: the build finished at
   * some unknown moment before we noticed, not at the moment we happened to poll for the second
   * time.
   */
  return { kind: 'gone', ledger: next, goneSince: new Date(missAt) };
}

export interface WatchDeps {
  readonly open: () => Promise<readonly WatchedProject[]>;
  readonly probe: (systemName: string) => Promise<SystemProbe>;
  readonly readLedger: () => Promise<Record<string, SiteLedger>>;
  readonly writeLedger: (ledgers: Record<string, SiteLedger>) => Promise<void>;
  readonly close: (project: WatchedProject, since: Date) => Promise<void>;
  readonly now: () => Date;
}

export interface WatchReport {
  readonly polled: number;
  readonly systemsProbed: number;
  readonly gone: ReadonlyArray<{ project: WatchedProject; since: Date }>;
  readonly closed: number;
  readonly failed: number;
}

/**
 * One sweep: probe each system once, judge every site in it, close what has been gone long enough.
 *
 * `live` defaults FALSE, exactly as `link-plans.ts` beside it. Everything about this job is a
 * judgement call on somebody else's data, so the judgement is read by a human before it is applied.
 */
export async function runSpanshWatch(
  deps: WatchDeps,
  opts: { readonly live?: boolean } = {},
): Promise<WatchReport> {
  const live = opts.live ?? false;
  const now = deps.now();

  const projects = await deps.open();
  const previous = await deps.readLedger();

  /*
   * ★ ONE PROBE PER SYSTEM, NOT PER PROJECT ★
   *
   * A system can hold six planned sites. Six lookups of one system in one run is rude to a free
   * service and tells us nothing the first lookup did not.
   */
  const systems = [...new Set(projects.map((p) => p.systemName))];
  const probes = new Map<string, SystemProbe>();
  let failed = 0;

  for (const system of systems) {
    try {
      probes.set(system, await deps.probe(system));
    } catch (e) {
      /*
       * One system failing must not lose the rest of the sweep — and it is recorded as "no answer"
       * rather than as an absence, which is the same distinction the whole file turns on.
       */
      failed += 1;
      probes.set(system, { answered: false, why: e instanceof Error ? e.message : String(e) });
    }
  }

  const gone: Array<{ project: WatchedProject; since: Date }> = [];
  /*
   * Rebuilt from the open projects rather than edited in place, so a project that has since closed
   * drops out instead of accumulating for ever in a row nobody reads.
   */
  const nextLedger: Record<string, SiteLedger> = {};

  for (const project of projects) {
    const probe = probes.get(project.systemName) ?? { answered: false as const, why: 'not probed' };
    const verdict = judgeSite(project, probe, previous[project.projectId] ?? EMPTY_LEDGER, now);

    nextLedger[project.projectId] = verdict.ledger;
    if (verdict.kind === 'gone' && verdict.goneSince != null) {
      gone.push({ project, since: verdict.goneSince });
    }
  }

  /*
   * ★ THE LEDGER IS WRITTEN EVEN IN A DRY RUN ★
   *
   * Writing down what a third party reported is an OBSERVATION, not a change to anybody's project —
   * the same reasoning `link-plans.ts` uses for running its identification in a dry run.
   *
   * Here it is load-bearing. The rule needs two misses a day apart, so a dry run that could not
   * record the first would never reach the second: the job would report "first miss" for ever and
   * the operator would never see the finding they are being asked to approve.
   */
  await deps.writeLedger(nextLedger);

  let closed = 0;
  if (live) {
    for (const g of gone) {
      try {
        await deps.close(g.project, g.since);
        closed += 1;
      } catch {
        // One database hiccup must not lose the other closes, and must not throw away the sweep.
        failed += 1;
      }
    }
  }

  return { polled: projects.length, systemsProbed: systems.length, gone, closed, failed };
}

const ENDPOINT = 'https://spansh.co.uk/api/systems/search';
const USER_AGENT = 'grims-squad/1.0 (+https://grims-squad.com)';

interface RawStation {
  name?: unknown;
  market_id?: unknown;
}

/**
 * A system's station list, out of the search the scout already uses.
 *
 * ★ EVERY FAILURE BECOMES "NO ANSWER", NEVER "EMPTY SYSTEM" ★
 *
 * A throw, a non-OK status, a system the search does not return, and a row whose `stations` carry
 * no NAMES all mean the same thing here: we did not learn anything. The client this borrows from
 * keeps only `stations.length`, so what those entries actually contain is not something our own
 * types promise — if a future payload holds ids or bare counts, this job must degrade to "I do not
 * know" rather than to "every site in the galaxy has vanished".
 */
export async function probeSystemViaSpansh(
  systemName: string,
  opts: { readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<SystemProbe> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20_000);

  try {
    const res = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      signal: ac.signal,
      body: JSON.stringify({
        filters: { distance: { min: '0', max: '1' } },
        sort: [{ distance: { direction: 'asc' } }],
        size: 10,
        page: 0,
        reference_system: systemName,
      }),
    });

    if (!res.ok) return { answered: false, why: `spansh answered ${res.status}` };

    const body = (await res.json()) as { results?: unknown };
    const rows = Array.isArray(body.results) ? (body.results as Array<Record<string, unknown>>) : [];

    // The reference system arrives among its neighbours; picked out by name, not by position.
    const wanted = key(systemName);
    const row = rows.find((r) => typeof r['name'] === 'string' && key(r['name']) === wanted);
    if (row === undefined) return { answered: false, why: 'system not in the answer' };

    const raw = Array.isArray(row['stations']) ? (row['stations'] as RawStation[]) : [];
    const stations: ProbedStation[] = [];
    for (const s of raw) {
      if (typeof s.name !== 'string' || s.name.trim() === '') continue;
      stations.push({
        name: s.name,
        marketId: typeof s.market_id === 'number' ? BigInt(s.market_id) : null,
      });
    }

    if (stations.length === 0) return { answered: false, why: 'no station names in the answer' };
    return { answered: true, stations };
  } catch (e) {
    return { answered: false, why: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Closing a build, through the one function allowed to.
 *
 * ★ completeColonyProject AND NOWHERE ELSE ★
 *
 * Four other paths end a build — close(), the depot's complete flag, the 100%-delivered rule and
 * the report-built endpoint — and every one reaches `completeColonyProject`, because the guarded
 * `updateMany` inside it is what makes the squadron hear about a finished build EXACTLY ONCE
 * however many processes noticed in the same minute.
 *
 * A fifth path that wrote `completed_at` itself would announce nothing at all, or would race the
 * daemon into announcing twice.
 */
export function spanshCloser(db: PrismaClient) {
  return async (project: WatchedProject, since: Date): Promise<void> => {
    await completeColonyProject(db, project.projectId, since);
  };
}
