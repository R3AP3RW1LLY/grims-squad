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
