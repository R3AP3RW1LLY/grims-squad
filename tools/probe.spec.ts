import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, freshState, destinations, DEFAULTS } from './probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The decision an uptime probe actually has to make.
 *
 * ★ WHY THIS IS A MODULE AND NOT TEN LINES OF BASH ★
 *
 * Every fix to the slow-deploy problem was declared done on a single observation — one fast page
 * load, one glance at a prune's output — and two of the three were wrong. The lesson is not "be
 * more careful"; it is that a claim nobody can test is a claim nobody has checked.
 *
 * So the part of the probe that DECIDES lives here, where it can be run against sequences that
 * would take an hour to reproduce against a real server: a spike that resolves, a spike that does
 * not, a recovery, a flap. The part that fetches and posts is the thin shell around it.
 *
 * ★ WHAT IT IS FOR ★
 *
 * On 2026-08-05 the site served pages at 19.95 seconds during a deploy. Nobody knew until the
 * squadron owner said so. Members are not a monitoring system, and asking them to be one is how a
 * regression survives three attempts at a fix.
 */

/** A tick's worth of samples, one URL, for readability in the sequences below. */
function tick(ms: number, ok = true) {
  return [{ url: 'https://grims-squad.com/', ms, ok }];
}

/** Run a whole sequence of ticks through the evaluator, returning every event raised. */
function run(sequence: ReturnType<typeof tick>[], thresholds = DEFAULTS) {
  let state = freshState();
  const events: Array<{ kind: string; url: string }> = [];
  for (const samples of sequence) {
    const result = evaluate(samples, state, thresholds);
    state = result.state;
    events.push(...result.events);
  }
  return { events, state };
}

describe('a probe that cries wolf gets muted, and then it is not a probe', () => {
  it('MANDATORY: one slow sample is not an incident', () => {
    /*
     * A single slow response is a garbage collection, a cold cache, a backup starting. Alerting on
     * it trains everybody to ignore the channel, which is strictly worse than no alerting at all —
     * the alerts still arrive, and now nobody reads the one that matters.
     */
    const { events } = run([tick(50), tick(9000), tick(60)]);

    expect(events, 'a single spike raised an alert').toEqual([]);
  });

  it('MANDATORY: sustained slowness alerts', () => {
    // Three consecutive breaches is roughly ninety seconds of a genuinely slow site.
    const { events } = run([tick(50), tick(9000), tick(9000), tick(9000)]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'slow', url: 'https://grims-squad.com/' });
  });

  it('MANDATORY: it alerts once, not once per tick', () => {
    /*
     * The failure that makes people mute a channel. An incident lasting twenty minutes is one
     * event; twenty copies of it is a denial of service against the humans meant to act on it.
     */
    const { events } = run([tick(9000), tick(9000), tick(9000), tick(9000), tick(9000), tick(9000)]);

    expect(events.filter((e) => e.kind === 'slow')).toHaveLength(1);
  });

  it('MANDATORY: a site that is down alerts sooner than one that is slow', () => {
    /*
     * "Slow" needs corroboration because it has innocent explanations. "Refused the connection"
     * has none worth waiting three minutes to rule out.
     */
    const { events } = run([[{ url: 'https://grims-squad.com/', ms: 0, ok: false }]]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'down' });
  });
});

describe('an alert that never clears is a permanent alarm nobody can silence', () => {
  it('MANDATORY: recovery is announced once the site is reliably fast again', () => {
    const { events } = run([
      tick(9000),
      tick(9000),
      tick(9000), // alerts
      tick(50),
      tick(50), // recovers
    ]);

    expect(events.map((e) => e.kind)).toEqual(['slow', 'recovered']);
  });

  it('MANDATORY: one fast sample mid-incident does not count as recovered', () => {
    /*
     * A saturated box is not uniformly slow — it is slow on average and occasionally fine. Calling
     * that recovered, and then alerting again a minute later, is the flap that makes an
     * alerting system worth less than nothing.
     */
    const { events } = run([
      tick(9000),
      tick(9000),
      tick(9000), // alerts
      tick(50), // one lucky sample
      tick(9000),
      tick(9000),
    ]);

    expect(events.map((e) => e.kind)).toEqual(['slow']);
  });

  it('MANDATORY: samples between the two thresholds count as neither', () => {
    /*
     * ★ THIS TEST EXISTS BECAUSE THE ONE ABOVE IT DID NOT COVER THIS ★
     *
     * The "one lucky sample" case samples at 50ms, which is a genuine clear under any reading of
     * the code — so it passes whether or not the middle ground is handled, and a mutation that
     * treated everything under the alarm as recovered survived it untouched.
     *
     * 2000ms is the case that actually matters: too slow to be well, not slow enough to alarm.
     * It is where a recovering box spends most of its time, and counting it as a clear is what
     * produces recovered/slow/recovered/slow every few minutes until somebody mutes the channel.
     */
    const between = (DEFAULTS.slowMs + DEFAULTS.clearMs) / 2;
    expect(between, 'the fixture is not actually between the thresholds').toBeGreaterThan(
      DEFAULTS.clearMs,
    );
    expect(between).toBeLessThan(DEFAULTS.slowMs);

    const { events } = run([
      tick(9000),
      tick(9000),
      tick(9000), // alerts
      tick(between),
      tick(between),
      tick(between), // limping, not well — and not three clears either
    ]);

    expect(
      events.map((e) => e.kind),
      'a site sitting between the thresholds was announced as recovered',
    ).toEqual(['slow']);
  });

  it('recovery requires clearly-well, not merely under-the-alarm', () => {
    /*
     * Alerting at 3s and recovering at 3s means a site sitting at 3.0s flaps forever. The clear
     * threshold is deliberately lower than the alarm threshold — the gap IS the hysteresis.
     */
    expect(DEFAULTS.clearMs).toBeLessThan(DEFAULTS.slowMs);
  });
});

