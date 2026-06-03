import { WebSocketServer, WebSocket } from 'ws'
import { randomBytes } from 'crypto'
import { BrowserWindow } from 'electron'

const PORT = 47521
let wss: WebSocketServer | null = null
let broadcastInterval: ReturnType<typeof setInterval> | null = null
let stateProvider: (() => DynamicIslandState) | null = null
let sessionToken = ''

/** Get the current WebSocket session token for passing to JVM args */
export function getSessionToken(): string { return sessionToken }

export interface DynamicIslandState {
  type: 'state'
  spotify: {
    playing: boolean
    title: string
    artist: string
    progress: number    // 0-1
    duration: number    // ms
    albumArt: string | null  // URL
  } | null
  time: string
  notification: string | null
  twitch: {
    connected: boolean
    channel: string | null
    viewerCount: number | null
  } | null
}

export interface LoomieQuestion {
  type: 'loomie_question'
  text: string
}

export interface LoomieAnswer {
  type: 'loomie_answer'
  text: string
}

// Message handler for incoming messages from the mod
let onLoomieQuestion: ((text: string, reply: (answer: string) => void) => void) | null = null
let onSpotifyCommand: ((command: string) => void) | null = null
let onTwitchChatFromMod: ((message: string) => void) | null = null
let onMediaSearch: ((query: string, source: string, reply: (results: any[]) => void) => void) | null = null
let onMediaSelect: ((result: any) => void) | null = null

// P2P event handlers
let onP2PLanOpened: ((port: number) => void) | null = null
let onP2PRequestInvite: (() => void) | null = null
let onP2PPlayerJoined: ((username: string) => void) | null = null
let onP2PPlayerLeft: ((username: string) => void) | null = null
let onBrowserVideoSelected: ((source: string, id: string, url: string) => void) | null = null

export function setStateProvider(provider: () => DynamicIslandState): void {
  stateProvider = provider
}

export function setLoomieHandler(handler: (text: string, reply: (answer: string) => void) => void): void {
  onLoomieQuestion = handler
}

export function setSpotifyCommandHandler(handler: (command: string) => void): void {
  onSpotifyCommand = handler
}

export function setTwitchChatHandler(handler: (message: string) => void): void {
  onTwitchChatFromMod = handler
}

export function setMediaSearchHandler(handler: (query: string, source: string, reply: (results: any[]) => void) => void): void {
  onMediaSearch = handler
}

export function setMediaSelectHandler(handler: (result: any) => void): void {
  onMediaSelect = handler
}

export function setBrowserVideoHandler(handler: (source: string, id: string, url: string) => void): void {
  onBrowserVideoSelected = handler
}

export function setP2PLanOpenedHandler(handler: (port: number) => void): void {
  onP2PLanOpened = handler
}

export function setP2PRequestInviteHandler(handler: () => void): void {
  onP2PRequestInvite = handler
}

export function setP2PPlayerJoinedHandler(handler: (username: string) => void): void {
  onP2PPlayerJoined = handler
}

export function setP2PPlayerLeftHandler(handler: (username: string) => void): void {
  onP2PPlayerLeft = handler
}

