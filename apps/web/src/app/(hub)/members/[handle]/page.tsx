import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProfile, getMe } from '../../../../lib/api';
import { PageHeader, PageBody, Panel, RailStat } from '../../../../components/hub-page';
import { RoleChip } from '../../../../components/role-chip';
import { SessionTimer } from '../../../../components/session-timer';
import { LiveRefresh } from '../../../../components/live-refresh';
import { isPlayingNow, titleRoles } from '../../../../components/roster-card';
import { formatLocal } from '../../../../lib/time';

/**
 * One commander's record.
 *
 * ★ THE SAME FACTS AS THEIR ROSTER CARD, AND THEN THE REST ★
 *
 * The card answers "who is this, roughly" in a tile. This is where somebody
 * comes when the tile was not enough — so it carries every ladder, every role,
 * the hangar, the balance, the standing, and what they have actually done this
 * month. It is reached FROM a card, and a page that disagreed with the card that
 * linked to it is the kind of contradiction nobody reports and everybody
 * notices, so both are built from the same server code.
 *
 * ★ EVERY GATED BLOCK TESTS FOR THE KEY, NOT THE VALUE ★
 *
 * The API omits a field the member has not turned on (INV-027), so
 * `'credits' in p` distinguishes a field that was never sent from one that was
 * sent empty. They are different statements and they render differently.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const p = await getProfile(handle);
  if (p === null) return { title: "Commander not found — Grim's Squad" };
  return {
    title: `${p.cmdrName ?? p.displayName} — Grim's Squad`,
    // No bio in the description: a member's own words are theirs, and a search
    // engine snippet is a wider audience than a profile page.
    description: `Commander record on the Grim's Squad hub.`,
    robots: { index: false },
  };
}

/** `1234567` -> `1,234,567`. */
const n = (v: number): string => v.toLocaleString('en-GB');

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''))
    .toUpperCase();
}

/** The top of a ladder. Prefix-matched: Frontier extended Elite to Elite I–V. */
const isElite = (name: string): boolean => /^elite\b/i.test(name.trim());

/**
 * How long they have been in the squadron, in words.
 *
 * Months rather than a date, because "joined April 2006" makes a reader do
 * arithmetic to answer the question they actually have — is this a new
 * commander or one of the old guard.
 */
function tenure(joinedAt: string | null, now: number = Date.now()): string {
  /*
   * ★ NULL IS AN ANSWER, AND IT IS "WE DO NOT KNOW" ★
   *
   * Falling back to the website account date is what produced "in the squadron:
   * 1 day" for a founding member. A wrong number presented confidently is worse
   * than an absent one, so this says so instead.
   */
  if (joinedAt === null) return 'Not known';

  const ms = now - new Date(joinedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';

  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'Joined today';
  if (days < 31) return `${days} ${days === 1 ? 'day' : 'days'}`;

  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0
    ? `${years} ${years === 1 ? 'year' : 'years'}`
    : `${years}y ${rest}m`;
}

function localClock(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
    const hour = get('hour');
    const minute = get('minute');
    if (hour === '' || minute === '') return '';
    return `${hour}:${minute} ${get('dayPeriod').toUpperCase()}`;
  } catch {
    return '';
  }
}

function lastSeen(iso: string, timezone: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 0) return 'just now';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.floor(ms / 86_400_000);
  if (days < 7) return `${days} days ago`;

  return formatLocal(iso, timezone, { withTime: false });
}

/** A headline figure with its label beneath. */
function Stat({
  label,
  value,
  tone = 'default',
  note,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'dim';
  /*
   * `| undefined` explicitly, because `exactOptionalPropertyTypes` is on: a
   * caller passing a computed value that MIGHT be undefined is the normal case
   * here, and the alternative is a conditional spread at every call site.
   */
  note?: string | undefined;
}) {
  const colour =
    tone === 'good'
      ? 'text-[var(--color-semantic-success)]'
      : tone === 'dim'
        ? 'text-[var(--color-text-dim)]'
        : 'text-[var(--color-brand-cyan-bright)]';

  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-text-dim)]">
        {label}
      </p>
      <p className={`mt-1.5 truncate text-xl ${colour}`} style={{ fontFamily: 'var(--font-display)' }}>
        {value}
      </p>
      {note !== undefined && (
        <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">{note}</p>
      )}
    </div>
  );
}

