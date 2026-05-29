import { BrowserWindow, ipcMain, screen, app } from 'electron'
import { join } from 'path'

// ============================================================
// Game Overlay — Transparent BrowserWindow over Minecraft
// ============================================================
//
// Creates a transparent, frameless, always-on-top, click-through
// overlay that fills the entire display the game is on. The CSS
// inside the overlay HTML positions the Dynamic Island at top-center.
//
// The overlay is click-through by default. When the user activates
// Loomie interaction, the overlay temporarily becomes interactive
// so it can capture mouse/keyboard input.
// ============================================================

let overlayWindow: BrowserWindow | null = null
let stateInterval: NodeJS.Timeout | null = null
let loomieHandler: ((question: string) => Promise<string>) | null = null
let stateProvider: (() => any) | null = null
let spotifyControlHandler: ((action: string) => void) | null = null
let ipcRegistered = false

// ============================================================
// Public API — State & Loomie
// ============================================================

/**
 * Register a callback that returns the current overlay state
 * (Spotify playback, time, notifications, etc.).
 * Called by the main process at startup.
 */
export function setOverlayStateProvider(fn: () => any): void {
  stateProvider = fn
}

/**
 * Register a handler for Loomie AI questions from the overlay.
 * The handler receives a question string and returns a promise
 * resolving to the answer text.
 */
export function setOverlayLoomieHandler(fn: (question: string) => Promise<string>): void {
  loomieHandler = fn
}

/**
 * Register a handler for Spotify controls from the overlay.
 * The handler receives an action string: 'play', 'pause', 'next', 'previous'.
 */
export function setOverlaySpotifyHandler(fn: (action: string) => void): void {
  spotifyControlHandler = fn
}

/**
 * Push an arbitrary state object to the overlay renderer.
 * Use this for immediate updates (e.g. Spotify track change)
 * outside the regular polling interval.
 */
export function pushOverlayState(state: any): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-state', state)
  }
}

// ============================================================
// Lifecycle
// ============================================================

/**
 * Create the game overlay window.
 * Fills the primary display (or the display nearest the game)
 * with a transparent, click-through window.
 */
export function createGameOverlay(): void {
  if (overlayWindow) return

  // Ensure IPC handlers are registered (idempotent)
  registerOverlayIPC()

  const primaryDisplay = screen.getPrimaryDisplay()
  const { x, y, width, height } = primaryDisplay.bounds

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    type: 'toolbar', // Helps with always-on-top on Windows
    webPreferences: {
      preload: join(app.getAppPath(), 'src', 'overlay', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Click-through by default — mouse events pass to the game
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  // Highest always-on-top level so the overlay stays above fullscreen games
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')

  // Load the overlay HTML page
  overlayWindow.loadFile(join(app.getAppPath(), 'src', 'overlay', 'index.html'))

  // Push state to the overlay every 2 seconds
  stateInterval = setInterval(() => {
    if (overlayWindow && !overlayWindow.isDestroyed() && stateProvider) {
      try {
        const state = stateProvider()
        overlayWindow.webContents.send('overlay-state', state)
      } catch (err) {
        console.error('[GameOverlay] State provider error:', err)
      }
    }
  }, 2000)

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  console.log('[GameOverlay] Overlay window created')
}

/**
 * Destroy the overlay window and clean up all intervals / handlers.
 */
export function destroyGameOverlay(): void {
  if (stateInterval) {
    clearInterval(stateInterval)
    stateInterval = null
  }

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close()
  }
  overlayWindow = null

  console.log('[GameOverlay] Overlay destroyed')
}

/**
 * Returns true if the overlay window currently exists and is not destroyed.
 */
export function isOverlayActive(): boolean {
  return overlayWindow !== null && !overlayWindow.isDestroyed()
}

// ============================================================
// IPC Handlers (registered once)
// ============================================================

/**
 * Register IPC handlers for overlay ↔ main process communication.
 * Safe to call multiple times — handlers are only registered once.
 */
function registerOverlayIPC(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  // ----------------------------------------------------------
  // Loomie AI — overlay asks a question, main process answers
  // ----------------------------------------------------------
  ipcMain.handle('overlay-loomie-ask', async (_event, question: string) => {
    if (!loomieHandler) {
      return { error: 'Loomie handler not registered' }
    }
    try {
      const answer = await loomieHandler(question)
      return { text: answer }
    } catch (err: any) {
      return { error: err.message || 'Loomie error' }
    }
  })

  // ----------------------------------------------------------
  // Interactive toggle — let overlay capture mouse for Loomie
  // ----------------------------------------------------------
  ipcMain.on('overlay-set-interactive', (_event, interactive: boolean) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return

    if (interactive) {
      overlayWindow.setIgnoreMouseEvents(false)
      overlayWindow.setFocusable(true)
      overlayWindow.focus()
    } else {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true })
      overlayWindow.setFocusable(false)
    }
  })

  // ----------------------------------------------------------
  // Spotify controls — call registered handler
  // ----------------------------------------------------------
  ipcMain.on('overlay-spotify-control', async (_event, action: string) => {
    if (spotifyControlHandler) {
      spotifyControlHandler(action)
    }
  })
}
