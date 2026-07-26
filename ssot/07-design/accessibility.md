# ACCESSIBILITY

**Non-negotiable.** The ED aesthetic fights accessibility; the response is measurement, not vibes.

Every ratio below is **computed** from the hex values in `tokens.json` using the WCAG 2.1 relative-luminance formula. Nothing here is asserted. The computation is reproducible — the script lives at `tools/contrast-check.ts` and runs in CI against `tokens.json`, so **a token change that breaks a pairing fails the build.**

Thresholds: **AA normal text 4.5:1** · **AA large text 3.0:1** (≥24px, or ≥18.66px bold) · **AAA 7.0:1** · **non-text UI and focus indicators 3.0:1**.

---

## ⚠ A correction to the source spec's assumption

The build spec (§11.2) states that *"orange-on-black at small sizes often fails WCAG AA"* and directs us to reserve `--ed-orange` for large text only.

**Computed against our actual surface tokens, that is not true.** `brand.orange` `#ff7100` scores **5.95–7.31** against every surface in the palette — comfortably past AA for normal text. The spec's warning is directionally sound (ED orange *does* fail against lighter or mid-grey backgrounds, which is the common case in ED-themed sites), but our surfaces are deep enough that it passes.

**What genuinely fails is different, and would have been missed by following the spec's rule of thumb:**
- `text.dim` `#5b6b7d` — **fails AA for normal text on every surface** (3.01–3.69)
- `brand.orangeDim` `#b34f00` — **fails AA for normal text on every surface** (3.16–3.88)
- `semantic.hostile` `#ff2b2b` — **fails on `panelHover` (4.40)** while passing on the other three

Measuring found the real problems. The rule of thumb would have restricted a colour that is fine and left three that are not. This is why the CI check exists.

---

## Text on surfaces — computed

