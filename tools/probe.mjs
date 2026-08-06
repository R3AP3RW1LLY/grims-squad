#!/usr/bin/env node
/**
 * Response-time probe: notices the site is slow before a member has to say so.
 *
 * ★ WHY THIS EXISTS — SQUADRON OWNER, 2026-08-05 ★
 *
 * The site served pages at 19.95 seconds during a deploy, and the way anybody found out was the
 * squadron owner reporting it. Before that, fifteen seconds, same discovery route. Two fixes were
 * shipped for it and declared done on a single fast page load, because a single fast page load was
 * the entire body of evidence available to anyone.
 *
 * Members are not a monitoring system. Asking them to be one is how a regression survives three
 * attempts at a fix, and it is why the third attempt — building images in CI — arrives with this.
 *
 * ★ IT RUNS FROM CRON, ONE PROCESS PER MINUTE ★
 *
 * Nothing is remembered in memory between ticks; everything the next run needs is on disk. That is
 * a constraint the decision logic below is written around, and `evaluate` is pure so the sequences
 * that matter — a spike that resolves, a spike that does not, a flap — can be tested in
 * milliseconds instead of reproduced against a real server over an hour.
 *
 * ★ IT DELIBERATELY DOES NOT USE THE API OR THE DATABASE ★
 *
 * A probe that reports through the thing it is watching goes silent exactly when it matters. It
 * speaks to Discord directly and writes its history to a flat file, so it still works when the API
 * is down, the database is refusing connections, or the box is too loaded to serve a page.
 */

import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ★ THE NUMBERS, AND WHERE THEY CAME FROM ★
 *
 * Not invented. Measured on this box on 2026-08-05:
 *   healthy, no deploy running     0.24s – 0.38s
 *   deploy, parallelism limited    1.2s – 1.8s
 *   deploy, six images at once     15.0s (`/`), 14.9s (`/forum`)
 *   deploy, Next.js image building 19.95s
 *
 * `slowMs` at 3s sits well above anything healthy and well below anything anybody complained
 * about, so it catches the bad case without firing on the merely busy one.
 *
 * `clearMs` at 1.2s is deliberately far below it. Alerting and clearing at the same number makes a
 * site sitting near the line flap forever; the gap between the two IS the hysteresis.
 *
 * Three breaches is about three minutes of sustained slowness — long enough to rule out a garbage
 * collection or a backup starting, short enough to still be news.
 */
export const DEFAULTS = {
  slowMs: 3_000,
  clearMs: 1_200,
  breachesToAlert: 3,
  clearsToRecover: 2,
};

/** The state a first-ever run starts from, and the shape everything below expects. */
export function freshState() {
  return { breaches: {}, clears: {}, alerting: {} };
}

/**
 * Decide what — if anything — is worth telling a human about.
 *
 * Pure, and takes its state rather than reading it, so a sequence of ticks is a loop in a test
 * rather than an afternoon of waiting.
 *
 * @param {Array<{url: string, ms: number, ok: boolean}>} samples this tick's measurements
 * @param {ReturnType<typeof freshState>} state what the previous run left behind
 * @param {typeof DEFAULTS} thresholds
 */
