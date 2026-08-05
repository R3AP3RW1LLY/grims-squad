/**
 * Minutes of voice as something a person reads: `2h 5m`, `45m`, or a dash.
 *
 * ★ A DASH, NOT A ZERO ★
 *
 * Zero minutes is the state of every month before the banking shipped as well as of a member
 * who never spoke — and the table cannot tell those apart, so it must not print a figure that
 * claims to. A dash says "nothing recorded", which is true of both.
 *
 * Minutes are what is stored; hours are derived HERE and only here. The old member profile
 * divided a join COUNT by sixty and called it hours — the formatter existing at all is the
 * guard against that arithmetic being reinvented at a call site.
 */
export function voiceTime(minutes: number): string {
  if (minutes <= 0) return '—';

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  return `${hours}h ${rest}m`;
}
