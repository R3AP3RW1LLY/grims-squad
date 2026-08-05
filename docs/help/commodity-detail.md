---
title: A commodity's detail page
surface: both
route: /logistics/commodities
---
Open any commodity from the index to see where to buy it, where to sell it, and how the price has moved.

The page opens with stat tiles — "Average buy", "Average sell", "Margin per tonne", "Best sell seen" — then four sections: "Where you are", "Price over time", "Best places to buy" and "Best places to sell".

"Where you are" is the filter box. Everything is a GET form, so a filtered result is a shareable URL:

1. "Near system" — where to measure from; left blank, your last journal position is used when known.
2. "Within" — 20, 50, 100, 250 or 500 ly (default 50).
3. "Seen within" — "Any age" (the default here), "A day", "A week" or "A month".
4. "Large pad only" and "Include fleet carriers" (carriers are excluded until you tick it). Press "Update".

"Price over time" plots two hourly series, "average buy" and "average sell", over the last week by default. An hour nobody traded breaks the line rather than joining across the gap. Hourly history began on 2 August 2026 and fills in from there — the page says so while the chart is still short.

The station tables show "Station", "System", "Price", "Supply" or "Demand", "Distance" and "Last seen". Each station wears a badge: "carrier", "L pad" or "no L pad". "Last seen" is when somebody last reported that market; over 30 days it turns warning-coloured, because the stock may be long gone. Stale prices are never hidden — they sort below believable ones instead.

The companion app's version of this page is a superset: eight stat tiles (adding the 24h move, cheapest buy, supply and demand), a "Min quantity (t)" filter, an "Arrival" distance column in the tables, a copy button on system names, and an automatic refresh every minute.

Related: commodities-index, price-freshness, freight-office
