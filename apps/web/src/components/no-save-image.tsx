'use client';

import Image from 'next/image';

/**
 * A brand image with the easy ways of saving it taken away.
 *
 * ★ READ THIS BEFORE TRUSTING IT ★
 *
 * Squadron owner, 2026-07-29: the logo assets must not be downloadable from the
 * website.
 *
 * This raises the bar. It does NOT seal the door, and no amount of code can:
 * a browser cannot render an image it has not already downloaded. By the time
 * anybody sees the logo, the bytes are on their machine — in the cache, in the
 * network panel, in the page source. Anyone who opens developer tools has it,
 * and a screenshot needs no tools at all.
 *
 * What this DOES stop is every casual route, which is the traffic that actually
 * matters:
 *
 *   right-click -> Save image as      blocked (onContextMenu)
 *   drag to the desktop               blocked (draggable / onDragStart)
 *   long-press -> Save on iOS         blocked (-webkit-touch-callout)
 *   select-and-copy on Android        blocked (user-select)
 *   pasting the file URL into the bar blocked in middleware, not here
 *
 * Writing it down honestly matters more than the feature does. A protection
 * described as absolute is one somebody later relies on absolutely.
 *
 * ★ NOT A RIGHT-CLICK BLOCKER FOR THE WHOLE PAGE ★
 *
 * Only the image element. Disabling the context menu across a page breaks
 * "open in new tab", spellcheck and every accessibility affordance a browser
 * offers, to protect one PNG — and it is the single most reliable way to make a
 * site feel hostile.
 */
export function NoSaveImage({
  src,
  alt,
  width,
  height,
  className,
  sizes,
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      priority={priority}
      className={className}
      /*
       * `draggable` is the HTML attribute; `onDragStart` catches the browsers
       * that honour the event but not the attribute. Both, because the two
       * disagree across engines and the failure is silent.
       */
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        // Long-press on iOS Safari offers "Save Image" from here, not from the
        // context menu. This is the only thing that turns it off.
        WebkitTouchCallout: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    />
  );
}
