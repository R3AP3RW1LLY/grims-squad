/**
 * What a fleet carrier is called, and what our data calls its station type.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "we are trying to find a fleet carrier in the Fleet Carriers on this build section ... it is in
 * system in game! its not coming back when searching by name or ID number".
 *
 * ★ THE STATION TYPE COLUMN HOLDS TWO VOCABULARIES, AND WE ONLY EVER ASKED FOR ONE ★
 *
 * `knowledge_items.data->>'type'` is filled from two places that do not agree:
 *
 *   - the Spansh galaxy dump, which writes DISPLAY names — `"Drake-Class Carrier"`,
 *     `"Coriolis Starport"`, `"Asteroid base"`.
 *   - a live `Docked` journal event off EDDN, which carries the game's INTERNAL enum —
 *     `"FleetCarrier"`, `"Coriolis"`, `"AsteroidBase"`.
 *
 * Every carrier query in the codebase asked for the first spelling exactly. Measured on the dev
 * mirror the day this was found: 47,687 carrier rows said `Drake-Class Carrier` and 673 said
 * `FleetCarrier` — and the owner's own carrier, W8K-W1Y, was one of the 673. It was in the galaxy
 * catalogue, it had a market in the mirror seen that morning, it was parked at the build site, and
 * the search returned nothing at all.
 *
 * ★ AND THE THING THAT FLIPPED IT WAS DOCKING AT IT ★
 *
 * `enrichStationFromDock` writes the live sighting's type over the dump's, because a live sighting
 * genuinely is fresher. So the sequence was: the dump teaches us a carrier as `Drake-Class Carrier`
 * and it is findable — then somebody docks at it, we learn MORE about it, and it vanishes from the
 * carrier search. The refusal the member saw said "Dock at it once and it will appear", and docking
 * at it was the exact thing that removed it.
 *
 * 560 of those 673 rows carry the fingerprint of that write: a `landingPads` object with `large`
 * and nothing else, which is what `enrichStationFromDock` builds and what the dump never produces.
 *
 * ★ SO: NORMALISE ON THE WAY IN, AND ACCEPT BOTH ON THE WAY OUT ★
 *
 * `normaliseStationType` is used where live data is written, so the two vocabularies stop diverging
 * from here on. `CARRIER_STATION_TYPES` is used by every reader, because the rows already written
 * are not going to un-write themselves and a reader that trusts one spelling is one dock away from
 * being wrong again.
 */

/**
 * The game's internal station-type enum, mapped to the display name the galaxy dump uses.
 *
 * Only pairs OBSERVED IN OUR OWN DATA under both spellings are listed. A guessed mapping would
 * silently relabel stations, and a wrong label on a station type is how a member ends up flying to
 * a pad that is not there.
 */
const JOURNAL_TO_DISPLAY: Readonly<Record<string, string>> = {
  FleetCarrier: 'Drake-Class Carrier',
  Coriolis: 'Coriolis Starport',
  Orbis: 'Orbis Starport',
  Ocellus: 'Ocellus Starport',
  // Journals from before the Ocellus rename still say Bernal. Same station, older word for it.
  Bernal: 'Ocellus Starport',
  Dodec: 'Dodec Starport',
  AsteroidBase: 'Asteroid base',
  MegaShip: 'Mega ship',
  SpaceConstructionDepot: 'Space Construction Depot',
  PlanetaryConstructionDepot: 'Planetary Construction Depot',
};

/**
 * The dump's spelling for a type, when we know it. Anything unrecognised is passed through
 * untouched — an unmapped type is still a true fact about the station, and dropping it would be a
 * worse trade than storing a word we do not have a synonym for.
 */
export function normaliseStationType(type: string | null | undefined): string | null {
  if (type === null || type === undefined) return null;
  const trimmed = type.trim();
  if (trimmed === '') return null;
  return JOURNAL_TO_DISPLAY[trimmed] ?? trimmed;
}

/**
 * Every spelling a fleet carrier's station type appears under.
 *
 * Readers must accept ALL of these. Passed to SQL as an array against `= ANY($n::text[])` rather
 * than interpolated, so no query can drift off the list by hand-writing one of them.
 */
export const CARRIER_STATION_TYPES: readonly string[] = ['Drake-Class Carrier', 'FleetCarrier'];

/** Whether a station type — in either vocabulary — is a fleet carrier. */
export function isCarrierStationType(type: string | null | undefined): boolean {
  return type !== null && type !== undefined && CARRIER_STATION_TYPES.includes(type.trim());
}

