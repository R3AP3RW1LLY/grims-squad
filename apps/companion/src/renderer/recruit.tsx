import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RecruitStatus, RecruitMilestone } from '../hub-recruit.js';
import { Button, C, Card, Empty, Problem, R, Section } from './ui.js';

/**
 * The member's own recruiting.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "a unique discord invite link for all members that are inara veriefied in our platform! we want
 * this to be a leaderboard item and gamified too please ... build me a cool recruit tracking system"
 *
 * ★ THE LINK IS THE PAGE ★
 *
 * Everything else here is encouragement. A member opens this to get their link and paste it into a
 * conversation already in progress, so the link is the first thing, it is one click to copy, and
 * nothing sits above it.
 *
 * ★ THE LADDER IS SHOWN EVEN WITH NOBODY ON IT ★
 *
 * A recruiting page with no recruits is the state every member starts in. Showing what the
 * milestones pay turns an empty page from a report of having done nothing into a reason to start —
 * and the figures come from the hub rather than being written here, so they cannot drift from what
 * actually scores.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly recruit: {
      status(): Promise<Answer<RecruitStatus>>;
      mint(): Promise<Answer<{ link: string }>>;
    };
  }
}

/** What each rung means, in the words a member would use about themselves. */
const MILESTONE_TEXT: Record<RecruitMilestone, string> = {
  joined: 'Joined the Discord',
  stayed: 'Stayed a week',
  verified: 'Verified on Inara',
  flying: 'Flying with telemetry',
  cadet: 'Made Cadet',
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function RecruitPage(): JSX.Element {
  const [status, setStatus] = useState<RecruitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = (): void => {
    void window.recruit.status().then((a) => {
      if (a.ok) {
        setStatus(a.data);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  useEffect(load, []);

  const mint = (): void => {
    setBusy(true);
    void window.recruit.mint().then((a) => {
      setBusy(false);
      if (a.ok) load();
      else setError(a.error);
    });
  };

  const copy = (link: string): void => {
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      // Reverts, so the confirmation belongs to the click that earned it rather than sitting there
      // claiming a copy the member made five minutes ago.
      setTimeout(() => setCopied(false), 2500);
    });
  };

  if (error !== null) return <Problem>{error}</Problem>;
  if (status === null) return <Empty>Reading your recruiting…</Empty>;

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <Section title="Your invite link">
        <Card>
          {status.link !== null ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              <code
                style={{
                  background: C.sunken,
                  border: `1px solid ${C.subtle}`,
                  borderRadius: R.control,
                  color: C.text,
                  fontSize: '13px',
                  padding: '8px 10px',
                  overflowWrap: 'anywhere',
                }}
              >
                {status.link}
              </code>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Button onClick={() => copy(status.link as string)}>Copy link</Button>
                {copied ? <span style={{ color: C.good, fontSize: '12px' }}>Copied</span> : null}
                <span style={{ color: C.dim, fontSize: '12px', marginLeft: 'auto' }}>
                  Anyone joining through this is credited to you.
                </span>
              </div>
            </div>
          ) : status.canMint ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              <p style={{ margin: 0, color: C.dim, fontSize: '13px' }}>
                Your link is made once and stays yours. Everyone who joins through it is credited to
                you, for as long as they stay.
              </p>
              <div>
                <Button onClick={mint} disabled={busy}>
                  {busy ? 'Making it…' : 'Make my link'}
                </Button>
              </div>
            </div>
          ) : (
            /*
             * The hub's own sentence, not one written here. It knows which of the three conditions
             * failed — permission, Inara, rank — and a second copy of that reasoning in the app
             * would be one that drifts and eventually tells somebody the wrong thing to go and fix.
             */
            <p style={{ margin: 0, color: C.dim, fontSize: '13px' }}>
              {status.blockedBecause ?? 'Recruiting is not open on your account yet.'}
            </p>
          )}
        </Card>
      </Section>

      <Section
        title="Who you have brought in"
        aside={
          status.totalPoints > 0 ? (
            <span style={{ color: C.good, fontVariantNumeric: 'tabular-nums' }}>
              {status.totalPoints.toLocaleString()} points
            </span>
          ) : undefined
        }
      >
        {status.recruits.length === 0 ? (
          <Empty>Nobody yet. The link above is how that starts.</Empty>
        ) : (
          <div style={{ display: 'grid', gap: '8px' }}>
            {status.recruits.map((r) => (
              <Card key={`${r.name}:${r.joinedAt}`}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ color: C.text, fontSize: '14px' }}>{r.name}</strong>
                  <span style={{ color: C.good, fontVariantNumeric: 'tabular-nums' }}>
                    {r.points.toLocaleString()} pts
                  </span>
                </div>
                <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {/*
                    Every rung is drawn, reached or not. A recruit who joined and stopped is the
                    case a recruiter can still do something about, and showing only what they have
                    already earned hides exactly that.
                  */}
                  {status.ladder.map(({ milestone }) => {
                    const got = r.milestones.includes(milestone);
                    return (
                      <span
                        key={milestone}
                        style={{
                          border: `1px solid ${got ? C.orange : C.subtle}`,
                          background: got ? C.orangeTint : 'transparent',
                          borderRadius: R.control,
                          color: got ? C.orangeBright : C.faint,
                          fontSize: '11px',
                          padding: '2px 7px',
                        }}
                      >
                        {MILESTONE_TEXT[milestone]}
                      </span>
                    );
                  })}
                </div>
                <p style={{ margin: '6px 0 0', color: C.dim, fontSize: '12px' }}>
                  Joined {when(r.joinedAt)}
                </p>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="What each step pays">
        <Card>
          <div style={{ display: 'grid', gap: '4px', fontSize: '13px' }}>
            {status.ladder.map(({ milestone, points }) => (
              <div
                key={milestone}
                style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}
              >
                <span style={{ color: C.dim }}>{MILESTONE_TEXT[milestone]}</span>
                <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                  {points === 0 ? '—' : `+${points.toLocaleString()}`}
                </span>
              </div>
            ))}
          </div>
          {/*
            Said plainly, because it is the rule that makes the board worth anything: a recruiter is
            paid for people who stay, not for invitations sent.
          */}
          <p style={{ margin: '8px 0 0', color: C.dim, fontSize: '12px' }}>
            Joining pays nothing on its own. The points come as your recruit sticks around and gets
            stuck in.
          </p>
        </Card>
      </Section>
    </div>
  );
}
