import { describe, it, expect } from 'vitest';
import {
  defaultLayout,
  normaliseLayout,
  ontoScreen,
  activeOverlays,
  withEditMode,
  OVERLAY_IDS,
  OVERLAY_FIELDS,
  OVERLAY_BAR_TITLES,
  OVERLAY_LABELS,
  overlayHeading,
  type OverlayLayout,
} from './overlay-config.js';

/**
 * The saved arrangement of the overlays.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "make nice professional editable and lockable overlays for our modules etc" — with opacity,
 * scale, accent colour and field selection editable per overlay.
 *
 * Every failure this suite guards has the same shape: a panel the member can no longer see or no
 * longer reach, whose only recovery is finding a JSON file in their profile. An overlay is drawn
 * over a game they are playing; if it goes wrong they cannot debug it, they can only uninstall.
 */

describe('defaults', () => {
  it('MANDATORY: every overlay starts OFF', () => {
    // An overlay that appears over somebody's game because they installed an update is the kind of
    // surprise that gets an app uninstalled.
    const layout = defaultLayout();
    for (const id of OVERLAY_IDS) expect(layout[id].enabled).toBe(false);
    expect(activeOverlays(layout)).toEqual([]);
  });

  it('MANDATORY: every overlay starts LOCKED', () => {
    // The first thing that happens after switching one on must not be knocking it out of place with
    // a stray click.
    const layout = defaultLayout();
    for (const id of OVERLAY_IDS) expect(layout[id].locked).toBe(true);
  });

  it('staggers them so four at once are not one unreachable stack', () => {
    const layout = defaultLayout();
    const ys = OVERLAY_IDS.map((id) => layout[id].placement.y);
    expect(new Set(ys).size).toBe(OVERLAY_IDS.length);
  });
});

describe('loading whatever was on disk', () => {
  it('MANDATORY: clamps an opacity that would make a panel invisible', () => {
    /*
     * Zero opacity is a panel that cannot be seen and therefore cannot be found to fix. The member's
     * only recovery would be deleting a config file they do not know exists.
     */
    const layout = normaliseLayout({ build: { style: { opacity: 0 } } });
    expect(layout.build.style.opacity).toBe(0.2);

    expect(normaliseLayout({ build: { style: { opacity: 9 } } }).build.style.opacity).toBe(1);
  });

  it('MANDATORY: clamps a scale that would swallow the screen', () => {
    // A scale of 40 is a panel with no visible edge to grab.
    expect(normaliseLayout({ build: { style: { scale: 40 } } }).build.style.scale).toBe(2);
    expect(normaliseLayout({ build: { style: { scale: 0 } } }).build.style.scale).toBe(0.7);
  });

  it('MANDATORY: refuses an accent that is not a plain hex colour', () => {
    /*
     * This value is interpolated into CSS. Anything that is not six hex digits is refused rather
     * than sanitised, because a half-valid colour is a rendering bug and a creative one is an
     * injection.
     */
    for (const bad of ['red', 'javascript:alert(1)', '#fff', '#12345g', 42, null]) {
      expect(normaliseLayout({ build: { style: { accent: bad } } }).build.style.accent).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
    }
  });

  it('keeps a field list the member chose, in their order', () => {
    const layout = normaliseLayout({ build: { style: { fields: ['progress', 'title'] } } });

    /*
     * The member's own order, first and unchanged. `allProjects` trails it because this fixture
     * carries no `offered` key — so it is read as a config predating the field, and a field that
     * could not have been declined arrives on. That is the mechanism working; see the test below.
     */
    expect(layout.build.style.fields).toEqual(['progress', 'title', 'allProjects']);
  });

  it('MANDATORY: drops fields this version no longer knows', () => {
    /*
     * A field removed in a later release would otherwise sit in the saved list for ever, and the
     * renderer would be asked to draw something that does not exist.
     */
    const layout = normaliseLayout({ build: { style: { fields: ['title', 'wormholes'] } } });

    // 'wormholes' is gone. 'allProjects' is appended for the reason given above.
    expect(layout.build.style.fields).toEqual(['title', 'allProjects']);
    expect(layout.build.style.fields).not.toContain('wormholes');
  });

  it('★ MANDATORY: an unknown-only list falls back to the WHOLE panel, not to the new field ★', () => {
    /*
     * ★ CAUGHT BY THIS SUITE WHEN 'allProjects' LANDED — 2026-08-23 ★
     *
     * The fallback tested `fields.length`, which equals `chosen.length` right up until a release
     * adds a field. Then a config whose every saved field is unknown has nothing chosen but one
     * field added, so the member got a panel showing ONLY the newest line — having chosen nothing
     * of the sort, and with no way to tell it from a broken panel.
     *
     * The guard now asks about `chosen`, which is the member's own surviving choice and the only
     * thing this fallback was ever about.
     */
    const layout = normaliseLayout({ build: { style: { fields: ['nonsense', 'wormholes'] } } });

    expect(layout.build.style.fields).toEqual([...OVERLAY_FIELDS.build]);
  });

  it('falls back to every field rather than showing an empty panel', () => {
    // A panel drawing nothing reads as broken, and the member cannot tell it from a crash.
    const layout = normaliseLayout({ build: { style: { fields: ['nonsense'] } } });
    expect(layout.build.style.fields).toEqual([...OVERLAY_FIELDS.build]);
  });

  it('MANDATORY: a missing `locked` locks, rather than leaving it loose', () => {
    // An overlay that arrives unlocked because a value was absent is one a stray click drags away.
    expect(normaliseLayout({ build: {} }).build.locked).toBe(true);
    expect(normaliseLayout({ build: { locked: false } }).build.locked).toBe(false);
  });

  it('survives complete rubbish', () => {
    // Hand-edited, half-written by a crash, or from a version with a different shape.
    for (const junk of [null, undefined, 'nope', 42, [], { build: 'not an object' }]) {
      const layout = normaliseLayout(junk);
      expect(Object.keys(layout).sort()).toEqual([...OVERLAY_IDS].sort());
    }
  });
});