describe('each thing watched is watched separately', () => {
  it('MANDATORY: a slow forum does not mask a healthy home page, or vice versa', () => {
    /*
     * The measurement that started all of this was per-page: `/` at 15.0s and `/forum` at 14.9s.
     * Collapsing them into one number would have hidden a regression confined to one route, which
     * is the most common kind.
     */
    let state = freshState();
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = evaluate(
        [
          { url: 'https://grims-squad.com/', ms: 50, ok: true },
          { url: 'https://grims-squad.com/forum', ms: 9000, ok: true },
        ],
        state,
        DEFAULTS,
      );
      state = result.state;
      seen.push(...result.events.map((e) => e.url));
    }

    expect(seen).toEqual(['https://grims-squad.com/forum']);
  });
});

describe('the alert reaches a person, not a channel nobody has open', () => {
  /*
   * ★ SQUADRON OWNER, 2026-08-06: "send these in DM" ★
   *
   * Which is the right call for this particular signal. A channel alert at 3am is read at 9am; the
   * whole point of this probe is that the site was slow for twenty minutes and the only monitoring
   * system was a person noticing. A DM reaches the phone that is already in the room.
   *
   * A channel is still supported, because the two are not alternatives — one person on call and a
   * record somewhere the rest of the squadron can see is a normal arrangement, and configuring
   * both should not mean choosing.
   */

  it('MANDATORY: nothing configured means no destinations, not a crash', () => {
    /*
     * The state the box is in right now. The probe must still measure and still write history —
     * the alerting is the part that is unconfigured, and losing the measurement with it would
     * throw away the baseline this is collecting for the upsize.
     */
    expect(destinations({})).toEqual([]);
  });

  /*
   * ★ THE FIXTURES ARE DELIBERATELY NOT SNOWFLAKE-SHAPED ★
   *
   * The first version used realistic 18-digit ids and gitleaks failed the build with five hits:
   * its `discord-client-id` rule matches any 17-20 digit number near the word "discord", and it
   * cannot tell a made-up one from a leaked one. That is the rule working correctly.
   *
   * The tempting fix is adding them to .gitleaks.toml's allowlist. That file's own reasoning
   * argues against it — every entry there is a real value that is provably not a secret, and
   * padding it with invented ones makes the list harder to audit for the entries that matter.
   *
   * `destinations()` does no format validation; it routes. So the fixtures say what they are.
   */
  it('MANDATORY: a user id becomes a DM destination', () => {
    expect(destinations({ DISCORD_OPS_USER_ID: 'ops-user-fixture' })).toEqual([
      { kind: 'dm', id: 'ops-user-fixture' },
    ]);
  });

  it('MANDATORY: a channel id still works, so this is additive', () => {
    expect(destinations({ DISCORD_OPS_CHANNEL_ID: 'ops-channel-fixture' })).toEqual([
      { kind: 'channel', id: 'ops-channel-fixture' },
    ]);
  });

  it('MANDATORY: configuring both sends to both, DM first', () => {
    /*
     * DM first because if Discord rate-limits or the second call fails, the one that got through
     * should be the one that wakes somebody up.
     */
    const both = destinations({
      DISCORD_OPS_CHANNEL_ID: 'ops-channel-fixture',
      DISCORD_OPS_USER_ID: 'ops-user-fixture',
    });

    expect(both.map((d) => d.kind)).toEqual(['dm', 'channel']);
  });

  it('MANDATORY: a placeholder is treated as unset, exactly as the deploy preflight does', () => {
    /*
     * deploy.sh rejects `CHANGE_ME` values as missing rather than present. If this disagreed, a
     * half-filled .env would give a probe that posts to a channel named CHANGE_ME, fails every
     * time, and logs a 404 nobody reads — configured-looking and silent, which is the worst of
     * both.
     */
    expect(
      destinations({ DISCORD_OPS_USER_ID: 'CHANGE_ME', DISCORD_OPS_CHANNEL_ID: '  ' }),
    ).toEqual([]);
  });

  it('surrounding whitespace does not become part of the id', () => {
    // `echo 'X=123' >> .env` is how these get set, and a stray space produces a 404 that reads
    // like a permissions problem.
    expect(destinations({ DISCORD_OPS_USER_ID: '  ops-user-fixture  ' })).toEqual([
      { kind: 'dm', id: 'ops-user-fixture' },
    ]);
  });
});

