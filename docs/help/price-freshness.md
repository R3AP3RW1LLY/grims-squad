---
title: How price freshness works
surface: both
route: /logistics/commodities
---
Every market price on the site carries its age, and age changes how the price is treated. Three different rules apply, and they do different jobs.

The 90-day believability rule decides ranking. A price nobody has confirmed in 90 days — or one with no date at all — sorts behind every believable price, however cheap it looks. It is demoted, not hidden: hiding it would say "nobody sells this" about commodities sitting on a shelf right now. The one exception is the commodities index's "Near buy" / "Near sell" columns, which only count believable prices — hence their tooltips say "believable". The rule is deliberately blunt: an earlier scheme that also preferred week-old prices over month-old ones was measured to change the suggested station on about a third of real lookups, at a median 15% price increase — in the worst case paying 8.8 times more for a reading four days fresher — so within 90 days, price wins.

The 30-day warning is presentational. "Last seen" turns warning-coloured past 30 days, and a Freight Office card whose pickup or sale price is older than 30 days gets the footer "check before you commit to the trip."

The "Seen within" / "Prices seen" filters are yours: a hard cutoff you choose. The Freight Office defaults to "Within a week"; the commodity detail page defaults to "Any age".

Where prices come from: a galaxy-wide live feed reporting the whole bubble, a nightly full refresh, and members' own market visits — when you open a commodity market with the companion app paired, that station's entire price sheet is replaced with what you actually saw, within about half a minute. Station tables and route planning read those rows directly; the index columns and the price chart are hourly aggregates, so they can lag up to an hour behind your visit.

Related: commodities-index, commodity-detail, freight-office, data-bounties