describe('a screen that no longer exists', () => {
  const LAPTOP = { x: 0, y: 0, width: 1920, height: 1080 };
  const SECOND = { x: 1920, y: 0, width: 1920, height: 1080 };

  it('MANDATORY: rescues a panel positioned on an unplugged monitor', () => {
    /*
     * Position an overlay on the second screen, then play on the laptop somewhere else. The saved x
     * is 2,400 and no screen reaches it, so the window opens where nothing is drawn: invisible,
     * unreachable, unrecoverable except by finding a JSON file.
     */
    const stranded = { x: 2400, y: 200, width: 320, height: 140 };

    const rescued = ontoScreen(stranded, [LAPTOP]);

    expect(rescued.x).toBeGreaterThanOrEqual(LAPTOP.x);
    expect(rescued.x + rescued.width).toBeLessThanOrEqual(LAPTOP.x + LAPTOP.width);
    expect(rescued.y + rescued.height).toBeLessThanOrEqual(LAPTOP.y + LAPTOP.height);
  });

  it('leaves a panel alone when its screen is still there', () => {
    // Rescuing something that is not lost would move the member's careful arrangement every launch.
    const placed = { x: 2000, y: 300, width: 320, height: 140 };
    expect(ontoScreen(placed, [LAPTOP, SECOND])).toEqual(placed);
  });

  it('MANDATORY: a barely-visible sliver still counts as lost', () => {
    /*
     * A panel one pixel on screen passes a naive "does it overlap" check and is still impossible to
     * grab. The rule is that enough must be reachable to drag, not that some of it is technically
     * on a display.
     */
    const sliver = { x: 1919, y: 100, width: 320, height: 140 };

    const rescued = ontoScreen(sliver, [LAPTOP]);

    expect(rescued.x + rescued.width).toBeLessThanOrEqual(LAPTOP.width);
    expect(rescued).not.toEqual(sliver);
  });

  it('comes back to the screen it was mostly on, not to the primary', () => {
    // A panel that has drifted a little should return to where the member put it.
    const drifted = { x: 2300, y: 100, width: 320, height: 140 };
    expect(ontoScreen(drifted, [LAPTOP, SECOND])).toEqual(drifted);
  });

  it('shrinks a panel bigger than the only screen left', () => {
    const huge = { x: 0, y: 0, width: 3000, height: 2000 };
    const tiny = { x: 0, y: 0, width: 800, height: 600 };

    const fitted = ontoScreen(huge, [tiny]);

    expect(fitted.width).toBeLessThanOrEqual(tiny.width);
    expect(fitted.height).toBeLessThanOrEqual(tiny.height);
  });

  it('does nothing when there are no screens to speak of', () => {
    // Between display changes Electron can briefly report none. Moving a window to 0,0 because of a
    // transient is worse than leaving it.
    const placed = { x: 100, y: 100, width: 320, height: 140 };
    expect(ontoScreen(placed, [])).toEqual(placed);
  });
});