/** A titled block on the main column. */
function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border-hairline)] pb-2">
        <h2
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)]"
        >
          {title}
        </h2>
        {hint !== undefined && (
          <span className="shrink-0 text-[11px] text-[var(--color-text-dim)]">{hint}</span>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Shown where a member has turned a field on but nothing has arrived yet. */
function NotYet({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[68ch] rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}

export default async function MemberPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const [p, me] = await Promise.all([getProfile(handle), getMe()]);
  if (p === null) notFound();

  const isSelf = me.user?.handle === p.handle;
  const viewerTz = me.user?.timezone ?? 'UTC';
  const playing = isPlayingNow(p.lastPlayingAt);

  const membership = p.discordRoles.filter((r) => r.category === 'membership');
  const rank = p.discordRoles.filter((r) => r.category === 'rank');
  const awards = p.discordRoles.filter((r) => r.category === 'award');

  const heading = p.cmdrName ?? p.displayName;
  const elite = p.commander.ranks.filter((r) => r.name !== null && isElite(r.name)).length;
  const reported = p.commander.ranks.filter((r) => r.name !== null).length;

  return (
    <>
      {/*
        Their standing changes while somebody is looking at it — a member
        launching the game, a rank sweep landing, a verification completing.
      */}
      <LiveRefresh types={['presence', 'roster', 'telemetry', 'verification']} />

      <PageHeader
        eyebrow="Commander record"
        title={heading.toUpperCase()}
        action={
          <a
            href="/roster"
            className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]"
          >
            Back to roster
          </a>
        }
      />

      <PageBody
        rail={
          <>
            <Panel title="At a glance">
              {/*
                ★ TWO DIFFERENT DATES, AND THEY ARE NOT INTERCHANGEABLE ★

                `guildJoinedAt` is when Discord says they joined the squadron.
                `joinedAt` is when they created an account on this website. The
                page used the second for both and told a long-standing member
                they had been in the squadron for one day.
              */}
              <RailStat label="In the squadron" value={tenure(p.guildJoinedAt)} />
              {p.guildJoinedAt !== null && (
                <RailStat
                  label="Joined Discord"
                  value={formatLocal(p.guildJoinedAt, viewerTz, { withTime: false })}
                />
              )}
              <RailStat
                label="On the hub"
                value={formatLocal(p.joinedAt, viewerTz, { withTime: false })}
              />
              <RailStat
                label="Inara"
                value={p.squadronVerified ? 'Verified' : 'Not verified'}
                tone={p.squadronVerified ? 'good' : 'default'}
              />
              <RailStat label="Ladders flown" value={`${reported} of 6`} />
              {elite > 0 && (
                <RailStat label="Elite ratings" value={String(elite)} tone="good" />
              )}
            </Panel>

            {/*
              ★ WHERE THEY ARE, IN THEIR OWN CLOCK ★

              The single most useful thing on a squadron page: whether it is a
              reasonable hour to ping somebody. The zone name alone does not
              answer it, so the time there is shown beside it.
            */}
            <Panel title="Their local time">
              <p
                className="text-3xl text-[var(--color-brand-cyan-bright)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {localClock(p.timezone)}
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {p.timezone.replace(/_/g, ' ')}
              </p>
            </Panel>

            {isSelf && (
              <Panel title="This is you">
                {/*
                  Said plainly, because a member looking at their own page cannot
                  otherwise tell WHICH fields others can see — the API shows them
                  everything when they are the caller.
                */}
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  You are seeing your own record, which includes fields others may not.
                </p>
                <a
                  href="/settings/commander"
                  className="mt-3 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Your settings
                </a>
              </Panel>
            )}
          </>
        }
      >
        {/* ── identity ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-5 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
          <span className="relative shrink-0">
            {p.avatarUrl !== null ? (
              <img
                src={p.avatarUrl}
                alt=""
                width={88}
                height={88}
                className="size-22 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-22 items-center justify-center rounded-full bg-[var(--color-brand-orange)] text-2xl font-semibold text-[var(--color-text-on-accent)]"
              >
                {initials(p.displayName)}
              </span>
            )}
            {playing && (
              <span
                aria-hidden="true"
                className="absolute bottom-1 right-1 size-4 rounded-full bg-[var(--color-semantic-success)] ring-2 ring-[var(--color-surface-panel)]"
              />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p
              className="text-3xl leading-tight text-[var(--color-brand-orange)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {heading}
            </p>

            <p className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em]">
              {p.cmdrName !== null && (
                <span className="shrink-0 text-[var(--color-brand-cyan-bright)]">Commander</span>
              )}
              {/*
                The SAME rule as the roster card, from the same function: a
                founding title replaces the site ones. A profile that said
                "Webmaster" while the card that linked to it said "Founder" is
                the kind of contradiction nobody reports and everybody notices.
              */}
              {titleRoles(p).map((r, i) => (
                <span key={r.name} className="flex min-w-0 items-center gap-2">
                  {(p.cmdrName !== null || i > 0) && (
                    <span aria-hidden="true" className="shrink-0 text-[var(--color-border-active)]">
                      |
                    </span>
                  )}
                  <span className="truncate text-[var(--color-brand-orange)]">{r.name}</span>
                </span>
              ))}
            </p>

            {/*
              Status reads as a sentence, not a dot. "Playing now" beside a
              live counter answers both halves of what a reader wants: whether
              to bother, and whether they have just started or are six hours in.
            */}
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {playing ? (
                <>
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full bg-[var(--color-semantic-success)]"
                  />
                  <span className="text-[var(--color-semantic-success)]">Playing now</span>
                  {p.commander.lastPlayedAt !== null && (
                    <SessionTimer startedAt={p.commander.lastPlayedAt} />
                  )}
                </>
              ) : p.commander.lastPlayedAt !== null ? (
                <span className="text-[var(--color-text-secondary)]">
                  Last flew {lastSeen(p.commander.lastPlayedAt, viewerTz)}
                </span>
              ) : (
                <span className="text-[var(--color-text-dim)]">No flights recorded yet</span>
              )}
            </p>

            {p.bio !== null && p.bio !== '' && (
              <p className="mt-4 max-w-[62ch] text-[var(--color-text-primary)]">{p.bio}</p>
            )}
          </div>
        </div>

        {/* ── headline figures ────────────────────────────────────────────── */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Squadron rank"
            value={rank[0]?.name ?? membership[0]?.name ?? 'Unranked'}
            note={p.isOfficer ? 'Holds a leadership appointment' : undefined}
          />
          <Stat
            label="In the squadron"
            value={tenure(p.guildJoinedAt)}
            note={p.guildJoinedAt === null ? 'no Discord join date on file' : 'since joining Discord'}
          />
          <Stat
            label="Currently flying"
            value={p.commander.currentShip ?? 'Not reported'}
            tone={p.commander.currentShip === null ? 'dim' : 'default'}
          />
          <Stat
            label="Inara"
            value={p.squadronVerified ? 'Verified' : 'Not verified'}
            tone={p.squadronVerified ? 'good' : 'dim'}
            note={p.squadronVerified ? 'Name and squadron confirmed' : 'Awaiting confirmation'}
          />
        </div>

        {/* ── pilot ranks ─────────────────────────────────────────────────── */}
        <Block
          title="Pilot ranks"
          hint={
            p.commander.rankSource === 'inara'
              ? 'via Inara'
              : p.commander.rankSource === 'journal'
                ? 'from their journal'
                : 'not reported'
          }
        >
          {/*
            All six, always, in a fixed order — the same rule as the card. A
            ladder with no reading says so, and stays clearly distinct from
            "Harmless", which is a rank a new pilot really holds.
          */}
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {p.commander.ranks.map((r) => (
              <li
                key={r.key}
                className={`rounded-lg border px-4 py-3 ${
                  r.name !== null && isElite(r.name)
                    ? 'border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_8%,transparent)]'
                    : 'border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]'
                }`}
              >
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-text-dim)]">
                  {r.label}
                </p>
                <p
                  className={`mt-1 truncate text-lg ${
                    r.name === null
                      ? 'text-[var(--color-text-dim)]'
                      : isElite(r.name)
                        ? 'text-[var(--color-brand-cyan-bright)]'
                        : 'text-[var(--color-text-primary)]'
                  }`}
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {r.name ?? 'None'}
                </p>
              </li>
            ))}
          </ul>
        </Block>

        {/* ── squadron standing ───────────────────────────────────────────── */}
        <Block title="Squadron standing">
          {p.discordRoles.length === 0 ? (
            <NotYet>No squadron roles yet.</NotYet>
          ) : (
            <dl className="grid grid-cols-[6rem_1fr] items-start gap-x-4 gap-y-3 text-sm">
              {membership.length > 0 && (
                <>
                  <dt className="pt-0.5 text-[var(--color-text-secondary)]">Member</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {membership.map((r) => (
                      <RoleChip key={r.name} name={r.name} colour={r.colour} />
                    ))}
                  </dd>
                </>
              )}
              {rank.length > 0 && (
                <>
                  <dt className="pt-0.5 text-[var(--color-text-secondary)]">Rank</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {rank.map((r) => (
                      <RoleChip key={r.name} name={r.name} colour={r.colour} />
                    ))}
                  </dd>
                </>
              )}
              {awards.length > 0 && (
                <>
                  <dt className="pt-0.5 text-[var(--color-text-secondary)]">Awards</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {awards.map((r) => (
                      <RoleChip key={r.name} name={r.name} colour={r.colour} />
                    ))}
                  </dd>
                </>
              )}
            </dl>
          )}
        </Block>

        {/* ── this month ──────────────────────────────────────────────────── */}
        {'activity' in p && (
          <Block
            title="This month"
            hint={new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          >
            {p.activity == null ? (
              <NotYet>Nothing recorded this month yet.</NotYet>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {/*
                    ★ WHICH OF THESE COUNTS, STATED ON EACH ★

                    rank-progression.yaml: only a MESSAGE satisfies the Discord
                    half. Forum posts and voice joins do NOT — squadron owner,
                    2026-07-29 — though both are still recorded, because they
                    are a real part of how somebody takes part.

                    Those two say so explicitly rather than just omitting the
                    note: sitting silent beside a tile that says "counts toward
                    promotion", a reader would reasonably assume they counted.
                  */}
                  <Stat
                    label="Messages"
                    value={n(p.activity.messages)}
                    tone={p.activity.messages > 0 ? 'good' : 'dim'}
                    note="counts toward promotion"
                  />
                  {/*
                    JOINS, and labelled as joins. Discord reports somebody
                    ENTERING a channel and never how long they stayed, so there
                    is no honest way to say "hours in voice" — an earlier version
                    of this page divided a field called voiceMinutes by sixty and
                    would have published invented hours the moment anybody wired
                    it up.
                  */}
                  <Stat
                    label="Voice joins"
                    value={n(p.activity.voiceJoins)}
                    tone="default"
                    note="recorded, does not count"
                  />
                  <Stat
                    label="Forum posts"
                    value={n(p.activity.forumPosts)}
                    tone="default"
                    note="recorded, does not count"
                  />
                  <Stat
                    label="Flew this month"
                    value={p.activity.gameObserved ? 'Yes' : 'Not yet'}
                    tone={p.activity.gameObserved ? 'good' : 'dim'}
                    note="required for promotion"
                  />
                </div>

                {/*
                  ★ THE ACTUAL RULE, ONCE, IN A SENTENCE ★

                  Four tiles each saying "counts toward promotion" tells a reader
                  that things count and not how. The rule has two halves and they
                  behave differently: the Discord half is satisfied by ANY of the
                  three, the game half is its own requirement — so somebody with
                  four hundred messages and no session has not qualified, which
                  is exactly the case worth being clear about.
                */}
                <p className="mt-4 max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  A month counts toward promotion when there is{' '}
                  <strong className="text-[var(--color-text-primary)]">
                    at least one message
                  </strong>{' '}
                  and{' '}
                  <strong className="text-[var(--color-text-primary)]">
                    at least one Elite session
                  </strong>
                  , with the rank held for the whole month. Forum posts and voice
                  joins are recorded but do not count toward it.
                </p>
              </>
            )}
          </Block>
        )}

        {/* ── commander data, each governed by its own toggle ─────────────── */}
        {'location' in p && (
          <Block title="Last known position">
            {p.location == null ? (
              <NotYet>No position reported yet.</NotYet>
            ) : (
              <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-5 py-4">
                <p
                  className="text-2xl text-[var(--color-brand-cyan-bright)]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {p.location.system}
                </p>
                {p.location.station !== null && (
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    {p.location.station}
                  </p>
                )}
              </div>
            )}
          </Block>
        )}

        {'fleet' in p && (
          <Block title="Fleet" hint={p.fleet == null ? undefined : `${p.fleet.length} ships`}>
            {p.fleet == null || p.fleet.length === 0 ? (
              <NotYet>No hangar reported yet.</NotYet>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {p.fleet.map((s, i) => (
                  <li
                    key={`${s.shipType}-${s.name ?? i}`}
                    className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3"
                  >
                    <p className="truncate text-[var(--color-text-primary)]">{s.shipType}</p>
                    {s.name !== null && (
                      <p className="mt-0.5 truncate text-xs italic text-[var(--color-text-secondary)]">
                        {s.name}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {'credits' in p && (
          <Block title="Balance">
            {p.credits == null ? (
              <NotYet>No balance reported yet.</NotYet>
            ) : (
              <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-5 py-4">
                <p
                  className="text-3xl text-[var(--color-brand-orange)]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {/*
                    Formatted from the STRING via BigInt. Passing it through
                    Number first would round a balance over 2^53 — and the
                    members that hits are precisely the ones who would notice.
                  */}
                  {BigInt(p.credits).toLocaleString('en-GB')} CR
                </p>
              </div>
            )}
          </Block>
        )}
      </PageBody>
    </>
  );
}
