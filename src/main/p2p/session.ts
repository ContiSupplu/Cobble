/**
 * P2P Session Manager — Tracks active P2P sessions and orchestrates the flow.
 *
 * A session goes through these states:
 *   idle → creating → waiting → connecting → connected → disconnected
 *
 * Host flow:
 *   1. createSession() — connects to signaling server, gets room tokens
 *   2. Mod opens LAN → session receives port
 *   3. WebRTC peer connects → tunnel starts
 *
 * Join flow:
 *   1. joinSession(roomId, token) — connects to signaling server
 *   2. WebRTC peer connects → local proxy starts
 *   3. MC launches with --server localhost --port <proxyPort>
 */

import { randomBytes } from 'crypto'

export type SessionRole = 'host' | 'joiner'
export type SessionStatus =
  | 'idle'
  | 'creating'       // Connecting to signaling server
  | 'waiting'        // Host: waiting for friend to join
  | 'connecting'     // WebRTC handshake in progress
  | 'connected'      // Tunnel active, playing
  | 'disconnected'   // Session ended
  | 'error'          // Something went wrong

export interface P2PSession {
  id: string
  role: SessionRole
  status: SessionStatus
  error?: string

  // Signaling
  roomId?: string
  hostToken?: string
  joinToken?: string

  // Network
  lanPort?: number       // Host: MC's LAN port
  proxyPort?: number     // Joiner: local proxy port for MC to connect to
  signalingUrl: string

  // Players
  hostUsername?: string
  joinerUsername?: string

  // Invite
  inviteUrl?: string

  // Timing
  createdAt: number
  expiresAt: number      // 30 minutes from creation

  // World info (from host)
  worldName?: string
  gameVersion?: string
}

export type SessionUpdateCallback = (session: P2PSession) => void

// ─── State ─────────────────────────────────────────────────────────────────

const DEFAULT_SIGNALING_URL = process.env.LOOM_SIGNALING_URL || 'ws://localhost:8090'
const SESSION_DURATION_MS = 30 * 60 * 1000 // 30 minutes
const INVITE_BASE_URL = 'https://loommc.com/join'

let currentSession: P2PSession | null = null
let updateListeners: SessionUpdateCallback[] = []

// ─── Session lifecycle ─────────────────────────────────────────────────────

/**
 * Create a new host session.
 * Generates a local session ID and prepares for signaling server connection.
 */
export function createHostSession(username: string, worldName?: string, gameVersion?: string): P2PSession {
  if (currentSession && currentSession.status !== 'disconnected' && currentSession.status !== 'error') {
    throw new Error('A session is already active')
  }

  const session: P2PSession = {
    id: randomBytes(8).toString('hex'),
    role: 'host',
    status: 'creating',
    signalingUrl: DEFAULT_SIGNALING_URL,
    hostUsername: username,
    worldName: worldName || 'Singleplayer World',
    gameVersion: gameVersion || '1.21.11',
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION_MS,
  }

  currentSession = session
  notifyListeners()
  console.log(`[P2P Session] Host session created: ${session.id}`)
  return session
}

/**
 * Create a joiner session from an invite link.
 */
export function createJoinSession(
  roomId: string,
  joinToken: string,
  username: string
): P2PSession {
  if (currentSession && currentSession.status !== 'disconnected' && currentSession.status !== 'error') {
    throw new Error('A session is already active')
  }

  const session: P2PSession = {
    id: randomBytes(8).toString('hex'),
    role: 'joiner',
    status: 'creating',
    signalingUrl: DEFAULT_SIGNALING_URL,
    roomId,
    joinToken,
    joinerUsername: username,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION_MS,
  }

  currentSession = session
  notifyListeners()
  console.log(`[P2P Session] Join session created for room ${roomId}`)
  return session
}

// ─── State updates ─────────────────────────────────────────────────────────

/**
 * Update the current session with signaling server response.
 */
export function setSignalingInfo(roomId: string, hostToken: string, joinToken: string): void {
  if (!currentSession) return

  currentSession.roomId = roomId
  currentSession.hostToken = hostToken
  currentSession.joinToken = joinToken
  currentSession.inviteUrl = `${INVITE_BASE_URL}/${roomId}/${joinToken}`
  currentSession.status = 'waiting'

  notifyListeners()
  console.log(`[P2P Session] Room created: ${roomId}, invite: ${currentSession.inviteUrl}`)
}