| Foreground | Hex | Background | Hex | Ratio | AA normal | AA large | AAA |
|---|---|---|---|---:|:---:|:---:|:---:|
| `text.primary` | `#e8eef5` | `surface.void` | `#05070a` | **17.27** | PASS | PASS | PASS |
| `text.primary` | `#e8eef5` | `surface.panel` | `#0b0f14` | **16.45** | PASS | PASS | PASS |
| `text.primary` | `#e8eef5` | `surface.panelRaised` | `#121820` | **15.27** | PASS | PASS | PASS |
| `text.primary` | `#e8eef5` | `surface.panelHover` | `#18202a` | **14.06** | PASS | PASS | PASS |
| `text.secondary` | `#93a4b8` | `surface.void` | `#05070a` | **7.92** | PASS | PASS | PASS |
| `text.secondary` | `#93a4b8` | `surface.panel` | `#0b0f14` | **7.54** | PASS | PASS | PASS |
| `text.secondary` | `#93a4b8` | `surface.panelRaised` | `#121820` | **7.00** | PASS | PASS | PASS |
| `text.secondary` | `#93a4b8` | `surface.panelHover` | `#18202a` | **6.45** | PASS | PASS | FAIL |
| **`text.dim`** | `#5b6b7d` | `surface.void` | `#05070a` | **3.69** | **FAIL** | PASS | FAIL |
| **`text.dim`** | `#5b6b7d` | `surface.panel` | `#0b0f14` | **3.52** | **FAIL** | PASS | FAIL |
| **`text.dim`** | `#5b6b7d` | `surface.panelRaised` | `#121820` | **3.27** | **FAIL** | PASS | FAIL |
| **`text.dim`** | `#5b6b7d` | `surface.panelHover` | `#18202a` | **3.01** | **FAIL** | PASS | FAIL |
| `brand.orange` | `#ff7100` | `surface.void` | `#05070a` | **7.31** | PASS | PASS | PASS |
| `brand.orange` | `#ff7100` | `surface.panel` | `#0b0f14` | **6.97** | PASS | PASS | FAIL |
| `brand.orange` | `#ff7100` | `surface.panelRaised` | `#121820` | **6.47** | PASS | PASS | FAIL |
| `brand.orange` | `#ff7100` | `surface.panelHover` | `#18202a` | **5.95** | PASS | PASS | FAIL |
| `brand.orangeBright` | `#ff9d3f` | `surface.void` | `#05070a` | **9.74** | PASS | PASS | PASS |
| `brand.orangeBright` | `#ff9d3f` | `surface.panel` | `#0b0f14` | **9.29** | PASS | PASS | PASS |
| `brand.orangeBright` | `#ff9d3f` | `surface.panelRaised` | `#121820` | **8.62** | PASS | PASS | PASS |
| `brand.orangeBright` | `#ff9d3f` | `surface.panelHover` | `#18202a` | **7.93** | PASS | PASS | PASS |
| **`brand.orangeDim`** | `#b34f00` | `surface.void` | `#05070a` | **3.88** | **FAIL** | PASS | FAIL |
| **`brand.orangeDim`** | `#b34f00` | `surface.panel` | `#0b0f14` | **3.69** | **FAIL** | PASS | FAIL |
| **`brand.orangeDim`** | `#b34f00` | `surface.panelRaised` | `#121820` | **3.43** | **FAIL** | PASS | FAIL |
| **`brand.orangeDim`** | `#b34f00` | `surface.panelHover` | `#18202a` | **3.16** | **FAIL** | PASS | FAIL |
| `brand.cyan` | `#00c8ff` | `surface.void` | `#05070a` | **10.28** | PASS | PASS | PASS |
| `brand.cyan` | `#00c8ff` | `surface.panel` | `#0b0f14` | **9.80** | PASS | PASS | PASS |
| `brand.cyan` | `#00c8ff` | `surface.panelRaised` | `#121820` | **9.09** | PASS | PASS | PASS |
| `brand.cyan` | `#00c8ff` | `surface.panelHover` | `#18202a` | **8.37** | PASS | PASS | PASS |
| `brand.cyanBright` | `#5cd9ff` | `surface.void` | `#05070a` | **12.32** | PASS | PASS | PASS |
| `brand.cyanBright` | `#5cd9ff` | `surface.panel` | `#0b0f14` | **11.74** | PASS | PASS | PASS |
| `brand.cyanBright` | `#5cd9ff` | `surface.panelRaised` | `#121820` | **10.89** | PASS | PASS | PASS |
| `brand.cyanBright` | `#5cd9ff` | `surface.panelHover` | `#18202a` | **10.03** | PASS | PASS | PASS |
| `semantic.hostile` | `#ff2b2b` | `surface.void` | `#05070a` | **5.41** | PASS | PASS | FAIL |
| `semantic.hostile` | `#ff2b2b` | `surface.panel` | `#0b0f14` | **5.15** | PASS | PASS | FAIL |
| `semantic.hostile` | `#ff2b2b` | `surface.panelRaised` | `#121820` | **4.78** | PASS | PASS | FAIL |
| **`semantic.hostile`** | `#ff2b2b` | `surface.panelHover` | `#18202a` | **4.40** | **FAIL** | PASS | FAIL |
| `semantic.hostileBright` | `#ff7a7a` | `surface.void` | `#05070a` | **7.99** | PASS | PASS | PASS |
| `semantic.hostileBright` | `#ff7a7a` | `surface.panel` | `#0b0f14` | **7.61** | PASS | PASS | PASS |
| `semantic.hostileBright` | `#ff7a7a` | `surface.panelRaised` | `#121820` | **7.06** | PASS | PASS | PASS |
| `semantic.hostileBright` | `#ff7a7a` | `surface.panelHover` | `#18202a` | **6.50** | PASS | PASS | FAIL |
| `semantic.success` | `#3dff8f` | `surface.void` | `#05070a` | **15.27** | PASS | PASS | PASS |
| `semantic.success` | `#3dff8f` | `surface.panel` | `#0b0f14` | **14.55** | PASS | PASS | PASS |
| `semantic.success` | `#3dff8f` | `surface.panelRaised` | `#121820` | **13.51** | PASS | PASS | PASS |
| `semantic.success` | `#3dff8f` | `surface.panelHover` | `#18202a` | **12.43** | PASS | PASS | PASS |
| `semantic.warning` | `#ffc400` | `surface.void` | `#05070a` | **12.63** | PASS | PASS | PASS |
| `semantic.warning` | `#ffc400` | `surface.panel` | `#0b0f14` | **12.03** | PASS | PASS | PASS |
| `semantic.warning` | `#ffc400` | `surface.panelRaised` | `#121820` | **11.17** | PASS | PASS | PASS |
| `semantic.warning` | `#ffc400` | `surface.panelHover` | `#18202a` | **10.28** | PASS | PASS | PASS |

