/**
 * Twitch Integration for Loom Launcher
 *
 * Features:
 * - OAuth2 PKCE authentication flow
 * - Helix API for followed streams and live status
 * - Polling followed streams every 60 seconds
 * - IRC chat connection via WebSocket
 * - Event emitter for 'streamer-live' and 'chat-message' events
 */
import { app, BrowserWindow, net, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { EventEmitter } from 'events'
import { randomBytes, createHash } from 'crypto'
import { WebSocket } from 'ws'

// ============================================================
// Constants
// ============================================================

// Replace with your Twitch Application Client ID
const TWITCH_CLIENT_ID = 'YOUR_TWITCH_CLIENT_ID'
const TWITCH_REDIRECT_URI = 'http://localhost:47522/callback'
const TWITCH_AUTH_BASE = 'https://id.twitch.tv/oauth2'
const TWITCH_API_BASE = 'https://api.twitch.tv/helix'
const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv'

// ============================================================
// Types
// ============================================================

export interface TwitchToken {
  accessToken: string
  refreshToken: string
  expiresAt: number
  userId: string
  login: string
}

export interface TwitchStream {
  userId: string
  userName: string
  userLogin: string
  gameId: string
  gameName: string
  title: string
  viewerCount: number
  startedAt: string
  thumbnailUrl: string
  isLive: boolean
}

export interface ChatMessage {
  username: string
  message: string
  color: string
  badges: string[]
}

// ============================================================
// Event Emitter
// ============================================================

class TwitchEvents extends EventEmitter {}

export const twitchEvents = new TwitchEvents()

// ============================================================
// State
// ============================================================

let twitchToken: TwitchToken | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null
let pollEnabled = false
let previouslyLive = new Set<string>()

// IRC state
let ircSocket: WebSocket | null = null
let ircConnectedChannel: string | null = null

// ============================================================
// Persistence
// ============================================================

function getAuthPath(): string {
  const dir = join(app.getPath('userData'), 'twitch')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'twitch-auth.json')
}

function saveToken(token: TwitchToken): void {
  try {
    const json = JSON.stringify(token, null, 2)
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json).toString('base64')
      : json
    writeFileSync(getAuthPath(), encrypted, 'utf-8')
    console.log('[Twitch] Token saved (encrypted:', safeStorage.isEncryptionAvailable(), ')')
  } catch (err) {
    console.error('[Twitch] Failed to save token:', err)
  }
}

function loadToken(): TwitchToken | null {
  try {
    const path = getAuthPath()
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    let json: string
    // Try to decrypt (new encrypted format), fall back to plaintext (migration)
    try {
      json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(raw, 'base64'))
        : raw
    } catch {
      json = raw // Fallback for unencrypted legacy tokens
    }
    const data = JSON.parse(json)
    return data as TwitchToken
  } catch (err) {
    console.error('[Twitch] Failed to load token:', err)
    return null
  }
}

function deleteToken(): void {
  try {
    const path = getAuthPath()
    if (existsSync(path)) unlinkSync(path)
  } catch (err) {
    console.error('[Twitch] Failed to delete token:', err)
  }
}

// ============================================================
// PKCE Helpers
// ============================================================

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// ============================================================
// OAuth2 PKCE Flow
// ============================================================

/**
 * Start Twitch OAuth2 PKCE authentication.
 * Opens a BrowserWindow for the user to sign in.
 */