export function evaluate(samples, state, thresholds = DEFAULTS) {
  /*
   * Rebuilt rather than mutated, and defensively: this arrives from a JSON file that a power cut
   * could have truncated. A probe that throws on a corrupt state file stops monitoring silently,
   * and the way anybody finds out is the next unnoticed outage.
   */
  const next = {
    breaches: { ...(state?.breaches ?? {}) },
    clears: { ...(state?.clears ?? {}) },
    alerting: { ...(state?.alerting ?? {}) },
  };
  const events = [];

  for (const { url, ms, ok } of samples) {
    /*
     * ★ DOWN IS NOT SLOW, AND DOES NOT WAIT FOR CORROBORATION ★
     *
     * "Slow" has innocent explanations worth three minutes to rule out. "Refused the connection"
     * has none, so a failed request counts as the whole quota at once and alerts on the first tick.
     */
    const breached = !ok || ms >= thresholds.slowMs;
    const cleared = ok && ms <= thresholds.clearMs;

    if (breached) {
      next.breaches[url] = !ok ? thresholds.breachesToAlert : (next.breaches[url] ?? 0) + 1;
      next.clears[url] = 0;
    } else if (cleared) {
      next.clears[url] = (next.clears[url] ?? 0) + 1;
      next.breaches[url] = 0;
    } else {
      /*
       * The middle ground — slower than clearMs, faster than slowMs. It resets NEITHER counter.
       *
       * A saturated box is not uniformly slow; it is slow on average and occasionally fine. Letting
       * an in-between sample count as a clear is what turns one incident into an alert every other
       * minute, which is how a channel gets muted and monitoring quietly ends.
       */
    }

    if (!next.alerting[url] && (next.breaches[url] ?? 0) >= thresholds.breachesToAlert) {
      next.alerting[url] = true;
      next.clears[url] = 0;
      events.push({ kind: ok ? 'slow' : 'down', url, ms, ok });
    } else if (next.alerting[url] && (next.clears[url] ?? 0) >= thresholds.clearsToRecover) {
      next.alerting[url] = false;
      next.breaches[url] = 0;
      events.push({ kind: 'recovered', url, ms, ok });
    }
  }

  return { state: next, events };
}

/**
 * What a human should see in Discord.
 *
 * Written for somebody reading a phone at midnight: what is wrong, how wrong, and where. No
 * embeds, no colour coding, nothing that needs a legend.
 */
export function alertContent(event) {
  const where = event.url.replace(/^https?:\/\//, '');

  if (event.kind === 'down') return `🔴 **${where}** is not responding.`;
  if (event.kind === 'recovered')
    return `🟢 **${where}** is back to normal — ${(event.ms / 1000).toFixed(2)}s.`;
  return `🟠 **${where}** has been slow for several minutes — ${(event.ms / 1000).toFixed(1)}s to respond.`;
}

/**
 * Where an alert should go, read from the environment.
 *
 * ★ SQUADRON OWNER, 2026-08-06: "send these in DM" ★
 *
 * The right call for this signal. A channel alert at 3am is read at 9am, and the entire reason this
 * probe exists is that the site was slow for twenty minutes and the only monitoring system was a
 * person noticing. A DM reaches the phone that is already in the room.
 *
 * A channel stays supported because the two are not alternatives — one person on call plus a record
 * the rest of the squadron can see is a normal arrangement, and configuring both should not mean
 * choosing between them.
 *
 * @param {Record<string, string | undefined>} env
 */
export function destinations(env) {
  /*
   * `CHANGE_ME` counts as unset, matching deploy.sh's preflight exactly. If these disagreed, a
   * half-filled .env would produce a probe that posts to a channel called CHANGE_ME, fails every
   * time, and logs a 404 nobody reads — configured-looking and silent, which is worse than either.
   */
  const value = (key) => {
    const raw = (env[key] ?? '').trim();
    return raw && !raw.includes('CHANGE_ME') ? raw : null;
  };

  const out = [];
  // DM first: if Discord rate-limits or the second call fails, the one that got through should be
  // the one that wakes somebody up.
  const user = value('DISCORD_OPS_USER_ID');
  if (user) out.push({ kind: 'dm', id: user });
  const channel = value('DISCORD_OPS_CHANNEL_ID');
  if (channel) out.push({ kind: 'channel', id: channel });
  return out;
}

/* ────────────────────────────────────────────────────────── the shell around it */

/** One timed request. Never throws: a probe that dies on a network error stops being a probe. */
async function measure(url, timeoutMs = 30_000) {
  const started = process.hrtime.bigint();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: abort.signal, redirect: 'follow' });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    /*
     * A 500 is "up but broken", which is a different problem with different owners. This watches
     * whether the site ANSWERS and how fast; the shape of the answer belongs to the error tracking.
     * A 5xx still counts as reachable, so it does not page anybody at 3am for a bad query.
     */
    return { url, ms, ok: response.status < 500 };
  } catch {
    return { url, ms: Number(process.hrtime.bigint() - started) / 1e6, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A bot cannot post to a person; it posts to a channel, and a DM is a channel you have to ask for.
 *
 * `POST /users/@me/channels` is idempotent — Discord returns the existing DM channel if there is
 * one — so this is safe to call per alert rather than caching an id that could go stale. Alerts are
 * rare by construction, so the extra round trip costs nothing worth engineering around.
 */
async function openDm(token, userId) {
  const response = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!response.ok) {
    /*
     * The two ways this fails, both worth naming because neither is a bug in this code:
     *   403 — the recipient does not share a guild with the bot, or has "allow direct messages
     *         from server members" switched off. Nothing here can fix that.
     *   404 — the id is not a user. Almost always a channel id pasted into the user variable.
     */
    console.error(
      `probe: could not open a DM (${response.status}) — check DISCORD_OPS_USER_ID is a USER id and that you allow DMs from server members`,
    );
    return null;
  }

  const dm = await response.json();
  return dm?.id ?? null;
}

async function post(token, channelId, content) {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  /*
   * INV-012: the body of a failed Discord response can echo the request. The status is enough to
   * diagnose with and cannot contain the token.
   */
  if (!response.ok) console.error(`probe: discord refused the alert (${response.status})`);
  return response.ok;
}

/** Deliver one alert to every configured destination. Returns how many actually landed. */
async function announce(content, token, targets) {
  if (!token || targets.length === 0) return 0;

  let delivered = 0;
  for (const target of targets) {
    /*
     * Sequential, not Promise.all. Two destinations is the realistic maximum and Discord rate-limits
     * per route; racing them to save forty milliseconds on an event that happens twice a month is
     * not a trade worth making.
     */
    const channelId = target.kind === 'dm' ? await openDm(token, target.id) : target.id;
    if (channelId && (await post(token, channelId, content))) delivered += 1;
  }
  return delivered;
}

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Absent on the first run, truncated if the box lost power mid-write. Both start clean.
    return freshState();
  }
}

