import type { RecruitManage } from '../../../lib/api';

/**
 * The recruiting manager.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "the ops/and bgs need admin pages in the administration category on the website please to manage
 * them etc, same with the recruiting manager"
 *
 * ★ THE UNATTRIBUTED QUEUE COMES FIRST, AND THAT IS THE WHOLE LAYOUT ★
 *
 * Attribution deliberately refuses to guess: two people joining at once, a link minted between
 * refreshes, somebody arriving through an invite a member made by hand. Refusing to guess is only
 * affordable because there is somewhere to fix it — so the rows needing a decision sit at the top,
 * and the ones that resolved themselves are below, where they can be scrolled past.
 */

const ATTRIBUTION_TEXT: Record<string, { label: string; tone: string }> = {
  auto: { label: 'Traced automatically', tone: 'text-[var(--color-semantic-success)]' },
  manual: { label: 'Assigned by an officer', tone: 'text-[var(--color-brand-cyan-bright)]' },
  /*
   * `foreign` is the one worth explaining. They came in through a real invite that simply is not
   * one of ours — a member made it by hand long before this feature existed. That is information,
   * not a fault, and labelling it "unknown" would throw it away.
   */
  foreign: { label: 'Came through an invite we do not track', tone: 'text-[var(--color-text-secondary)]' },
  ambiguous: { label: 'Two joined at once — needs a decision', tone: 'text-[var(--color-semantic-warning)]' },
  unknown: { label: 'Could not tell', tone: 'text-[var(--color-semantic-warning)]' },
};

const TH =
  'py-3 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function RecruitingConsole({ data }: { data: RecruitManage }) {
  const needsDecision = data.joins.filter((j) => j.recruiter === null && j.voidedAt === null);
  const settled = data.joins.filter((j) => j.recruiter !== null || j.voidedAt !== null);

  return (
    <div className="grid gap-8">
      <section>
        <h2 className="m-0 mb-1 font-[family-name:var(--font-display)] text-lg">
          Nobody credited
          {needsDecision.length > 0 ? (
            <span className="ml-3 font-mono text-sm text-[var(--color-semantic-warning)]">
              {needsDecision.length}
            </span>
          ) : null}
        </h2>
        <p className="m-0 mb-3 max-w-[68ch] text-sm text-[var(--color-text-secondary)]">
          These arrived without us being able to say whose link they used — usually two people
          joining in the same moment, or an invite made by hand before this existed. Nothing is
          guessed: a wrong credit puts points beside somebody&rsquo;s name publicly while the member
          who actually recruited watches it happen.
        </p>

        {needsDecision.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">
            Nothing waiting. Every join so far traced back to somebody.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr>
                  <th className={TH}>Who</th>
                  <th className={TH}>Joined</th>
                  <th className={TH}>Why not</th>
                </tr>
              </thead>
              <tbody>
                {needsDecision.map((j) => (
                  <tr key={j.discordId}>
                    <td className={TD}>{j.name}</td>
                    <td className={`${TD} text-[var(--color-text-secondary)]`}>
                      {when(j.joinedAt)}
                    </td>
                    <td className={TD}>
                      <span className={ATTRIBUTION_TEXT[j.attribution]?.tone ?? ''}>
                        {ATTRIBUTION_TEXT[j.attribution]?.label ?? j.attribution}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="m-0 mb-3 font-[family-name:var(--font-display)] text-lg">Links</h2>
        {data.links.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">
            No member has minted a link yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr>
                  <th className={TH}>Member</th>
                  <th className={TH}>Code</th>
                  <th className={`${TH} text-right`}>Recruits</th>
                  <th className={TH}>State</th>
                </tr>
              </thead>
              <tbody>
                {data.links.map((l) => (
                  <tr key={l.code}>
                    <td className={TD}>{l.owner}</td>
                    <td className={`${TD} font-mono text-[var(--color-brand-cyan-bright)]`}>
                      {l.code}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>{l.recruits}</td>
                    <td className={TD}>
                      {l.revokedAt === null ? (
                        <span className="text-[var(--color-semantic-success)]">active</span>
                      ) : (
                        <span className="text-[var(--color-semantic-hostile-bright)]">revoked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="m-0 mb-3 font-[family-name:var(--font-display)] text-lg">Everyone else</h2>
        {settled.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">Nothing yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr>
                  <th className={TH}>Who</th>
                  <th className={TH}>Credited to</th>
                  <th className={TH}>How</th>
                  <th className={TH}>Joined</th>
                  <th className={`${TH} text-right`}>Earned</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((j) => (
                  <tr key={j.discordId} className={j.voidedAt === null ? '' : 'opacity-50'}>
                    <td className={TD}>{j.name}</td>
                    <td className={TD}>{j.recruiter ?? '—'}</td>
                    <td className={TD}>
                      <span className={ATTRIBUTION_TEXT[j.attribution]?.tone ?? ''}>
                        {ATTRIBUTION_TEXT[j.attribution]?.label ?? j.attribution}
                      </span>
                      {j.voidedAt === null ? null : (
                        <span className="ml-2 text-[var(--color-semantic-hostile-bright)]">
                          voided
                        </span>
                      )}
                    </td>
                    <td className={`${TD} text-[var(--color-text-secondary)]`}>
                      {when(j.joinedAt)}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>
                      {/*
                        Voided claims keep what they already earned — stopping the accrual is what
                        voiding means, and reversing a public board's history is a separate,
                        deliberate act rather than a side effect of this screen.
                      */}
                      {j.points > 0 ? j.points.toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
