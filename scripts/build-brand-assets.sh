#!/usr/bin/env bash
#
# Derives every brand asset the site needs from ONE source image.
#
#   ./scripts/build-brand-assets.sh [path-to-source.png]
#
# Default source: apps/web/public/brand/grims-squad-logo.png
#
# Everything here is generated, so the source image is the single thing anyone
# has to replace when the branding changes. Re-run this and every derivative
# follows — favicon, social card, nav badge, PWA icons.
#
# WHY THE NAV GETS A CROPPED BADGE RATHER THAN THE FULL LOCKUP
# The navbar is ~56px tall. The lockup is 3:2, so fitted to that height it is
# ~84px wide and the words "GRIM'S SQUAD" render about 2mm high — illegible.
# The badge crops to a square that stays recognisable at 40px, and the wordmark
# stays as real HTML text: crisp at any zoom, readable by screen readers, and
# indexable.

set -euo pipefail

SRC="${1:-apps/web/public/brand/grims-squad-logo.png}"
OUT="apps/web/public/brand"
APP="apps/web/src/app"

command -v magick >/dev/null 2>&1 || { echo "ImageMagick 7 (magick) is required." >&2; exit 1; }
[[ -f "$SRC" ]] || { echo "Source image not found: $SRC" >&2; exit 1; }

W=$(magick identify -format '%w' "$SRC")
H=$(magick identify -format '%h' "$SRC")
echo "  source: $SRC  (${W}x${H})"

# --- the badge -------------------------------------------------------------
# The circular emblem sits centred. Cropped as a square of 68% of the image
# HEIGHT, nudged up slightly because the lockup leaves more room below the
# badge (the "CIRCA 2006" rule) than above it.
BADGE=$(( H * 68 / 100 ))
OFF_X=$(( (W - BADGE) / 2 ))
OFF_Y=$(( (H - BADGE) / 2 - H * 4 / 100 ))
(( OFF_Y < 0 )) && OFF_Y=0

echo "  badge crop: ${BADGE}x${BADGE}+${OFF_X}+${OFF_Y}"

magick "$SRC" -crop "${BADGE}x${BADGE}+${OFF_X}+${OFF_Y}" +repage \
  -resize 512x512 "$OUT/badge-512.png"

# Knock the flat grey backdrop out to transparency. -fuzz is generous because
# the supplied backdrop is a GRADIENT rather than one flat colour; the gold and
# near-black of the emblem itself are far enough away not to be touched.
magick "$OUT/badge-512.png" \
  -alpha set -channel RGBA \
  -fuzz 22% -fill none -draw 'color 0,0 floodfill' \
  -draw "color $((512-1)),0 floodfill" \
  -draw "color 0,$((512-1)) floodfill" \
  -draw "color $((512-1)),$((512-1)) floodfill" \
  "$OUT/badge-512-transparent.png" 2>/dev/null || cp "$OUT/badge-512.png" "$OUT/badge-512-transparent.png"

for s in 32 48 64 128 192 256; do
  magick "$OUT/badge-512-transparent.png" -resize "${s}x${s}" "$OUT/badge-${s}.png"
done

# --- favicon ---------------------------------------------------------------
# Multi-resolution .ico so Windows, the tab strip and bookmarks each pick the
# size they want instead of downscaling one bitmap badly.
magick "$OUT/badge-512-transparent.png" \
  -define icon:auto-resize=16,24,32,48,64,128,256 \
  "$APP/favicon.ico"

# Apple wants a SQUARE, OPAQUE icon — iOS renders transparency as black.
magick "$OUT/badge-512-transparent.png" -resize 180x180 \
  -background '#05070a' -alpha remove -alpha off \
  "$APP/apple-icon.png"

magick "$OUT/badge-512-transparent.png" -resize 192x192 "$APP/icon.png"

# --- social card -----------------------------------------------------------
# 1200x630 is the size Discord, Twitter/X, Facebook and Slack all crop toward.
# Composited onto the site's own void colour so the card matches the site people
# land on, rather than the grey the source image happens to carry.
magick -size 1200x630 "xc:#05070a" \
  \( "$SRC" -resize 1200x630 -gravity center -extent 1200x630 \) \
  -compose over -composite \
  "$OUT/og-card.png"

# --- footer lockup ---------------------------------------------------------
magick "$SRC" -resize 720x "$OUT/lockup-720.png"

echo ""
echo "  generated:"
for f in "$OUT"/badge-*.png "$OUT"/og-card.png "$OUT"/lockup-720.png "$APP"/favicon.ico "$APP"/apple-icon.png "$APP"/icon.png; do
  [[ -f "$f" ]] && printf '    %-56s %6s bytes\n' "$f" "$(wc -c < "$f")"
done
echo ""
echo "  Check badge-512-transparent.png before shipping — the knockout is tuned"
echo "  for a light backdrop. If the source is already transparent it is a no-op."