export async function startTwitchAuth(
  parentWindow: BrowserWindow | null
): Promise<TwitchToken> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = randomBytes(16).toString('hex')

  const scopes = [
    'user:read:follows',
    'user:read:subscriptions',
    'chat:read',
    'chat:edit',
  ].join(' ')

  const authUrl =
    `${TWITCH_AUTH_BASE}/authorize` +
    `?client_id=${TWITCH_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(TWITCH_REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`

  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parentWindow || undefined,
      modal: !!parentWindow,
      show: false,
      title: 'Sign in with Twitch',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    authWindow.setMenuBarVisibility(false)

    let resolved = false

    const handleCode = async (code: string) => {
      if (resolved) return
      resolved = true
      try {
        const token = await exchangeCode(code, codeVerifier)
        if (!authWindow.isDestroyed()) authWindow.destroy()
        twitchToken = token
        saveToken(token)
        console.log('[Twitch] Authenticated as', token.login)
        resolve(token)
      } catch (err) {
        if (!authWindow.isDestroyed()) authWindow.destroy()
        reject(err)
      }
    }

    const checkUrl = (url: string): boolean => {
      if (!url.startsWith('http://localhost:47522/callback')) return false
      try {
        const urlObj = new URL(url)
        const code = urlObj.searchParams.get('code')
        const returnedState = urlObj.searchParams.get('state')
        const error = urlObj.searchParams.get('error')

        if (error) {
          if (!resolved) {
            resolved = true
            if (!authWindow.isDestroyed()) authWindow.destroy()
            reject(new Error(`Twitch auth error: ${error}`))
          }
          return true
        }

        if (code && returnedState === state) {
          handleCode(code)
          return true
        }
      } catch { /* malformed URL */ }
      return false
    }

    authWindow.webContents.on('will-redirect', (_event, url) => {
      checkUrl(url)
    })

    authWindow.webContents.on('will-navigate', (_event, url) => {
      checkUrl(url)
    })

    authWindow.webContents.on('did-navigate', (_event, url) => {
      checkUrl(url)
    })

    authWindow.on('closed', () => {
      if (!resolved) {
        resolved = true
        reject(new Error('Twitch login window was closed'))
      }
    })

    authWindow.loadURL(authUrl)
    authWindow.once('ready-to-show', () => {
      if (!resolved) authWindow.show()
    })
  })
}

/**
 * Exchange authorization code for tokens using PKCE
 */
async function exchangeCode(
  code: string,
  codeVerifier: string
): Promise<TwitchToken> {
  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: TWITCH_REDIRECT_URI,
    code_verifier: codeVerifier,
  })

  const response = await net.fetch(`${TWITCH_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Twitch token exchange failed: ${response.status} ${text}`)
  }

  const data = await response.json()

  // Fetch user info to get userId and login
  const userInfo = await fetchUserInfo(data.access_token)

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    userId: userInfo.id,
    login: userInfo.login,
  }
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<TwitchToken> {
  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const response = await net.fetch(`${TWITCH_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    throw new Error(`Twitch token refresh failed: ${response.status}`)
  }

  const data = await response.json()
  const userInfo = await fetchUserInfo(data.access_token)

  const token: TwitchToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    userId: userInfo.id,
    login: userInfo.login,
  }

  saveToken(token)
  return token
}

/**
 * Fetch authenticated user info from Twitch Helix API
 */
async function fetchUserInfo(
  accessToken: string
): Promise<{ id: string; login: string; display_name: string }> {
  const response = await net.fetch(`${TWITCH_API_BASE}/users`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Twitch user info: ${response.status}`)
  }

  const data = await response.json()
  if (!data.data || data.data.length === 0) {
    throw new Error('No Twitch user data returned')
  }

  return data.data[0]
}

// ============================================================
// Token Management
// ============================================================

/**
 * Get the current valid Twitch token, refreshing if needed.
 * Returns null if not authenticated.
 */
export async function getTwitchToken(): Promise<TwitchToken | null> {
  if (!twitchToken) {
    twitchToken = loadToken()
  }

  if (!twitchToken) return null

  // Refresh if expired or expiring within 5 minutes
  if (twitchToken.expiresAt < Date.now() + 5 * 60 * 1000) {
    if (twitchToken.refreshToken) {
      try {
        console.log('[Twitch] Token expired, refreshing...')
        twitchToken = await refreshAccessToken(twitchToken.refreshToken)
        console.log('[Twitch] Token refreshed successfully')
      } catch (err) {
        console.error('[Twitch] Token refresh failed:', err)
        return null
      }
    } else {
      console.warn('[Twitch] Token expired and no refresh token available')
      return null
    }
  }

  return twitchToken
}

/**
 * Clear all Twitch authentication data
 */
export function clearTwitchAuth(): void {
  twitchToken = null
  previouslyLive.clear()
  stopPolling()
  disconnectChat()
  deleteToken()
  console.log('[Twitch] Auth cleared')
}

// ============================================================
// Helix API — Followed Streams
// ============================================================

