/**
 * Types for probe.mjs, so the spec typechecks.
 *
 * Hand-written alongside changelog.d.mts for the same reason: the implementation is plain ESM that
 * cron runs directly, and adding a build step between a probe and the crontab that calls it is a
 * way for monitoring to break during a deploy — which is the one moment it must not.
 */
export declare const DEFAULTS: {
  slowMs: number;
  clearMs: number;
  breachesToAlert: number;
  clearsToRecover: number;
};

export interface ProbeState {
  breaches: Record<string, number>;
  clears: Record<string, number>;
  alerting: Record<string, boolean>;
}

export interface ProbeSample {
  url: string;
  ms: number;
  ok: boolean;
}

export interface ProbeEvent {
  kind: 'slow' | 'down' | 'recovered';
  url: string;
  ms: number;
  ok: boolean;
}

export declare function freshState(): ProbeState;

export declare function evaluate(
  samples: ProbeSample[],
  state: ProbeState,
  thresholds?: typeof DEFAULTS,
): { state: ProbeState; events: ProbeEvent[] };

export declare function alertContent(event: ProbeEvent): string;

export interface ProbeDestination {
  kind: 'dm' | 'channel';
  id: string;
}

export declare function destinations(
  env: Record<string, string | undefined>,
): ProbeDestination[];
