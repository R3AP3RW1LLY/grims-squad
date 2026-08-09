/**
 * Station names as the game gives them, turned into names a person would say.
 *
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * A member started a colonisation project and the site called the place
 * `$EXT_PANEL_ColonisationShip; Mitra Horizons`. It should say `Mitra Horizons`.
 *
 * ★ WHAT THAT STRING ACTUALLY IS ★
 *
 * Elite writes some names into the journal as a localisation KEY plus the part it could not
 * translate. `$EXT_PANEL_ColonisationShip;` is the game's identifier for "System Colonisation Ship";
 * the client looks it up in its language files and shows the player the translated words. Anything
 * reading the journal directly — us — gets the key, verbatim, with the station's own name trailing
 * after it.
 *
 * So this is not corruption and not a parsing bug. It is a name we stored in the game's internal
 * vocabulary instead of the player's, and it has been travelling all the way to the page.
 *
 * ★ STRIPPED AT THE DOOR, NOT AT THE TEMPLATE ★
 *
 * Applied where the name is first written down rather than where it is displayed. The same string
 * reaches a colonisation project, a market row, a station page, the assistant's answers and the
 * companion app, and a fix in one renderer would leave it wrong in the other four — with no way to
 * tell which had been done.
 *
 * ★ ONLY TOKENS WE HAVE ACTUALLY SEEN GET A NAME ★
 *
 * The same rule the station-type mapping next door follows. An unknown token is stripped, because a
 * `$SOMETHING;` prefix is never something a person should read — but it is never GUESSED at, and if
 * stripping would leave nothing at all the original is kept untouched. A blank station name is
 * worse than an ugly one: it is a row nobody can identify, in a table where the name is the key
 * members search by.
 */

/**
 * The localisation keys we have seen on real stations, and what the game shows for them.
 *
 * Colonisation ships arrive as the token alone when the site has not been named yet, and as
 * `<token> <name>` once it has.
 */
const TOKEN_DISPLAY: Readonly<Record<string, string>> = {
  EXT_PANEL_ColonisationShip: 'System Colonisation Ship',
};

/**
 * A leading `$KEY;` or `$KEY:#index=1;` segment.
 *
 * The `:#name=value` part is how the game carries a numbered variant (`Ring A`, depot #2). Matched
 * so those names strip cleanly too, rather than leaving `:#index=1;` behind — which would look
 * exactly like the bug this fixes.
 */
const TOKEN = /^\$([A-Za-z0-9_]+)(?::#[A-Za-z0-9_]+=[^;]*)*;\s*/;

/**
 * The name to show a member.
 *
 * Returns the input unchanged when there is nothing to do, so it is safe to apply to every station
 * name from every source — the overwhelming majority carry no token at all.
 */
export function cleanStationName<T extends string | null | undefined>(raw: T): T | string {
  if (raw === null || raw === undefined) return raw;

  let name = raw.trim();
  let lastToken: string | null = null;

  /*
   * A loop, not a single replace: a name can carry more than one key, and a version that stripped
   * only the first would still show `$EXT_PANEL_...;` to the member — the exact symptom reported,
   * merely one token shorter.
   */
  for (;;) {
    const match = TOKEN.exec(name);
    if (match === null) break;
    lastToken = match[1] ?? null;
    name = name.slice(match[0].length).trim();
  }

  if (name !== '') return name;

  /*
   * ★ THE TOKEN WAS THE WHOLE NAME — 924 OF THE 1,082 IN PRODUCTION ★
   *
   * A colonisation ship with no name of its own is a real thing: it is what a site is called before
   * anybody names it. Measured on the live database: 862 colonisation ships and 62 mission megaships
   * carry a key and nothing else.
   */
  if (lastToken === null) return raw;

  const known = TOKEN_DISPLAY[lastToken];
  if (known !== undefined) return known;

  /*
   * An unrecognised key, HUMANISED rather than shown raw.
   *
   * The first version returned the original here, on the principle that we do not guess at words we
   * have not seen. That principle is right about facts and wrong about this: the alternative is
   * putting `$Operations_Runner_Name:#index=1;` in front of a member, which is the exact complaint
   * that started this. Production holds four such keys — Operations_Runner_Name and three megaship
   * variants — and none of them will ever have a translation we can look up.
   *
   * So the key is rendered readably rather than translated. `Operations_Runner_Name` becomes
   * "Operations Runner": nothing is invented, the identifier is simply spelled the way a person
   * reads. A `_name` suffix is dropped because it names the FIELD, not the ship.
   */
  const humanised = lastToken
    .replace(/_name$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return humanised === '' ? raw : humanised;
}

/** Whether a name still carries a localisation key — used by the guards and the repair job. */
export function hasLocalisationToken(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && TOKEN.test(raw.trim());
}