/**
 * Make an authenticated Helix API request
 */
async function helixFetch(
  endpoint: string,
  token: TwitchToken
): Promise<any> {
  const response = await net.fetch(`${TWITCH_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID,
    },
  })

  if (!response.ok) {
    throw new Error(`Helix API error: ${response.status} on ${endpoint}`)
  }

  return response.json()
}

/**
 * Get live streams from channels the authenticated user follows
 */
export async function getFollowedStreams(): Promise<TwitchStream[]> {
  const token = await getTwitchToken()
  if (!token) {
    console.warn('[Twitch] Cannot get followed streams — not authenticated')
    return []
  }

  try {
    const data = await helixFetch(
      `/streams/followed?user_id=${token.userId}&first=50`,
      token
    )

    return (data.data || []).map((s: any) => ({
      userId: s.user_id,
      userName: s.user_name,
      userLogin: s.user_login,
      gameId: s.game_id || '',
      gameName: s.game_name || '',
      title: s.title || '',
      viewerCount: s.viewer_count || 0,
      startedAt: s.started_at || '',
      thumbnailUrl: (s.thumbnail_url || '')
        .replace('{width}', '440')
        .replace('{height}', '248'),
      isLive: true,
    }))
  } catch (err) {
    console.error('[Twitch] Failed to fetch followed streams:', err)
    return []
  }
}

/**
 * Check if a specific channel is currently live
 */
export async function isStreamerLive(
  channelName: string
): Promise<TwitchStream | null> {
  const token = await getTwitchToken()
  if (!token) {
    console.warn('[Twitch] Cannot check stream status — not authenticated')
    return null
  }

  try {
    const data = await helixFetch(
      `/streams?user_login=${encodeURIComponent(channelName)}`,
      token
    )

    if (!data.data || data.data.length === 0) return null

    const s = data.data[0]
    return {
      userId: s.user_id,
      userName: s.user_name,
      userLogin: s.user_login,
      gameId: s.game_id || '',
      gameName: s.game_name || '',
      title: s.title || '',
      viewerCount: s.viewer_count || 0,
      startedAt: s.started_at || '',
      thumbnailUrl: (s.thumbnail_url || '')
        .replace('{width}', '440')
        .replace('{height}', '248'),
      isLive: true,
    }
  } catch (err) {
    console.error(`[Twitch] Failed to check if ${channelName} is live:`, err)
    return null
  }
}

// ============================================================
// Polling
// ============================================================

/**
 * Start polling followed streams every 60 seconds.
 * Emits 'streamer-live' events when a new streamer goes live.
 */
export function startPolling(): void {
  if (pollInterval) return
  pollEnabled = true

  console.log('[Twitch] Starting followed streams polling (60s interval)')

  const poll = async (): Promise<void> => {
    try {
      const streams = await getFollowedStreams()
      const currentlyLive = new Set(streams.map((s) => s.userLogin))

      // Detect newly live streamers
      for (const stream of streams) {
        if (!previouslyLive.has(stream.userLogin)) {
          console.log(`[Twitch] ${stream.userName} just went live!`)
          twitchEvents.emit('streamer-live', stream)
        }
      }

      previouslyLive = currentlyLive
    } catch (err) {
      console.error('[Twitch] Polling error:', err)
    }
  }

  // Initial poll
  poll()

  pollInterval = setInterval(poll, 60_000)
}

/**
 * Stop polling followed streams
 */
export function stopPolling(): void {
  pollEnabled = false
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
    console.log('[Twitch] Stopped polling')
  }
}

/**
 * Whether polling is currently active
 */
export function isPollingActive(): boolean {
  return pollEnabled && pollInterval !== null
}

// ============================================================
// IRC Chat via WebSocket
// ============================================================

/**
 * Connect to Twitch IRC chat for a given channel.
 * Emits 'chat-message' events with { username, message, color, badges }.
 */
export async function connectChat(channel: string): Promise<void> {
  const token = await getTwitchToken()
  if (!token) {
    throw new Error('Not authenticated with Twitch')
  }

  // Disconnect existing connection
  if (ircSocket) {
    disconnectChat()
  }

  const normalizedChannel = channel.toLowerCase().replace(/^#/, '')
  ircConnectedChannel = normalizedChannel

  return new Promise((resolve, reject) => {
    console.log(`[Twitch IRC] Connecting to #${normalizedChannel}...`)

    ircSocket = new WebSocket(TWITCH_IRC_URL)

    const timeout = setTimeout(() => {
      if (ircSocket && ircSocket.readyState !== WebSocket.OPEN) {
        ircSocket.close()
        reject(new Error('IRC connection timed out'))
      }
    }, 10_000)

    ircSocket.on('open', () => {
      clearTimeout(timeout)
      if (!ircSocket) return

      // Request tags capability for colors and badges
      ircSocket.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ircSocket.send(`PASS oauth:${token!.accessToken}`)
      ircSocket.send(`NICK ${token!.login}`)
      ircSocket.send(`JOIN #${normalizedChannel}`)

      console.log(`[Twitch IRC] Connected to #${normalizedChannel}`)
      resolve()
    })

    ircSocket.on('message', (rawData: WebSocket.Data) => {
      const raw = rawData.toString()
      const lines = raw.split('\r\n').filter((l) => l.length > 0)

      for (const line of lines) {
        // Respond to PING to keep connection alive
        if (line.startsWith('PING')) {
          ircSocket?.send(`PONG ${line.substring(5)}`)
          continue
        }

        // Parse PRIVMSG for chat messages
        const parsed = parseIRCMessage(line)
        if (parsed) {
          twitchEvents.emit('chat-message', parsed)
        }
      }
    })

    ircSocket.on('error', (err) => {
      console.error('[Twitch IRC] WebSocket error:', err)
      clearTimeout(timeout)
    })

    ircSocket.on('close', () => {
      console.log('[Twitch IRC] Connection closed')
      ircSocket = null
      ircConnectedChannel = null
    })
  })
}

