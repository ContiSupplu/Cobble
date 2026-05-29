import { WebSocketServer, WebSocket } from 'ws'

const PORT = 47521
let wss: WebSocketServer | null = null
let broadcastInterval: ReturnType<typeof setInterval> | null = null
let stateProvider: (() => DynamicIslandState) | null = null

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

export function setStateProvider(provider: () => DynamicIslandState): void {
  stateProvider = provider
}

export function setLoomieHandler(handler: (text: string, reply: (answer: string) => void) => void): void {
  onLoomieQuestion = handler
}

export function setSpotifyCommandHandler(handler: (command: string) => void): void {
  onSpotifyCommand = handler
}

export function startDynamicIslandServer(): void {
  if (wss) return // Already running

  try {
    wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' })
    console.log(`[DynamicIsland] WebSocket server started on ws://127.0.0.1:${PORT}`)

    wss.on('connection', (ws) => {
      console.log('[DynamicIsland] Mod connected')

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
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
            // Player pressed F7 — show ping/TPS as a notification
            const ping = msg.ping ?? '?'
            const tps = msg.tps != null ? Number(msg.tps).toFixed(1) : '?'
            const notifText = `📡 Ping: ${ping}ms  |  TPS: ${tps}`
            // Send notification back to the mod for display
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'notification', text: notifText }))
            }
            console.log(`[DynamicIsland] Network stats: ping=${ping}ms, tps=${tps}`)
          }
        } catch { /* ignore malformed messages */ }
      })

      ws.on('close', () => {
        console.log('[DynamicIsland] Mod disconnected')
      })

      // Send initial state immediately
      if (stateProvider) {
        ws.send(JSON.stringify(stateProvider()))
      }
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
        if (client.readyState === WebSocket.OPEN) {
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

export function isServerRunning(): boolean {
  return wss !== null
}