describe('the probe watches things that exist', () => {
  /*
   * ★ CAUGHT ON THE FIRST RUN ON THE REAL BOX, 2026-08-06 ★
   *
   * The default targets included http://127.0.0.1:5001/v1/health, and the very first invocation
   * announced "🔴 127.0.0.1:5001 is not responding". It never had been: the API publishes no host
   * ports at all — it is reachable only from the docker network, which is why deploy.sh's verify
   * step curls `http://api:5001` from INSIDE a container.
   *
   * An alert that fires forever about something that was never up is worse than no alert. It is
   * the thing that teaches everybody the channel is noise, and it would have started the moment
   * this went into cron.
   *
   * https://grims-squad.com/v1/health answers in 0.059s and is the path a member's request
   * actually travels — through Caddy, to the API — so it is both reachable and more truthful about
   * what is being measured.
   */
  const wrapper = readFileSync(join(HERE, '..', 'infra', 'scripts', 'probe-run.sh'), 'utf8');
  const compose = readFileSync(
    join(HERE, '..', 'infra', 'docker', 'compose.prod.yml'),
    'utf8',
  );

  it('MANDATORY: no default target is a host port nothing publishes', () => {
    /*
     * Comments stripped first. The fix for this bug explains itself by quoting the URL it removed,
     * and the first version of this test read that prose as a live target — failing on the very
     * change that fixed it. A source scan that cannot tell code from commentary will eventually
     * be silenced rather than believed.
     */
    const code = wrapper
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    const loopbackPorts = [...code.matchAll(/127\.0\.0\.1:(\d+)/g)].map((m) => m[1]);

    for (const port of loopbackPorts) {
      /*
       * Read from compose rather than listed here, so publishing a port later automatically makes
       * it a legitimate target instead of requiring this test to be remembered.
       */
      const published = new RegExp(`['"\\s]\\d*:?${port}:\\d+|:${port}:`).test(compose);
      expect(
        published,
        `probe-run.sh probes 127.0.0.1:${port}, which compose.prod.yml never publishes to the host — it will alert forever`,
      ).toBe(true);
    }
  });

  it('MANDATORY: the API is checked by the route a member would take', () => {
    expect(
      /PUBLIC_URL\}\/v1\/health/.test(wrapper),
      'the API health check no longer goes through the public URL, so it stops measuring what members experience',
    ).toBe(true);
  });
});

describe('the state survives the gap between runs', () => {
  it('MANDATORY: it round-trips through JSON without losing the count', () => {
    /*
     * Each tick is a SEPARATE process — cron starts it, it exits. Everything the next run needs to
     * know is whatever survived on disk, so a state shape that does not serialise cleanly means
     * the counters silently reset every minute and sustained slowness never reaches three.
     */
    let state = freshState();
    state = evaluate(tick(9000), state, DEFAULTS).state;
    state = evaluate(tick(9000), JSON.parse(JSON.stringify(state)), DEFAULTS).state;

    const result = evaluate(tick(9000), JSON.parse(JSON.stringify(state)), DEFAULTS);

    expect(result.events, 'the breach count did not survive being written to disk').toHaveLength(1);
  });

  it('a corrupt or absent state file starts clean rather than throwing', () => {
    /*
     * The probe runs unattended every minute. A crash on a truncated file — the box lost power
     * mid-write — would silently end the monitoring, and the way anybody would find out is the
     * next unnoticed outage.
     */
    expect(() => evaluate(tick(50), freshState(), DEFAULTS)).not.toThrow();
    expect(() => evaluate(tick(50), {} as never, DEFAULTS)).not.toThrow();
  });
});
