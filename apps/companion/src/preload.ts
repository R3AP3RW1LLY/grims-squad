import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between the page and the app.
 *
 * ★ A NAMED LIST, NOT A PASSTHROUGH ★
 *
 * Exposing `ipcRenderer` itself — or a generic `invoke(channel, ...args)` —
 * would hand the renderer every channel the main process will ever register,
 * including ones added later by somebody who did not know this file existed.
 *
 * Each function here is a decision. The renderer can do these things and
 * nothing else, and adding a capability means adding a line, which means
 * somebody has to think about it.
 */

contextBridge.exposeInMainWorld('companion', {
  /** The current state, for a first paint. */
  getState: () => ipcRenderer.invoke('state'),

  /** Pushed whenever the state changes, so the window does not have to poll. */
  onState: (handler: (state: unknown) => void) => {
    // The listener is wrapped rather than passed through: the raw handler
    // receives an IpcRendererEvent whose `sender` is a live handle back into
    // the main process, and the page has no business holding one.
    ipcRenderer.on('state', (_event, state) => handler(state));
  },

  /*
   * Signing in, not pasting a key. The app opens the member's own browser at our approval page and
   * waits — see `device-link.ts`. Takes no argument because there is nothing for the member to
   * supply: that was the whole problem with the flow it replaces.
   */
  signIn: () => ipcRenderer.invoke('signIn'),
  cancelSignIn: () => ipcRenderer.invoke('cancelSignIn'),
  /** Opens the approval page again — the browser may have failed to open, or been closed. */
  reopenLink: () => ipcRenderer.invoke('reopenLink'),
  unpair: () => ipcRenderer.invoke('unpair'),
  setEnabled: (enabled: boolean) => ipcRenderer.invoke('setEnabled', enabled),
  setAutoStart: (autoStart: boolean) => ipcRenderer.invoke('setAutoStart', autoStart),
  openHub: () => ipcRenderer.invoke('openHub'),
  chooseJournalFolder: () => ipcRenderer.invoke('chooseJournalFolder'),
  /** Searches the disk again — the game may have been installed since. */
  rescan: () => ipcRenderer.invoke('rescan'),

  /** Shows what a batch would contain, from the member's own journals. */
  preview: () => ipcRenderer.invoke('preview'),

  /**
   * Asks the hub again what is being collected, ignoring the cache.
   *
   * For the member who has just changed something on the website and come back
   * to check — a five-minute-old answer would look like the change had not
   * taken.
   */
  refreshSettings: () => ipcRenderer.invoke('refreshSettings'),
});

/**
 * The overlay windows' bridge.
 *
 * ★ A SEPARATE, SMALLER SURFACE — AND DELIBERATELY READ-ONLY ★
 *
 * The overlay windows load the same preload as the main window, because Electron takes one preload
 * per window and maintaining two files that must not drift is worse than one with two exports.
 *
 * But an overlay is drawn over a game and has no controls: it receives what to draw and does
 * nothing else. There is no `setEnabled` here, no `unpair`, no `signIn`. If an overlay is ever
 * compromised — by a bug in a panel, or by something rendered from data we did not sanitise — the
 * worst it can do is ask for its own state again.
 *
 * Position and size are NOT sent from here either. The window is dragged by `app-region: drag`,
 * which the operating system handles, and the main process reads the result off the window itself.
 * A renderer that could move its own window could move it off screen.
 */
contextBridge.exposeInMainWorld('overlayBridge', {
  /** Layout, lock state and style for this panel. Pushed whenever the member changes anything. */
  onState: (handler: (payload: unknown) => void) => {
    ipcRenderer.on('overlay:state', (_event, payload: unknown) => handler(payload));
  },
  /** Live data — needs, run, cargo, uplink. Broadcast to every open overlay. */
  onData: (handler: (payload: unknown) => void) => {
    ipcRenderer.on('overlay:data', (_event, payload: unknown) => handler(payload));
  },
  /*
   * Closes a genuine race: a window can finish loading AFTER the main process has already pushed
   * its state, and without this it would sit blank until the member next changed a setting.
   */
  ready: (id: string) => ipcRenderer.send('overlay:ready', id),
});

/*
 * The overlay controls, on the MAIN window's bridge.
 *
 * Here rather than on `overlayBridge` because these are things the settings panel does, not things
 * an overlay does. An overlay that could rearrange itself would be an overlay a rendering bug could
 * move off screen.
 */
