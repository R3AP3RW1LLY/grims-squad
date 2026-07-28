/**
 * Where Elite Dangerous keeps its journal files, on every platform a member
 * might actually be playing on (P1.11).
 *
 * ★ THE AWKWARD FACT ★
 *
 * Elite Dangerous has NO native macOS build. Frontier discontinued the Mac
 * client in 2015 and neither Horizons 4.0 nor Odyssey has one. So "support
 * macOS" cannot mean "the game runs there natively" — it means supporting the
 * Mac users who DO play, through CrossOver or Whisky, and whose journals live
 * inside a Wine bottle rather than in a Mac-native location.
 *
 * The same is true of Linux: the game runs under Proton, and the journals are
 * inside the Steam compatibility prefix.
 *
 * That is why this is a LIST of candidates per platform rather than one path.
 * And why the manual override exists: Wine prefixes and Steam libraries end up
 * in places no list can predict, and a member who knows where their journal is
 * should be able to say so rather than be told their setup is unsupported.
 */

export type Platform = 'win32' | 'darwin' | 'linux';

export interface PathContext {
  readonly platform: Platform;
  readonly home: string;
  /** %USERPROFILE% on Windows, when it differs from the home directory. */
  readonly userProfile?: string | undefined;
}

/** The folder name Frontier uses, identical inside every Wine prefix. */
const SAVED = 'Saved Games/Frontier Developments/Elite Dangerous';

/**
 * Candidate journal directories, most likely first.
 *
 * Ordering matters: the caller takes the first that exists, and a member with
 * both a Steam and an Epic install should get the one they actually play.
 */
export function journalPathCandidates(ctx: PathContext): string[] {
  const home = ctx.home.replace(/[\\/]+$/, '');

  switch (ctx.platform) {
    case 'win32': {
      const profile = (ctx.userProfile ?? home).replace(/[\\/]+$/, '');
      return [
        // The normal case, and where the overwhelming majority of members are.
        `${profile}/${SAVED}`,
        // OneDrive silently redirects Saved Games for some Windows setups, and
        // the member has no idea it happened — they just see an app that
        // cannot find their journals.
        `${profile}/OneDrive/${SAVED}`,
        `${profile}/OneDrive/Documents/${SAVED}`,
      ];
    }

    case 'linux': {
      // Proton. 359320 is Elite's Steam app id; the prefix layout is Valve's
      // and has been stable for years.
      const steamUser = 'pfx/drive_c/users/steamuser';
      return [
        `${home}/.steam/steam/steamapps/compatdata/359320/${steamUser}/${SAVED}`,
        `${home}/.local/share/Steam/steamapps/compatdata/359320/${steamUser}/${SAVED}`,
        // A second Steam library on another drive is extremely common once
        // somebody has more than one SSD.
        `${home}/.var/app/com.valvesoftware.Steam/.steam/steam/steamapps/compatdata/359320/${steamUser}/${SAVED}`,
        // Plain Wine, for anyone not using Steam at all.
        `${home}/.wine/drive_c/users/${'${USER}'}/${SAVED}`,
      ];
    }

    case 'darwin': {
      /*
       * There is no native Mac client, so every one of these is a Wine bottle.
       * CrossOver and Whisky are what Mac players actually use.
       *
       * The bottle NAME is chosen by the member, so these cover the defaults
       * only — which is precisely why the manual override is not optional on
       * this platform.
       */
      const cx = `${home}/Library/Application Support/CrossOver/Bottles`;
      const whisky = `${home}/Library/Application Support/com.isaacmarovitz.Whisky/Bottles`;
      return [
        `${cx}/Steam/drive_c/users/crossover/${SAVED}`,
        `${cx}/Elite Dangerous/drive_c/users/crossover/${SAVED}`,
        `${whisky}/Steam/drive_c/users/crossover/${SAVED}`,
        `${home}/Library/Application Support/Elite Dangerous/${SAVED}`,
      ];
    }
  }
}

/**
 * Advice to show when nothing is found.
 *
 * Platform-specific, because "we could not find your journals" with no next
 * step is the point at which somebody uninstalls. On macOS especially the
 * honest answer includes "the game has no Mac version" — a member who does not
 * know that will assume our app is broken rather than that their setup is
 * unusual.
 */
export function noJournalsAdvice(platform: Platform): string {
  switch (platform) {
    case 'win32':
      return 'Start Elite Dangerous once and quit, then try again. If you use OneDrive, your Saved Games folder may have been moved into it — you can point the app at the folder yourself.';
    case 'linux':
      return 'Elite runs under Proton on Linux, so the journals live inside the Steam compatibility folder. If you use a second Steam library or plain Wine, point the app at the folder yourself.';
    case 'darwin':
      return 'Elite Dangerous has no macOS version, so the journals live inside whichever Wine bottle you run it in (CrossOver or Whisky). Open the bottle, find "Saved Games/Frontier Developments/Elite Dangerous", and point the app at it.';
  }
}

/** Journal files are `Journal.<timestamp>.<part>.log`. Nothing else is read. */
export const JOURNAL_FILE_PATTERN = /^Journal\.[0-9T-]+\.[0-9]+\.log$/;

export function isJournalFile(name: string): boolean {
  return JOURNAL_FILE_PATTERN.test(name);
}
