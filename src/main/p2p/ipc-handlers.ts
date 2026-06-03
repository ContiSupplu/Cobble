/**
 * P2P IPC Handlers — Registers all IPC channels for P2P multiplayer.
 *
 * These handlers bridge the renderer process (UI) with the main process
 * (signaling client, TCP proxy, LAN detection, session management).
 */

import { ipcMain, BrowserWindow } from 'electron'
import * as signalingClient from './signaling-client'
import * as session from './session'
import * as tcpProxy from './tcp-proxy'
import * as lanDetect from './lan-detect'
import { getICEServers } from './turn-credentials'
import { requestOpenLAN, requestCloseLAN, setP2PLanOpenedHandler, setP2PRequestInviteHandler } from '../dynamic-island-server'

/**
 * Register all P2P IPC handlers.
 * Call this once during app initialization.
 */
export function registerP2PHandlers(): void {
  console.log('[P2P] Registering IPC handlers')

  // ── Session management ──────────────────────────────────────────────

  ipcMain.handle('p2p:createRoom', async (_e, username: string, worldName?: string, gameVersion?: string) => {
    try {
      const s = await signalingClient.createRoom(username, worldName, gameVersion)
      // Tell the mod to open LAN
      requestOpenLAN()
      return { success: true, session: s }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('p2p:joinRoom', async (_e, roomId: string, joinToken: string, username: string) => {
    try {
      const s = await signalingClient.joinRoom(roomId, joinToken, username)
      return { success: true, session: s }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('p2p:joinFromUrl', async (_e, url: string, username: string) => {
    const parsed = session.parseInviteUrl(url)
    if (!parsed) {
      return { success: false, error: 'Invalid invite URL' }
    }
    try {
      const s = await signalingClient.joinRoom(parsed.roomId, parsed.joinToken, username)
      return { success: true, session: s }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('p2p:closeRoom', () => {
    signalingClient.closeRoom()
    tcpProxy.stopAllProxies()
    lanDetect.stopLANDetection()
    requestCloseLAN()
    return { success: true }
  })

  ipcMain.handle('p2p:getSession', () => {
    return session.getSession()
  })

  // ── WebRTC signal relay ─────────────────────────────────────────────

  ipcMain.handle('p2p:relaySignal', (_e, data: any) => {
    signalingClient.relaySignal(data)
  })

  // ── TCP Proxy (tunnel data from renderer ↔ MC) ─────────────────────

  ipcMain.handle('p2p:startHostProxy', (_e, mcPort: number) => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      tcpProxy.startHostProxy(mcPort, {
        onData: (data) => {
          // Forward MC data → renderer → DataChannel
          BrowserWindow.getAllWindows().forEach((w) => {
            w.webContents.send('p2p:tunnelData', Array.from(data))
          })
        },
        onReady: (port) => {
          session.setLANPort(port)
          resolve({ success: true })
        },
        onError: (error) => {
          resolve({ success: false, error })
        },
        onConnected: () => {
          session.setConnected()
          BrowserWindow.getAllWindows().forEach((w) => {
            w.webContents.send('p2p:sessionUpdate', session.getSession())
          })
        },
        onClose: () => {
          console.log('[P2P] Host proxy connection closed')
        },
      })
    })
  })

  ipcMain.handle('p2p:startJoinProxy', () => {
    return new Promise<{ success: boolean; port?: number; error?: string }>((resolve) => {
      tcpProxy.startJoinProxy({
        onData: (data) => {
          // Forward MC data → renderer → DataChannel
          BrowserWindow.getAllWindows().forEach((w) => {
            w.webContents.send('p2p:tunnelData', Array.from(data))
          })
        },
        onReady: (port) => {
          session.setProxyPort(port)
          resolve({ success: true, port })
        },
        onError: (error) => {
          resolve({ success: false, error })
        },
        onConnected: () => {
          session.setConnected()
          BrowserWindow.getAllWindows().forEach((w) => {
            w.webContents.send('p2p:sessionUpdate', session.getSession())
          })
        },
        onClose: () => {
          console.log('[P2P] Join proxy connection closed')
        },
      })
    })
  })

  // Renderer sends DataChannel data → main feeds it to the TCP proxy
  ipcMain.handle('p2p:feedTunnelData', (_e, data: number[]) => {
    const buf = Buffer.from(data)
    const s = session.getSession()
    if (s?.role === 'host') {
      tcpProxy.feedHostData(buf)
    } else {
      tcpProxy.feedJoinData(buf)
    }
  })

  // ── LAN detection ──────────────────────────────────────────────────

  ipcMain.handle('p2p:startLanDetection', () => {
    lanDetect.startLANDetection()
    return { success: true }
  })

  ipcMain.handle('p2p:stopLanDetection', () => {
    lanDetect.stopLANDetection()
    return { success: true }
  })

  // ── ICE servers (STUN + TURN credentials) ─────────────────────────

  ipcMain.handle('p2p:getICEServers', () => {
    return getICEServers()
  })

  // ── Wire up Dynamic Island server events ───────────────────────────

  // When the mod confirms LAN is open, update session and start host proxy
  setP2PLanOpenedHandler((port) => {
    session.setLANPort(port)
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send('p2p:sessionUpdate', session.getSession())
    })
  })

  // When the player presses "Play with Friends" in-game
  setP2PRequestInviteHandler(() => {
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send('p2p:requestInvite')
    })
  })

  console.log('[P2P] IPC handlers registered')
}