## Text on filled accents (dark-on-bright)

| Foreground | Background | Ratio | AA normal | AA large |
|---|---|---:|:---:|:---:|
| `text.onAccent` `#05070a` | `brand.orange` `#ff7100` | **7.31** | PASS | PASS |
| `text.onAccent` `#05070a` | `brand.orangeBright` `#ff9d3f` | **9.74** | PASS | PASS |
| `text.onAccent` `#05070a` | `brand.cyan` `#00c8ff` | **10.28** | PASS | PASS |
| `text.onAccent` `#05070a` | `semantic.success` `#3dff8f` | **15.27** | PASS | PASS |
| `text.onAccent` `#05070a` | `semantic.warning` `#ffc400` | **12.63** | PASS | PASS |
| `text.onAccent` `#05070a` | `semantic.hostile` `#ff2b2b` | **5.41** | PASS | PASS |

**Never white text on a filled accent.** `#e8eef5` on `#ffc400` is ~1.4:1 — illegible. Filled buttons are always dark-on-bright.

## Non-text contrast (3.0:1 required)

| Element | Hex | Against | Ratio | Pass |
|---|---|---|---:|:---:|
| `border.focus` | `#ff9d3f` | `surface.panel` | **9.29** | PASS |
| `border.focus` | `#ff9d3f` | `surface.panelRaised` | **8.62** | PASS |
| `brand.orange` | `#ff7100` | `surface.panel` | **6.97** | PASS |
| `brand.orangeDim` | `#b34f00` | `surface.panel` | **3.69** | PASS |
| `brand.orangeDim` | `#b34f00` | `surface.panelRaised` | **3.43** | PASS |
| `text.secondary` | `#93a4b8` | `surface.panelRaised` | **7.00** | PASS |

`border.hairline` at 18% alpha is **decorative only** and is deliberately below 3.0:1. It must never be the sole indicator of a control's boundary — every interactive element also has a background change, a label, or a focus ring.

---

## FORBIDDEN combinations

**These fail AA for normal text and are lint errors, not guidelines.**

| Combination | Ratio | Permitted use |
|---|---|---|
| `text.dim` on **any** surface | 3.01–3.69 | **Disabled controls and decorative rules only.** Never information a member needs. If a member must read it, it is not `text.dim`. |
| `brand.orangeDim` on **any** surface | 3.16–3.88 | **Borders, inactive states, decorative fills only. Never text at any size.** |
| `semantic.hostile` on `surface.panelHover` | 4.40 | Use `semantic.hostileBright` (6.50) for hostile text on hover rows. |
| `text.primary` on any filled accent | ~1.2–1.9 | Never. Use `text.onAccent`. |

## Required substitutions

| Instead of | At body size use | Because |
|---|---|---|
| `brand.orange` | `brand.orangeBright` | 5.95 → 7.93 on hover rows; reaches AAA and stays legible on a phone in daylight |
| `semantic.hostile` | `semantic.hostileBright` | Fixes the `panelHover` failure and reaches AAA on three surfaces |
| `text.dim` | `text.secondary` | 3.01 → 6.45; the only pair that is actually readable |
| `brand.cyan` for link text on raised panels | `brand.cyanBright` | 9.09 → 10.89; better at 14px in a dense table |

