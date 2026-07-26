# EDCD/FDevIDs

## Role in this system
The canonical mapping from Frontier's internal names to display names for commodities, modules and ships. **The naming authority.** Everything else in the ecosystem is inconsistent.

## Trust tier
**authoritative** — this is the reference data, not an opinion about it.

## Access requirements
None. Public GitHub repository, CSV files, MIT-adjacent community licensing (check the repository for the current terms).

## Base URL
```
https://github.com/EDCD/FDevIDs
https://raw.githubusercontent.com/EDCD/FDevIDs/master/<file>.csv
```

## Files we consume
| File | Contents | Feeds |
|---|---|---|
| `commodity.csv` | `id`, `symbol`, `category`, `name`, `average_price`, `is_rare` | `reference_names(kind='commodity')` |
| `rare_commodity.csv` | Rare goods with their source stations | `reference_names(kind='rare_commodity')` |
| `outfitting.csv` | Module `id`, `symbol`, `category`, `name`, `mount`, `guidance`, `ship`, `class`, `rating`, `entitlement` | `reference_names(kind='module')`, `packages/ed-domain` |
| `shipyard.csv` | Ship `id`, `symbol`, `name`, `entitlement` | `reference_names(kind='ship')` |

## Response shapes
`commodity.csv`:
```csv
id,symbol,category,name,average_price,is_rare
128049204,Tritium,Chemicals,Tritium,41000,0
128049202,LowTemperatureDiamond,Minerals,Low Temperature Diamonds,884000,0
```

`shipyard.csv`:
```csv
id,symbol,name,entitlement
128049267,SideWinder,Sidewinder,
128049363,Python,Python,
```

The mapping we store is `symbol → name`, per kind. **`symbol` is what arrives from EDDN, cAPI and the journal; `name` is the only thing a human ever sees.**

## Refresh cadence
- **Monthly**, alongside the `coriolis-data` check (`09-runbooks/`).
- **Pinned to a specific release tag or commit**, recorded in `site_config`, so a re-run is reproducible and a bad upstream change can be rolled back.
- Idempotent upsert on `(kind, internalName)`.
- **A commodity present in `market_orders` with no `reference_names` row raises an alert** — never a silent fallback to the internal name.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| GitHub unavailable | timeout / 5xx | Keep the existing mapping. **This is reference data — a failed refresh is a non-event.** Alert only if it fails for a week. |
| CSV column added or renamed | header check | Parse by header name, never by position. A new column is fine; a renamed one alerts. |
| New commodity appears in EDDN before the mapping updates | unmapped symbol in `market_orders` | **Alert, and render the row with an explicit "unknown commodity" placeholder — never the raw internal name** (INV-020). |
| Symbol removed upstream | diff against stored rows | Retain the existing row. Historical data still references it. **Never delete reference rows.** |
| Duplicate symbols | uniqueness check on import | Fail the import loudly. A duplicate symbol means a corrupt upstream file, and importing it half-succeeds otherwise. |

## Adapter interface
```ts
// packages/ed-clients/src/fdevids/fdevids.adapter.ts
export interface IReferenceDataProvider {
  readonly source: 'fdevids';
  readonly trustTier: 'authoritative';

  /** Downloads and parses a pinned release. Idempotent; safe to re-run. */
  fetchReferenceData(ref: string): Promise<{
    commodities: ReferenceEntry[];
    rareCommodities: ReferenceEntry[];
    modules: ModuleReferenceEntry[];
    ships: ReferenceEntry[];
    sourceRef: string;
  }>;
}

export interface ReferenceEntry {
  internalName: string;   // `symbol` — arrives from EDDN/cAPI/journal, NEVER displayed
  displayName: string;    // `name`  — the only form a user sees
  category: string | null;
  avgPrice: number | null;
  isRare: boolean;
}
```

Runtime resolution is a **cached in-memory map in `packages/ed-domain`**, not a database round-trip per row — the trade terminal resolves thousands of names per response.

## Gotchas
- **Never hand-map.** The temptation is real: `"lowtemperaturediamond"` → "Low Temperature Diamonds" looks trivial to derive. It is not — the game's internal names are inconsistent in casing, pluralisation, spacing and abbreviation, and hand-maps rot silently as Frontier adds content. `AGENTS.md` states this as a hard rule.
- **Never display an internal name to a user** (INV-020). A commodity page reading "lowtemperaturediamond" is an obvious defect; a *route result* reading it is worse, because members will screenshot it.
- **EDDN commodity symbols arrive lowercase**; FDevIDs symbols are mixed case. **Match case-insensitively**, and store the FDevIDs casing as canonical. This single mismatch is the most common cause of "unknown commodity" for a commodity that is plainly mapped.
- **`is_rare` matters for trade logic.** Rare goods have per-station supply caps and distance-scaled pricing; treating them as ordinary commodities produces nonsense route suggestions.
- **`average_price` is a galactic mean, not a current price.** It seeds `reference_names.avgPrice` for display context only, never for profit calculation.
- **Module symbols encode class and rating** (e.g. `Int_Powerplant_Size4_Class5`). `packages/ed-domain` parses them for the ship-maths; do not reimplement that parsing elsewhere.
- **Frontier keeps adding ships and commodities** — Mandalay, Cobra Mk V, Corsair, Panther Clipper and their successors. A monthly refresh is a real recurring obligation, not a nice-to-have. Skipping it produces unmapped names in the UI within weeks of a game update.
- **Never delete a reference row when a symbol disappears upstream.** Historical `market_history` and `loadouts` rows still reference it, and deleting the mapping turns old records into gibberish.
- **Pin the release.** An unpinned `master` fetch means an upstream mistake becomes our production data with no way to identify when it changed.