describe('arrange mode', () => {
  it('MANDATORY: unlocks every overlay at once', () => {
    /*
     * A locked overlay is click-through, so it cannot be clicked to unlock itself — the click goes
     * to the game. Without one mode that takes the mouse for all of them, moving a panel means
     * alt-tabbing to the app for every nudge.
     */
    const arranged = withEditMode(defaultLayout(), true);
    for (const id of OVERLAY_IDS) expect(arranged[id].locked).toBe(false);
  });

  it('locks them all again on the way out', () => {
    const layout: OverlayLayout = withEditMode(defaultLayout(), true);
    const done = withEditMode(layout, false);
    for (const id of OVERLAY_IDS) expect(done[id].locked).toBe(true);
  });

  it('does not disturb placement or style', () => {
    // Arranging is about who gets the mouse. It must not quietly renormalise everything else.
    const before = normaliseLayout({ build: { style: { opacity: 0.5, scale: 1.4 } } });
    const after = withEditMode(before, true);
    expect(after.build.style).toEqual(before.build.style);
    expect(after.build.placement).toEqual(before.build.placement);
  });
});

/**
 * A field that did not exist when the member last saved.
 *
 * ★ THE BUG THIS PREVENTS — 2026-08-06 ★
 *
 * Saved fields are INTERSECTED with what this version knows, which is right for a field we have
 * REMOVED: it stops the renderer being asked to draw something gone. But it is wrong in the other
 * direction, and silently so.
 *
 * A member who has ever opened the overlay settings has a saved field list. Add a new field to an
 * overlay and the intersection drops it — their saved list cannot contain a field that did not
 * exist yet. The new line ships, is switched on by default for nobody, and appears for no one who
 * has used the app before. Every test passes and the feature is invisible.
 *
 * So: the member's choices are kept, and any field they could never have chosen is added. "Not in
 * my saved list" means "I turned it off" only for fields that were on offer at the time.
 */
describe('a field added in a later release', () => {
  it('MANDATORY: appears for a member whose saved config predates it', () => {
    const saved = {
      cargo: {
        enabled: true,
        locked: true,
        destination: 'auto',
        placement: { x: 24, y: 24, width: 320, height: 140 },
        style: {
          opacity: 0.9,
          scale: 1,
          accent: '#3fd0d4',
          // What the cargo overlay offered before the value fields existed.
          fields: ['items', 'capacity'],
          offered: ['items', 'capacity', 'matched'],
        },
      },
    };

    const out = normaliseLayout(saved);

    // Deliberately switched off, and stays off.
    expect(out.cargo.style.fields, 'a field the member turned off came back').not.toContain(
      'matched',
    );
    // Could never have been switched off, so it arrives on.
    for (const field of OVERLAY_FIELDS.cargo) {
      if (saved.cargo.style.offered.includes(field)) continue;
      expect(
        out.cargo.style.fields,
        `${field} is new and did not reach a member with an older config`,
      ).toContain(field);
    }
  });

  it('MANDATORY: a config with no record of what was offered still gets new fields', () => {
    /*
     * Every config written before this change has no `offered` list at all. Those members must not
     * be the ones the feature stays invisible for — which would be everybody using the app today.
     */
    const saved = {
      cargo: {
        enabled: true,
        locked: true,
        destination: 'auto',
        placement: { x: 24, y: 24, width: 320, height: 140 },
        style: { opacity: 0.9, scale: 1, accent: '#3fd0d4', fields: ['items'] },
      },
    };

    const out = normaliseLayout(saved);

    expect(out.cargo.style.fields).toContain('items');
    expect(
      out.cargo.style.fields.length,
      'an older config received none of the fields added since',
    ).toBeGreaterThan(1);
  });

  it('MANDATORY: a removed field is still dropped', () => {
    // The behaviour the intersection was written for, which must survive the change above.
    const saved = {
      cargo: {
        enabled: true,
        locked: true,
        destination: 'auto',
        placement: { x: 24, y: 24, width: 320, height: 140 },
        style: {
          opacity: 0.9,
          scale: 1,
          accent: '#3fd0d4',
          fields: ['items', 'somethingWeDeleted'],
          offered: ['items', 'somethingWeDeleted'],
        },
      },
    };

    expect(normaliseLayout(saved).cargo.style.fields).not.toContain('somethingWeDeleted');
  });

  it('MANDATORY: what was on offer is recorded, so the next release can tell', () => {
    // Without this written back, every future field addition faces the same problem again.
    const out = normaliseLayout({});

    expect(out.cargo.style.offered, 'nothing recorded what this version offered').toEqual([
      ...OVERLAY_FIELDS.cargo,
    ]);
  });
});