export function startDynamicIslandServer(): void {
  if (wss) return // Already running

  try {
    // Generate a fresh session token for this server instance
    sessionToken = randomBytes(32).toString('hex')
    console.log('[DynamicIsland] WebSocket session token generated')

    wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' })
    console.log(`[DynamicIsland] WebSocket server started on ws://127.0.0.1:${PORT}`)

    wss.on('connection', (ws) => {
      console.log('[DynamicIsland] Mod connected (awaiting authentication)')
      ;(ws as any).__authenticated = false

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString())

          // Require authentication on first message
          if (!(ws as any).__authenticated) {
            if (msg.type === 'auth' && msg.token === sessionToken) {
              ;(ws as any).__authenticated = true
              console.log('[DynamicIsland] Client authenticated')
              // Send initial state after successful auth
              if (stateProvider) {
                ws.send(JSON.stringify(stateProvider()))
              }
              return
            } else {
              const got = typeof msg.token === 'string' ? msg.token.substring(0, 8) : 'none'
              const expected = sessionToken.substring(0, 8)
              console.warn(`[DynamicIsland] Auth failed — got token prefix "${got}..." expected "${expected}..." (type: ${msg.type})`)
              ws.close(4001, 'Authentication required')
              return
            }
          }

          // --- Authenticated message handling ---
          if (msg.type === 'loomie_question' && onLoomieQuestion) {
            onLoomieQuestion(msg.text, (answer: string) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'loomie_answer', text: answer }))
              }
            })
          } else if (msg.type === 'spotify_toggle' || msg.type === 'spotify_next' || msg.type === 'spotify_previous' || msg.type === 'spotify_duck' || msg.type === 'spotify_unduck') {
            if (onSpotifyCommand) {
              onSpotifyCommand(msg.type)
            }
          } else if (msg.type === 'network_stats') {
            const ping = msg.ping ?? '?'
            const tps = msg.tps != null ? Number(msg.tps).toFixed(1) : '?'
            const notifText = `\u{1F4E1} Ping: ${ping}ms  |  TPS: ${tps}`
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'notification', text: notifText }))
            }
            console.log(`[DynamicIsland] Network stats: ping=${ping}ms, tps=${tps}`)
          } else if (msg.type === 'twitch_send_chat' && onTwitchChatFromMod) {
            onTwitchChatFromMod(msg.message)
          } else if (msg.type === 'media_search' && onMediaSearch) {
            // Mod is searching for content
            console.log(`[DynamicIsland] Search request: query="${msg.query}" source="${msg.source || 'all'}"`)
            onMediaSearch(msg.query, msg.source || 'all', (results) => {
              console.log(`[DynamicIsland] Sending ${results.length} search results to mod`)
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'media_search_results', results }))
              }
            })
          } else if (msg.type === 'media_select' && onMediaSelect) {
            // Mod selected a search result to play
            onMediaSelect(msg.result)
          } else if (msg.type === 'browser_video_selected') {
            // In-game MCEF browser detected a video/stream selection
            console.log(`[DynamicIsland] Browser video selected: ${msg.source} - ${msg.id}`)
            if (onBrowserVideoSelected) {
              onBrowserVideoSelected(msg.source, msg.id, msg.url || '')
            }
          } else if (msg.type === 'p2p_lan_opened') {
            // Mod confirmed LAN world is open
            const port = typeof msg.port === 'number' ? msg.port : parseInt(msg.port)
            console.log(`[DynamicIsland] P2P LAN opened on port ${port}`)
            if (onP2PLanOpened) onP2PLanOpened(port)
            // Notify renderer
            BrowserWindow.getAllWindows().forEach((w) => {
              w.webContents.send('p2p:lanOpened', port)
            })
          } else if (msg.type === 'p2p_lan_closed') {
            console.log('[DynamicIsland] P2P LAN closed')
            BrowserWindow.getAllWindows().forEach((w) => {
              w.webContents.send('p2p:lanClosed')
            })
          } else if (msg.type === 'p2p_request_invite') {
            // Player pressed "Play with Friends" in the ESC menu
            console.log('[DynamicIsland] P2P invite requested from in-game')
            if (onP2PRequestInvite) onP2PRequestInvite()
            BrowserWindow.getAllWindows().forEach((w) => {
              w.webContents.send('p2p:requestInvite')
            })
          } else if (msg.type === 'p2p_player_joined') {
            const username = msg.username || 'Unknown'
            console.log(`[DynamicIsland] P2P player joined: ${username}`)
            if (onP2PPlayerJoined) onP2PPlayerJoined(username)
            BrowserWindow.getAllWindows().forEach((w) => {
              w.webContents.send('p2p:playerJoined', username)
            })
          } else if (msg.type === 'p2p_player_left') {
            const username = msg.username || 'Unknown'
            console.log(`[DynamicIsland] P2P player left: ${username}`)
            if (onP2PPlayerLeft) onP2PPlayerLeft(username)
            BrowserWindow.getAllWindows().forEach((w) => {
              w.webContents.send('p2p:playerLeft', username)
            })
          } else if (msg.type === 'p2p_error') {
            console.error(`[DynamicIsland] P2P error from mod: ${msg.message}`)
            BrowserWindow.getAllWindows().forEach((w) => {
              w.webContents.send('p2p:error', msg.message)
            })
          }
        } catch { /* ignore malformed messages */ }
      })

      ws.on('close', () => {
        console.log('[DynamicIsland] Mod disconnected')
      })
    })

    wss.on('error', (err) => {
      console.error('[DynamicIsland] Server error:', err.message)
    })

    // Broadcast state every 1 second
    broadcastInterval = setInterval(() => {
      if (!wss || !stateProvider) return
      const state = stateProvider()
      const json = JSON.stringify(state)
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && (client as any).__authenticated) {
          client.send(json)
        }
      })
    }, 1000)
  } catch (err: any) {
    console.error('[DynamicIsland] Failed to start server:', err.message)
  }
}

export function stopDynamicIslandServer(): void {
  if (broadcastInterval) {
    clearInterval(broadcastInterval)
    broadcastInterval = null
  }
  if (wss) {
    wss.clients.forEach((client) => client.close())
    wss.close()
    wss = null
    console.log('[DynamicIsland] WebSocket server stopped')
  }
}

export function sendNotification(text: string): void {
  if (!wss) return
  const json = JSON.stringify({ type: 'notification', text })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json)
    }
  })
}

/** Send a Twitch chat message to the mod for in-game display */
export function sendTwitchChat(data: { username: string; message: string; color: string; badges: string[] }): void {
  if (!wss) return
  const json = JSON.stringify({ type: 'twitch_chat', ...data })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json)
    }
  })
}

/** Tell the mod to start playing media (Twitch stream or YouTube video) */
export function sendMediaPlay(url: string, source: 'twitch' | 'youtube', title: string): void {
  if (!wss) return
  const json = JSON.stringify({ type: 'media_play', url, source, title })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json)
    }
  })
  console.log(`[DynamicIsland] Media play: ${source} - ${title}`)
}

/** Tell the mod to stop media playback */
export function sendMediaStop(): void {
  if (!wss) return
  const json = JSON.stringify({ type: 'media_stop' })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json)
    }
  })
  console.log('[DynamicIsland] Media stop')
}

/** Send a Twitch live notification to the mod */
export function sendTwitchLive(data: { channel: string; game: string; viewers: number }): void {
  if (!wss) return
  const json = JSON.stringify({ type: 'twitch_live', ...data })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json)
    }
  })
}

export function isServerRunning(): boolean {
  return wss !== null
}

// ─── P2P Commands (Launcher → Mod) ─────────────────────────────────────────

/** Tell the mod to open the current singleplayer world to LAN */
export function requestOpenLAN(options?: { gameMode?: string; cheats?: boolean }): void {
  if (!wss) return
  const json = JSON.stringify({ type: 'p2p_open_lan', ...options })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && (client as any).__authenticated) {
      client.send(json)
    }
  })
  console.log('[DynamicIsland] P2P: requested Open to LAN')
}

/** Tell the mod to close the LAN session */
export function requestCloseLAN(): void {
  if (!wss) return
  const json = JSON.stringify({ type: 'p2p_close_lan' })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && (client as any).__authenticated) {
      client.send(json)
    }
  })
  console.log('[DynamicIsland] P2P: requested Close LAN')
}
