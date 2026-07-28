/**
 * A Discord role, in the colour Discord gives it.
 *
 * ★ THE COLOUR CANNOT BE TRUSTED TO BE READABLE ★
 *
 * Discord shows role colours against a light-grey or dark-grey member list, and
 * server owners pick them to look right THERE. This page is near-black, and one
 * of this squadron's own roles is `#030000` — a colour that is legible in
 * Discord's own dark theme against #313338, and completely invisible here.
 *
 * So the colour is used for the chip's BORDER and a dot, and the label itself
 * is only tinted when the colour is bright enough to read. That keeps the
 * recognition — you still spot your own role by its colour — without producing
 * text nobody can see.
 *
 * The alternative, lightening the colour until it passes contrast, was worse:
 * it changes what the role looks like, so the thing meant to be recognisable
 * stops matching the place it is recognised from.
 */

/**
 * Perceived brightness, 0–255.
 *
 * ITU-R BT.601 coefficients — the weights that describe how much each channel
 * contributes to how bright a colour LOOKS, rather than treating red, green and
 * blue as equal. Green dominates; blue barely registers. A naive average would
 * call pure blue (#0000ff) mid-bright and let it through as body text.
 */
function brightness(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return null;

  const n = Number.parseInt(match[1] as string, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;

  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Bright enough to read as text on this page.
 *
 * 90 of 255, found by testing against the real roles rather than picked from a
 * table: `#6d6d6d` (Cadet) sits at 109 and is comfortably readable, `#030000`
 * (Grim's Squad members) at 1 is not.
 */
const MIN_TEXT_BRIGHTNESS = 90;

export function RoleChip({ name, colour }: { name: string; colour: string | null }) {
  const level = colour === null ? null : brightness(colour);
  const readable = level !== null && level >= MIN_TEXT_BRIGHTNESS;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none"
      style={{
        // Held back from full strength so a bright role does not out-shout the
        // member's own name directly above it.
        borderColor: colour === null ? 'var(--color-border-hairline)' : `${colour}66`,
        color: readable && colour !== null ? colour : 'var(--color-text-secondary)',
      }}
    >
      {colour !== null && (
        /*
          The dot carries the colour at FULL strength, whatever the label does.
          It is the part that makes a role recognisable at a glance, and a dot
          too dark to see costs nothing next to a label that is still legible.
        */
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: colour }}
        />
      )}
      {name}
    </span>
  );
}