/**
 * ★ THE CALLSIGN ★
 *
 * Every fleet carrier in the game has one, and it is the only name for a carrier that its owner
 * cannot change: three alphanumerics, a dash, three more — `W8K-W1Y`. The owner asked for the
 * search to be BY that, in a boxed control, because it is the identifier people read off the
 * contacts panel and say out loud.
 *
 * Normalisation is shared rather than done per surface: the website's boxed input, the companion's
 * boxed input and the API all have to agree on what `w8kw1y `, `W8K-W1Y` and ` w8k-w1y` are, and
 * they are all the same carrier. Three implementations of that would be three chances to disagree.
 */
export const CALLSIGN_LENGTH = 6;

/**
 * The characters of a callsign, upper-cased, with the dash and any stray whitespace removed.
 *
 * Returns at most six characters. Shorter is a partial callsign somebody is still typing, which is
 * a perfectly good thing to search on.
 */
export function normaliseCallsign(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CALLSIGN_LENGTH);
}

/** Whether what somebody typed is a complete callsign. */
export function isCompleteCallsign(raw: string): boolean {
  return normaliseCallsign(raw).length === CALLSIGN_LENGTH;
}

/**
 * Whether a station NAME is written in callsign shape — three alphanumerics, a dash, three more.
 *
 * ★ NOT `isCompleteCallsign`, AND THE DIFFERENCE MATTERS ★
 *
 * That one strips punctuation and whitespace before measuring, because it reads a search box where
 * `w8k w1y` and `W8K-W1Y` are the same thing somebody is typing. Fed a station name it answers true
 * for `Armstrong Legacy` — six letters after the space is removed — so using it to identify carriers
 * would hide most of the galaxy. This is the strict form, for reading data rather than a person.
 */
const CALLSIGN_SHAPE = /^[A-Za-z0-9]{3}-[A-Za-z0-9]{3}$/;

export function hasCallsignShape(name: string): boolean {
  return CALLSIGN_SHAPE.test(name.trim());
}

/**
 * Whether something we are about to recommend as a DESTINATION is a fleet carrier.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "do not show fleet carriers in here at all!"
 *
 * A carrier is the one station that moves. Sending a member to one is sending them to a place that
 * has gone, so every surface that answers "where do I fly" excludes them — and does it through this,
 * so the rule cannot drift apart across the website, the companion and the API.
 *
 * ★ TWO NETS, BECAUSE THE FIRST ONE HAS HOLES ★
 *
 * The station type is the real answer, when it is filled in. On production the day this was written,
 * 37 stations named in callsign shape had no type at all — and a hand-typed declaration has no type
 * to check by construction, since the member typed only a name. Not one station of any other type,
 * out of ~318,000, was named in that shape, so the second net costs nothing.
 */
export function looksLikeCarrier(name: string, type: string | null | undefined): boolean {
  return isCarrierStationType(type) || hasCallsignShape(name);
}

/**
 * The callsign out of a carrier's full name — what a member would say out loud.
 *
 * Most carriers are named by their callsign alone. An owner who has titled theirs gets
 * `W8K-W1Y Hauling Co`, and the six characters at the front are still the part anybody would use to
 * find it on a contacts panel.
 *
 * ★ WHY THIS IS SHARED RATHER THAN A REGEX PER CALLER ★
 *
 * It was written inline where a carrier is attached, and the attach prompt needed the same answer.
 * Two copies of a naming rule is two chances for the prompt to call a carrier something the
 * carriers tab does not — on the same page, about the same carrier.
 *
 * Falls back to the name itself, trimmed to a length that fits a line: a carrier whose name is not
 * in callsign shape still has to be called something.
 */
export function callsignFromName(name: string): string {
  const trimmed = name.trim();
  return /^([A-Za-z0-9]{3}-[A-Za-z0-9]{3})\b/.exec(trimmed)?.[1]?.toUpperCase() ?? trimmed.slice(0, 12);
}

/**
 * A complete callsign written the way the game writes it — `W8KW1Y` becomes `W8K-W1Y`.
 *
 * Anything shorter is returned as its own bare characters rather than with a trailing dash: a
 * half-typed callsign is not a callsign with a dash missing.
 */
export function formatCallsign(raw: string): string {
  const chars = normaliseCallsign(raw);
  if (chars.length <= 3) return chars;
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}