/**
 * Parse an IRC message line into a ChatMessage, or null if not a PRIVMSG
 */
function parseIRCMessage(line: string): ChatMessage | null {
  // Format: @tags :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
  const privmsgMatch = line.match(
    /^(@\S+\s)?:(\w+)!\w+@\w+\.tmi\.twitch\.tv\s+PRIVMSG\s+#\w+\s+:(.+)$/
  )

  if (!privmsgMatch) return null

  const tagsStr = privmsgMatch[1]?.trim() || ''
  const username = privmsgMatch[2]
  const message = privmsgMatch[3]

  // Parse tags
  const tags: Record<string, string> = {}
  if (tagsStr.startsWith('@')) {
    const tagPairs = tagsStr.substring(1).split(';')
    for (const pair of tagPairs) {
      const [key, value] = pair.split('=')
      if (key) tags[key] = value || ''
    }
  }

  const color = tags['color'] || '#FFFFFF'
  const badgeStr = tags['badges'] || ''
  const badges = badgeStr
    ? badgeStr.split(',').map((b) => b.split('/')[0])
    : []

  return { username, message, color, badges }
}

/**
 * Disconnect from Twitch IRC chat
 */
export function disconnectChat(): void {
  if (ircSocket) {
    try {
      if (ircConnectedChannel) {
        ircSocket.send(`PART #${ircConnectedChannel}`)
      }
      ircSocket.close()
    } catch { /* ignore */ }
    ircSocket = null
    ircConnectedChannel = null
    console.log('[Twitch IRC] Disconnected')
  }
}

/**
 * Send a chat message to the connected channel
 */
export function sendChatMessage(channel: string, message: string): void {
  if (!ircSocket || ircSocket.readyState !== WebSocket.OPEN) {
    console.warn('[Twitch IRC] Cannot send message — not connected')
    return
  }

  const normalizedChannel = channel.toLowerCase().replace(/^#/, '')
  ircSocket.send(`PRIVMSG #${normalizedChannel} :${message}`)
}

/**
 * Get the currently connected IRC channel, or null
 */
export function getConnectedChannel(): string | null {
  return ircConnectedChannel
}

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize Twitch module — loads stored token from disk
 */
export function initTwitch(): void {
  twitchToken = loadToken()
  if (twitchToken) {
    console.log(`[Twitch] Loaded saved auth for ${twitchToken.login}`)
  } else {
    console.log('[Twitch] No saved auth found')
  }
}
