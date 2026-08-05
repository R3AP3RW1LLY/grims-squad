/**
 * Numbers the freight office, the route planner and the app all have to agree on.
 *
 * ★ ITS OWN CONTRACT, AND ITS OWN SUBPATH ★
 *
 * The form that asks for a cargo figure is a CLIENT component. Importing the shared barrel there
 * would pull permissions, the rich-document schema and everything else into a browser bundle to
 * deliver one integer, which is the reason the other client-facing constants
 * (`@grims/shared/version`, `/leaderboards`, `/fonts`) already have subpaths of their own.
 */
/**
 * The largest cargo figure the route planner will accept, in tonnes.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "on the freight office page, we need to max out the cargo T text entry so there is no max"
 *
 * It was 794 — the biggest hold a SHIP can carry, a fully fitted Type-9 — in the form and in two
 * clamps on the API. Which meant a member planning a fleet carrier run typed 25,000, watched the
 * field refuse it, and if they got past the field the server quietly planned for 794 anyway and
 * quoted a profit for a run nobody was doing.
 *
 * A carrier holds 25,000 tonnes, and that is the largest cargo capacity that exists in the game.
 * So this is "no max" in every sense a member can reach — no ship and no carrier is limited by it
 * any more.
 *
 * ★ WHY A CEILING SURVIVES AT ALL ★
 *
 * The clamp was never about ships; it was about arithmetic. Route profit is a per-tonne figure
 * multiplied by this number, so somebody typing 99999999 is quoted a total that is pure fiction —
 * and it is the one number on that page nobody double-checks. A bound that no real hold can reach
 * costs nothing and keeps that guarantee.
 *
 * Shared, because the form and both API clamps have to agree: a field that accepts more than the
 * server plans for is the worse of the two failures, and it is the one that was shipping.
 */
export const MAX_CARGO_TONNES = 25_000;
