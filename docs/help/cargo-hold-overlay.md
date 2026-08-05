---
title: The cargo hold overlay
surface: companion
route: Settings
---
The "Cargo hold" overlay (on screen: "CARGO") shows what is aboard, what it cost you, and what your last sale made.

The panel lists your top five commodities by count. Commodities your current build still needs — or the construction site you are docked at still needs — are drawn in the accent colour, matched against what actually remains, so something the site already has enough of is not highlighted. Under the list sits the capacity line, "{used} / {capacity} t"; capacity comes from your ship's loadout, so a mid-session cargo-rack refit shows up.

Paid values come from your own purchases: the app watches your market buys and keeps a running average cost per commodity, shown as a dim "· {n} cr" after the count. Cargo the app cannot price — mined ore, mission cargo, anything bought before the app was watching — shows no figure at all rather than a fake zero. The total line, "Paid {n} cr for what is aboard", sums only the priced lines, so it under-reports rather than invents.

After you sell something, one receipt line appears: "Sold {units} {commodity} · {sale} cr", followed by the profit or loss in brackets — green in profit, red at a loss — when a cost basis exists. The basis prefers the game's own average price paid (which covers buys from before the app was watching); failing that, the app's own ledger; failing both, the brackets are simply omitted. The receipt persists until your next sale replaces it. Handing cargo to a construction site is a donation, not a sale — it never overwrites the receipt.

Two empty states mean different things: "Waiting for your hold." means the app has not read the game's cargo file yet; "Hold empty." means it has, and the hold really is empty.

Related: arranging-overlays, build-tracker-overlay, freight-office