contextBridge.exposeInMainWorld('overlays', {
  /** Sends the whole arrangement back after an edit. Validated in the main process. */
  set: (layout: unknown) => ipcRenderer.invoke('setOverlays', layout),
  /** Arrange mode: every panel takes the mouse so it can be dragged. Not persisted. */
  setEditing: (on: boolean) => ipcRenderer.invoke('setOverlayEditing', on),
});

/**
 * Colonisation.
 *
 * ★ THE TOKEN NEVER REACHES THE PAGE ★
 *
 * Every one of these asks the main process to make the call; the credential is attached there. A
 * renderer that could talk to the hub directly would need the device token in the page, where any
 * rendering bug that can read the DOM can read it too.
 */
contextBridge.exposeInMainWorld('trade', {
  routes: (query: unknown) => ipcRenderer.invoke('tradeRoutes', query),
  commodities: (near?: string) => ipcRenderer.invoke('tradeCommodities', near),
});

contextBridge.exposeInMainWorld('bounties', {
  board: () => ipcRenderer.invoke('bountyBoard'),
  leaderboard: (month?: string) => ipcRenderer.invoke('bountyLeaderboard', month),
});

contextBridge.exposeInMainWorld('colony', {
  /** Both boards, plus what this member is allowed to do with them. */
  projects: () => ipcRenderer.invoke('colonyProjects'),
  /** One project in full: needs, haulers, and where to buy the rest, filtered as asked. */
  project: (id: string, filters?: unknown) => ipcRenderer.invoke('colonyProject', id, filters),
  /** The project for a construction site, by market id. Null when nobody has posted it. */
  at: (marketId: string) => ipcRenderer.invoke('colonyAt', marketId),
  post: (body: unknown) => ipcRenderer.invoke('colonyPost', body),

  /** Every kind of construction site, and what one costs near a system you name. */
  buildTypes: () => ipcRenderer.invoke('colonyBuildTypes'),
  buildType: (id: string, near: string) => ipcRenderer.invoke('colonyBuildType', id, near),

  /** Who is on a build, what they have taken on, and what they have delivered. */
  roster: (id: string) => ipcRenderer.invoke('colonyRoster', id),
  join: (id: string) => ipcRenderer.invoke('colonyJoin', id),
  leave: (id: string) => ipcRenderer.invoke('colonyLeave', id),
  /** Claim a commodity, or assign one to somebody else. The hub decides whether you may. */
  assign: (id: string, body: unknown) => ipcRenderer.invoke('colonyAssign', id, body),
  unassign: (id: string, body: unknown) => ipcRenderer.invoke('colonyUnassign', id, body),

  /** Closing, reopening, deleting, and flagging the squadron's current effort. */
  close: (id: string) => ipcRenderer.invoke('colonyClose', id),
  reopen: (id: string) => ipcRenderer.invoke('colonyReopen', id),
  remove: (id: string) => ipcRenderer.invoke('colonyRemove', id),
  priority: (id: string, on: boolean) => ipcRenderer.invoke('colonyPriority', id, on),

  /** Fleet carriers helping with a build, and what each is holding. */
  carriers: (id: string, q: string) => ipcRenderer.invoke('colonyCarriers', id, q),
  carrierAdd: (id: string, body: unknown) => ipcRenderer.invoke('colonyCarrierAdd', id, body),
  carrierRemove: (id: string, marketId: string) =>
    ipcRenderer.invoke('colonyCarrierRemove', id, marketId),

  /**
   * The planner. Squadron owner, 2026-08-03: "ensure the Companion app matches and has all the same
   * pages in colonization that the website has please! must be a mirror!"
   */
  plans: () => ipcRenderer.invoke('colonyPlans'),
  plan: (id: string) => ipcRenderer.invoke('colonyPlan', id),
  planCreate: (body: unknown) => ipcRenderer.invoke('colonyPlanCreate', body),
  /** Slot counts read off the game. Keyed on the system and body, not the plan. */
  planSlots: (systemId64: string, bodyId: number, body: unknown) =>
    ipcRenderer.invoke('colonyPlanSlots', systemId64, bodyId, body),
  planAddSite: (id: string, body: unknown) => ipcRenderer.invoke('colonyPlanAddSite', id, body),
  planRemoveSite: (id: string, siteId: string, version: number) =>
    ipcRenderer.invoke('colonyPlanRemoveSite', id, siteId, version),
  planReorder: (id: string, body: unknown) => ipcRenderer.invoke('colonyPlanReorder', id, body),
  planRemove: (id: string) => ipcRenderer.invoke('colonyPlanRemove', id),
});
