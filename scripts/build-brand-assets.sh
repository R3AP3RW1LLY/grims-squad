#!/usr/bin/env bash
#
# Derives every brand asset the site needs from ONE source image.
#
#   ./scripts/build-brand-assets.sh [path-to-source.png]
#
# Default source: apps/web/public/brand/full-logo.png
#
# Everything below is generated, so the source image is the only thing anyone
# has to replace when the branding changes. Re-run this and every derivative
# follows: favicon, apple icon, PWA icon, social card, nav badge, footer lockup.
#
# WHY THE NAV GETS A CROPPED BADGE RATHER THAN THE FULL LOCKUP
# The navbar is ~56px tall. The lockup is 3:2, so fitted to that height it is
# ~84px wide and "GRIM'S SQUAD" renders about 2mm high — illegible. The badge
# crops to a square that stays recognisable at 40px, and the wordmark stays as
# real HTML text: crisp at any zoom, read by screen readers, and indexable.

set -euo pipefail

SRC="${1:-apps/web/public/brand/full-logo.png}"
OUT="apps/web/public/brand"
APP="apps/web/src/app"

command -v magick >/dev/null 2>&1 || { echo "ImageMagick 7 (magick) is required." >&2; exit 1; }
[[ -f "$SRC" ]] || { echo "Source image not found: $SRC" >&2; exit 1; }

W=$(magick identify -format '%w' "$SRC")
H=$(magick identify -format '%h' "$SRC")
echo "  source: $SRC  (${W}x${H})"

# --- the badge -------------------------------------------------------------
# Tuned by rendering candidates and LOOKING at them, not by arithmetic alone.
# 68% clipped the outer gold ring; 72% pulled "CIRCA 2006" into frame.
BADGE=$(( H * 69 / 100 ))
OFF_X=$(( (W - BADGE) / 2 ))
# Lifted above true centre: the lockup leaves more room beneath the badge (the
# CIRCA rule) than above it, so a centred crop catches the text before the ring.
OFF_Y=$(( (H - BADGE) / 2 - H * 58 / 1000 ))
(( OFF_Y < 0 )) && OFF_Y=0
echo "  badge crop: ${BADGE}x${BADGE}+${OFF_X}+${OFF_Y}"

magick "$SRC" -crop "${BADGE}x${BADGE}+${OFF_X}+${OFF_Y}" +repage -resize 512x512 "$OUT/badge-512.png"

# Knock the backdrop out to transparency by flood-filling from all four corners.
# -fuzz is generous because the backdrop is a GRADIENT rather than one flat
# colour; the gold and near-black of the emblem are far enough away to survive.
magick "$OUT/badge-512.png" -alpha set -channel RGBA -fuzz 22% -fill none \
  -draw 'color 0,0 floodfill' -draw 'color 511,0 floodfill' \
  -draw 'color 0,511 floodfill' -draw 'color 511,511 floodfill' \
  -strip -define png:compression-level=9 "$OUT/badge-512-transparent.png"

for s in 32 48 64 128 192 256; do
  magick "$OUT/badge-512-transparent.png" -resize "${s}x${s}" \
    -strip -define png:compression-level=9 "$OUT/badge-${s}.png"
done

# --- favicon ---------------------------------------------------------------
# Multi-resolution .ico so the tab strip, bookmarks and Windows shortcuts each
# pick a size rather than downscaling one bitmap badly.
#
# Stops at 48. Including 128 and 256 pushed the .ico past 220KB — for an icon
# that renders at 16px in a browser tab and that every visitor downloads.
magick "$OUT/badge-512-transparent.png" -define icon:auto-resize=16,24,32,48 "$APP/favicon.ico"

# Apple wants a SQUARE, OPAQUE icon — iOS composites transparency onto black.
magick "$OUT/badge-512-transparent.png" -resize 180x180 \
  -background '#05070a' -alpha remove -alpha off -strip "$APP/apple-icon.png"

magick "$OUT/badge-512-transparent.png" -resize 192x192 -strip "$APP/icon.png"

# --- social card -----------------------------------------------------------
# 1200x630 is what Discord, Twitter/X, Facebook and Slack all crop toward.
#
# JPEG, not PNG. This is a photographic gradient: as a PNG it came out near 1MB
# and a second lossless pass saved 3KB, because PNG is the wrong tool for it.
# Every social unfurl fetches this file.
#
# Composited on the site's own void colour so the card matches the page people
# actually land on, rather than the grey the source happens to carry.
magick -size 1200x630 "xc:#05070a" \
  \( "$OUT/badge-512-transparent.png" -resize 430x430 \) \
  -gravity center -geometry +0-24 -composite \
  -quality 86 -strip "$OUT/og-card.jpg"

# --- footer lockup ---------------------------------------------------------
# Backdrop knocked out, same as the badge. The footer is dark and the supplied
# lockup carries a light grey gradient, so without this it renders as a pale
# rectangle on the dark — which reads as a broken asset rather than a choice.
magick "$SRC" -resize 720x -alpha set -channel RGBA -fuzz 24% -fill none \
  -draw 'color 0,0 floodfill' -draw 'color 719,0 floodfill' \
  -strip -define png:compression-level=9 "$OUT/lockup-720.png"

echo ""
echo "  generated:"
for f in "$OUT"/badge-*.png "$OUT"/og-card.jpg "$OUT"/lockup-720.png \
         "$APP"/favicon.ico "$APP"/apple-icon.png "$APP"/icon.png; do
  [[ -f "$f" ]] && printf '    %-56s %8s bytes\n' "$f" "$(wc -c < "$f")"
done
echo ""
echo "  Inspect badge-512-transparent.png and lockup-720.png before shipping —"
echo "  the knockout is tuned for a light backdrop and is a no-op on a"
echo "  transparent source."