/**
 * Update with the host's world info (received by joiner from signaling).
 */
export function setHostInfo(hostUsername: string, worldName: string, gameVersion: string): void {
  if (!currentSession) return

  currentSession.hostUsername = hostUsername
  currentSession.worldName = worldName
  currentSession.gameVersion = gameVersion

  notifyListeners()
}

/**
 * Record the LAN port (host side — from mod's p2p_lan_opened message).
 */
export function setLANPort(port: number): void {
  if (!currentSession || currentSession.role !== 'host') return

  currentSession.lanPort = port
  notifyListeners()
  console.log(`[P2P Session] LAN port set: ${port}`)
}

/**
 * Record the local proxy port (joiner side — from tcp-proxy).
 */
export function setProxyPort(port: number): void {
  if (!currentSession || currentSession.role !== 'joiner') return

  currentSession.proxyPort = port
  notifyListeners()
  console.log(`[P2P Session] Proxy port set: ${port}`)
}

/**
 * Update session status.
 */
export function setStatus(status: SessionStatus, error?: string): void {
  if (!currentSession) return

  currentSession.status = status
  if (error) currentSession.error = error

  notifyListeners()
  console.log(`[P2P Session] Status → ${status}${error ? ` (${error})` : ''}`)
}

/**
 * Record joiner info when a peer joins (host side).
 */
export function setPeerJoined(username: string): void {
  if (!currentSession) return

  if (currentSession.role === 'host') {
    currentSession.joinerUsername = username
  }
  currentSession.status = 'connecting'

  notifyListeners()
  console.log(`[P2P Session] Peer joined: ${username}`)
}

/**
 * Mark the session as connected (tunnel is live).
 */
export function setConnected(): void {
  if (!currentSession) return

  currentSession.status = 'connected'
  notifyListeners()
  console.log('[P2P Session] Tunnel connected — playing!')
}

/**
 * End the current session.
 */
export function endSession(reason?: string): void {
  if (!currentSession) return

  currentSession.status = 'disconnected'
  if (reason) currentSession.error = reason

  notifyListeners()
  console.log(`[P2P Session] Session ended${reason ? `: ${reason}` : ''}`)
}

// ─── Queries ───────────────────────────────────────────────────────────────

/**
 * Get the current active session (if any).
 */
export function getSession(): P2PSession | null {
  // Auto-expire
  if (currentSession && Date.now() > currentSession.expiresAt) {
    endSession('Session expired')
    currentSession = null
    return null
  }
  return currentSession
}

/**
 * Check if there's an active (non-ended) session.
 */
export function hasActiveSession(): boolean {
  const session = getSession()
  return session !== null &&
    session.status !== 'disconnected' &&
    session.status !== 'error' &&
    session.status !== 'idle'
}

/**
 * Clear the session entirely (for cleanup).
 */
export function clearSession(): void {
  currentSession = null
  notifyListeners()
}

// ─── Invite URL parsing ────────────────────────────────────────────────────

/**
 * Parse an invite URL into roomId + joinToken.
 * Supports:
 *   - https://loommc.com/join/<roomId>/<token>
 *   - loom://join/<roomId>/<token>
 */
export function parseInviteUrl(url: string): { roomId: string; joinToken: string } | null {
  // Web URL format
  const webMatch = url.match(/loommc\.com\/join\/([a-f0-9]+)\/([a-f0-9]+)/i)
  if (webMatch) {
    return { roomId: webMatch[1], joinToken: webMatch[2] }
  }

  // Deep link format
  const deepMatch = url.match(/loom:\/\/join\/([a-f0-9]+)\/([a-f0-9]+)/i)
  if (deepMatch) {
    return { roomId: deepMatch[1], joinToken: deepMatch[2] }
  }

  return null
}

// ─── Listeners ─────────────────────────────────────────────────────────────

/**
 * Register a callback for session state changes.
 */
export function onSessionUpdate(callback: SessionUpdateCallback): void {
  updateListeners.push(callback)
}

/**
 * Remove a session update listener.
 */
export function offSessionUpdate(callback: SessionUpdateCallback): void {
  updateListeners = updateListeners.filter((cb) => cb !== callback)
}

function notifyListeners(): void {
  if (!currentSession) return
  const snapshot = { ...currentSession }
  updateListeners.forEach((cb) => {
    try { cb(snapshot) } catch { /* ignore */ }
  })
}