async function main() {
  const statePath = process.env.PROBE_STATE ?? '/var/lib/grims/probe.state.json';
  const historyPath = process.env.PROBE_HISTORY ?? '/var/log/grims-probe.ndjson';
  const targets = (
    process.env.PROBE_URLS ??
    'https://grims-squad.com/,https://grims-squad.com/forum,http://127.0.0.1:5001/v1/health'
  )
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const samples = await Promise.all(targets.map((url) => measure(url)));

  /*
   * ★ THE HISTORY IS WRITTEN WHATEVER HAPPENS, AND THAT IS HALF THE POINT ★
   *
   * The squadron owner asked for both measuring and alerting. Alerts answer "is it bad right now";
   * this answers "was last Tuesday's deploy slower than the one before it", which is the question
   * that was unanswerable every previous time — every claim about response times in this repo's
   * history came from one person reloading one page.
   */
  const at = new Date().toISOString();
  try {
    mkdirSync(dirname(historyPath), { recursive: true });
    appendFileSync(
      historyPath,
      samples.map((s) => JSON.stringify({ at, ...s, ms: Math.round(s.ms) })).join('\n') + '\n',
    );
  } catch (error) {
    console.error(`probe: could not write history — ${error.message}`);
  }

  const { state, events } = evaluate(samples, readState(statePath), DEFAULTS);

  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state));
  } catch (error) {
    /*
     * Fatal-ish: without persisted state every run starts from zero, breaches never reach three,
     * and the probe runs forever announcing nothing while looking perfectly healthy. Loud, so the
     * cron log says why rather than staying mysteriously quiet.
     */
    console.error(`probe: COULD NOT PERSIST STATE — alerts will never fire — ${error.message}`);
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  // `alertTargets`, not `targets` — that name is already the list of URLs being probed, and the
  // two are very easy to confuse when reading this function quickly.
  const alertTargets = destinations(process.env);

  for (const event of events) {
    const content = alertContent(event);
    // Always to the log first. If Discord is the thing that is down, this is the only record.
    console.log(content);

    if (alertTargets.length === 0) {
      console.error(
        'probe: no DISCORD_OPS_USER_ID or DISCORD_OPS_CHANNEL_ID — measured, but told nobody',
      );
      continue;
    }
    await announce(content, token, alertTargets);
  }
}

// Only when run, not when imported by the spec.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main();
}