/**
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "in the build tracker overlay in the companion app, can we move the project name out of the build
 * tracker overlay and onto the overlay title bar so it would look like Build Tracker - Project Name?"
 *
 * ★ WHY THE STRING IS BUILT HERE AND NOT IN THE RENDERER ★
 *
 * `overlay.tsx` mounts itself on import, so nothing can import it to ask what a bar would say. The
 * decision — which is a real one, with a field toggle and three ways of having no project — belongs
 * somewhere a test can reach, and the renderer is left drawing whatever it is handed.
 */
describe('what the overlay title bar says', () => {
  const ON = ['title', 'needs', 'progress', 'haulers'];

  it('★ MANDATORY: the build tracker names the project it is tracking ★', () => {
    expect(overlayHeading('build', 'Parazynski Prospect', ON)).toBe(
      'Build tracker - Parazynski Prospect',
    );
  });

  it('★ MANDATORY: turning the Project name field off still turns it off ★', () => {
    /*
     * The field did not disappear, it moved. A member who unticked "Project name" did so to keep it
     * off their screen, and honouring that in the old place and ignoring it in the new one would be
     * a setting that silently stopped working.
     */
    expect(overlayHeading('build', 'Parazynski Prospect', ['needs', 'progress'])).toBe(
      'Build tracker',
    );
  });

  it('★ MANDATORY: no build, no dash left hanging ★', () => {
    // The overlay is open and waiting long before anything is being tracked. "Build tracker - "
    // with nothing after it reads as a panel that has lost something.
    expect(overlayHeading('build', null, ON)).toBe('Build tracker');
    expect(overlayHeading('build', '', ON)).toBe('Build tracker');
    expect(overlayHeading('build', '   ', ON)).toBe('Build tracker');
  });

  it('trims a name that arrived with whitespace around it', () => {
    expect(overlayHeading('build', '  Mitra Horizons  ', ON)).toBe('Build tracker - Mitra Horizons');
  });

  it('MANDATORY: every other overlay is untouched, and never takes a project name', () => {
    /*
     * Only the build tracker follows a project. Passing one to the cargo hold would be a caller's
     * mistake, and the bar answering with it would put a colonisation project on a panel about the
     * hold of a ship.
     */
    for (const id of OVERLAY_IDS) {
      if (id === 'build') continue;
      expect(overlayHeading(id, 'Parazynski Prospect', ON), id).toBe(OVERLAY_BAR_TITLES[id]);
    }
  });

  it('MANDATORY: the bar titles are the short ones, not the settings labels', () => {
    /*
     * Two maps, deliberately. The settings list has room for "Cargo hold" and "Upload status"; a
     * 9px bar over a game does not, and reads "Cargo" and "Uplink". Somebody tidying one into the
     * other would silently rewrite what is drawn over the game.
     */
    expect(OVERLAY_BAR_TITLES.cargo).toBe('Cargo');
    expect(OVERLAY_LABELS.cargo).toBe('Cargo hold');
    expect(OVERLAY_BAR_TITLES.status).toBe('Uplink');
    expect(OVERLAY_LABELS.status).toBe('Upload status');
  });

  it('MANDATORY: every overlay has a bar title, so none draws an empty bar', () => {
    for (const id of OVERLAY_IDS) {
      expect(OVERLAY_BAR_TITLES[id], id).toBeTruthy();
    }
  });
});
