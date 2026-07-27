# Brand assets

Drop the squadron logo here as:

    apps/web/public/brand/grims-squad-logo.png

Next serves `public/` at the site root, so it becomes `/brand/grims-squad-logo.png`.

## What we need

| File | Purpose | Notes |
|---|---|---|
| `grims-squad-logo.png` | full lockup — social cards, footer | the image as supplied is fine |
| `grims-squad-badge.png` | badge only, **transparent** | optional but much better for the nav |

The supplied image has a light grey gradient background rather than transparency.
On the dark navbar that shows as a pale box around the badge, so the nav crops
to the circular badge with `object-position` instead of scaling the whole
lockup. A transparent PNG of just the badge would let us drop that crop and
render it cleanly at any size.
