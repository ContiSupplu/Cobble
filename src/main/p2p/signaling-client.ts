/**
 * P2P Signaling Client — Connects to the signaling server from the main process.
 *
 * Handles room creation/joining and relays WebRTC signaling data (SDP/ICE)
 * between the signaling server and the renderer process.
 */

import WebSocket from 'ws'
import { BrowserWindow } from 'electron'
import {
  createHostSession,
  createJoinSession,
  setSignalingInfo,
  setHostInfo,
  setPeerJoined,
  setStatus,
  endSession,
  getSession,
} from './session'

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const DEFAULT_URL = process.env.LOOM_SIGNALING_URL || 'ws://localhost:8090'

// ─── Connect to signaling server ──────────────────────────────────────────

function connectToSignaling(url: string = DEFAULT_URL): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve()
      return
    }

    try {
      ws = new WebSocket(url)
    } catch (err: any) {
      reject(new Error(`Failed to create WebSocket: ${err.message}`))
      return
    }

    const timeout = setTimeout(() => {
      reject(new Error('Signaling server connection timeout'))
      ws?.close()
      ws = null
    }, 10_000)

    ws.on('open', () => {
      clearTimeout(timeout)
      console.log('[P2P Signaling] Connected to signaling server')
      resolve()
    })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        handleSignalingMessage(msg)
      } catch {
        console.warn('[P2P Signaling] Invalid message received')
      }
    })

    ws.on('close', () => {
      console.log('[P2P Signaling] Disconnected from signaling server')
      ws = null

      // If we had an active session, mark it
      const session = getSession()
      if (session && session.status !== 'disconnected') {
        setStatus('error', 'Lost connection to signaling server')
        broadcastToRenderer('p2p:sessionUpdate', getSession())
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      console.error('[P2P Signaling] Connection error:', err.message)
      if (ws?.readyState !== WebSocket.OPEN) {
        reject(new Error(`Signaling server connection failed: ${err.message}`))
        ws = null
      }
    })
  })
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
}

// ─── Message handling ─────────────────────────────────────────────────────

function handleSignalingMessage(msg: any): void {
  switch (msg.type) {
    case 'room_created':
      // Host receives room tokens
      setSignalingInfo(msg.roomId, msg.hostToken, msg.joinToken)
      broadcastToRenderer('p2p:sessionUpdate', getSession())
      console.log(`[P2P Signaling] Room created: ${msg.roomId}`)
      break

    case 'room_joined':
      // Joiner receives host info
      setHostInfo(msg.hostUsername, msg.worldName, msg.gameVersion)
      setStatus('connecting')
      broadcastToRenderer('p2p:sessionUpdate', getSession())
      broadcastToRenderer('p2p:startWebRTC', { initiator: true })
      console.log(`[P2P Signaling] Joined room — host: ${msg.hostUsername}`)
      break

    case 'peer_joined':
      // Host is notified that a joiner connected
      setPeerJoined(msg.username)
      broadcastToRenderer('p2p:sessionUpdate', getSession())
      broadcastToRenderer('p2p:startWebRTC', { initiator: false })
      console.log(`[P2P Signaling] Peer joined: ${msg.username}`)
      break

    case 'signal':
      // Relay WebRTC signaling data to renderer
      broadcastToRenderer('p2p:signal', msg.data)
      break

    case 'host_disconnected':
      setStatus('error', 'Host disconnected')
      broadcastToRenderer('p2p:sessionUpdate', getSession())
      break

    case 'peer_left':
      setStatus('waiting')
      broadcastToRenderer('p2p:sessionUpdate', getSession())
      broadcastToRenderer('p2p:peerLeft', { username: msg.username })
      break

    case 'room_closed':
      endSession('Room was closed')
      broadcastToRenderer('p2p:sessionUpdate', getSession())
      disconnect()
      break

    case 'error':
      console.error(`[P2P Signaling] Error: ${msg.code} — ${msg.message}`)
      setStatus('error', msg.message)
      broadcastToRenderer('p2p:sessionUpdate', getSession())
      break

    default:
      console.warn(`[P2P Signaling] Unknown message type: ${msg.type}`)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Create a new room as host.
 */
export async function createRoom(username: string, worldName?: string, gameVersion?: string): Promise<any> {
  const session = createHostSession(username, worldName, gameVersion)

  try {
    await connectToSignaling(session.signalingUrl)
  } catch (err: any) {
    setStatus('error', err.message)
    broadcastToRenderer('p2p:sessionUpdate', getSession())
    throw err
  }

  sendToSignaling({
    type: 'create_room',
    username,
    worldName: worldName || 'Singleplayer World',
    gameVersion: gameVersion || '1.21.11',
  })

  return getSession()
}

/**
 * Join an existing room as a joiner.
 */
export async function joinRoom(roomId: string, joinToken: string, username: string): Promise<any> {
  const session = createJoinSession(roomId, joinToken, username)

  try {
    await connectToSignaling(session.signalingUrl)
  } catch (err: any) {
    setStatus('error', err.message)
    broadcastToRenderer('p2p:sessionUpdate', getSession())
    throw err
  }

  sendToSignaling({
    type: 'join_room',
    roomId,
    token: joinToken,
    username,
  })

  return getSession()
}

/**
 * Send WebRTC signaling data (SDP/ICE) to the remote peer via the signaling server.
 */
export function relaySignal(data: any): void {
  sendToSignaling({ type: 'signal', data })
}

/**
 * Close the current room.
 */
export function closeRoom(): void {
  sendToSignaling({ type: 'close_room' })
  endSession('User closed room')
  broadcastToRenderer('p2p:sessionUpdate', getSession())
  disconnect()
}

/**
 * Check if connected to signaling server.
 */
export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function sendToSignaling(msg: any): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  } else {
    console.warn('[P2P Signaling] Cannot send — not connected')
  }
}

function broadcastToRenderer(channel: string, data: any): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    w.webContents.send(channel, data)
  })
}