---

## Beyond contrast

### Colour is never the only signal
The BGS delta indicator is red/green, and **deuteranopia makes red/green nearly indistinguishable** — as it does the standard ED orange/red pairing. Therefore:

| Meaning | Colour | **Plus** |
|---|---|---|
| Influence up | `success` | ▲ icon **and** a signed number (`+2.4%`) |
| Influence down | `hostile` | ▼ icon **and** a signed number (`−1.1%`) |
| Data fresh (<24 h) | `fresh` | ● icon **and** the literal age ("3h ago") |
| Data aging (<7 d) | `aging` | ◐ icon **and** the literal age ("4d ago") |
| Data stale (>7 d) | `stale` | ○ icon **and** the literal age ("31d ago") |
| Hostile faction | `hostile` | a label, never a bare colour swatch |

INV-004 requires the *value*; this section requires it to be readable without colour vision.

### Themes shipped, not optional
| Theme | Trigger | Behaviour |
|---|---|---|
| **Default dark** | — | Tokens above |
| **High contrast** | `prefers-contrast: more`, or manual | Every text token raised to ≥7:1, glow and scanline removed, borders thickened to 2px opaque |
| **Reduced motion** | `prefers-reduced-motion: reduce`, or manual | All durations → 0; panel-draw, scanline, glow pulse and the boot sequence removed entirely |
| **Colour-blind safe** | manual | Semantic ramp swapped to blue/orange; icon differentiation increased |

`prefers-contrast` and `prefers-reduced-motion` are honoured **automatically**, not hidden behind a settings page.

### Keyboard and screen reader
- **Full keyboard navigation.** Every interaction reachable and operable without a pointer.
- **Visible focus ring — 2px `border.focus`, 2px offset — never removed.** `outline: none` without a replacement is a review-blocking defect.
- The command palette (⌘K) is the keyboard route to everything, including GSAI.
- **Custom data grids need real ARIA**: `role="grid"`, `aria-sort` on sortable headers, `aria-rowcount` for virtualised tables, managed roving tabindex.
- Semantic landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>` on every page.
- Live regions for streaming GSAI responses (`aria-live="polite"`) and for alerts (`aria-live="assertive"`).
- Skip-to-content link as the first focusable element.
- **Every icon-only control has an accessible name.** A bare glyph button is a defect.

### Motion
- The boot sequence plays **once per session and is skippable** — charming once, infuriating on the fifth page view.
- Scanline sits at ~1.2% opacity. At that level it is texture, not pattern; above ~3% it becomes a migraine trigger.
- No auto-playing video, no parallax tied to scroll position, no flashing above 3 Hz.

### Mobile
- **Minimum 44px touch targets.** ~40% of traffic is phones, often mid-play-session on a second screen.
- Dense data tables scroll horizontally in their own container — **the page body never scrolls horizontally.**
- Pinch-zoom is never disabled.

---

## Verification

| Check | Tool | Gate |
|---|---|---|
| Token contrast pairs | `tools/contrast-check.ts` against `tokens.json` | **CI, blocking** — a token change that breaks a pairing fails the build |
| Lighthouse accessibility ≥ 95 | Lighthouse CI | P0.5, and every phase adding a screen |
| Automated a11y violations | axe-core in the e2e suite | CI, blocking |
| Keyboard-only walkthrough of each key screen | manual | phase exit |
| Screen-reader pass on the dashboard, forum and trade terminal | manual, NVDA or VoiceOver | P9 audit |
| `prefers-reduced-motion` and `prefers-contrast` respected | e2e assertion | P0.5 onward |
| Colour-blind simulation of the BGS console | manual | P4 exit |
