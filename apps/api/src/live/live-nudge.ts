import type { LiveNudge } from '@grims/db';
import type { LiveService } from './live.service.js';

/**
 * The nudge every API-side notification producer hands to `notifyMembers` / `notifySquadron`.
 *
 * ★ ONE TRANSLATION, NOT ONE PER PRODUCER ★
 *
 * The notify module in @grims/db is process-neutral and asks its caller how live badges are
 * reached. In this process the answer is always the same — the @Global LIVE_SERVICE — and a
 * dozen producers each restating the mapping from "these members" to `{type:'notification'}`
 * events would be exactly the drift the module's callback design exists to avoid.
 *
 * Takes `null | undefined` because the service is injected @Optional everywhere it is consumed:
 * a unit test constructs a producer with three collaborators, not four, and a missing live
 * service must cost a badge refresh and nothing else. `publish` already swallows dead sockets,
 * and this never throws — the rows are written by the time a nudge runs, and a bell must never
 * un-succeed the deed it decorates.
 */
export function liveNudgeOf(live: Pick<LiveService, 'publish'> | null | undefined): LiveNudge {
  return (userIds) => {
    if (live == null) return;
    try {
      if (userIds === 'everyone') {
        // One squadron-wide event, not one per member: every connected browser re-reads once.
        live.publish({ type: 'notification', userId: null });
        return;
      }
      for (const userId of userIds) live.publish({ type: 'notification', userId });
    } catch {
      // See the header: the rows already landed, and the page still tells the truth on the
      // next navigation. Nothing here is worth failing the action that caused it.
    }
  };
}
