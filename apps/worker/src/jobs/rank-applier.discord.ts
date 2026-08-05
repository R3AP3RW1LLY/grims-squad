/**
 * The Discord half of a promotion, which now lives in `@grims/db`.
 *
 * ★ MOVED 2026-08-02 ★
 *
 * The website promotes people now — a button per month and one per member — and the ORDER this
 * class enforces is load-bearing: Discord first, our row second. Ladder ranks are mapped to Discord
 * roles so reconciliation can learn them, so a promotion written only to our database is undone by
 * the next reconciliation, in Discord's favour, handing the member their old rank back.
 *
 * A second copy behind the buttons would be a second chance to get that order wrong.
 */
export { DiscordRankApplier, ladderRoleIds } from '@grims/db';
