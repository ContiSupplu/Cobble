/**
 * P2P LAN Detection — Monitors UDP multicast for Minecraft LAN broadcasts.
 *
 * When a player opens their world to LAN, Minecraft broadcasts a discovery
 * packet via UDP multicast to 224.0.2.60:4445 every ~1.5 seconds.
 * Format: [MOTD]PlayerName - WorldName[/MOTD][AD]<port>[/AD]
 *
 * This module listens for those broadcasts as a fallback/complement to the
 * mod's p2p_lan_opened WebSocket message.
 */

import { createSocket, Socket } from 'dgram'

const MULTICAST_ADDR = '224.0.2.60'
const MULTICAST_PORT = 4445
const AD_REGEX = /\[AD\](\d+)\[\/AD\]/
const MOTD_REGEX = /\[MOTD\](.*?)\[\/MOTD\]/

export interface LANBroadcast {
  port: number
  motd: string
  timestamp: number
}

type LANCallback = (broadcast: LANBroadcast) => void

let socket: Socket | null = null
let listeners: LANCallback[] = []
let lastBroadcast: LANBroadcast | null = null

/**
 * Start listening for Minecraft LAN broadcasts on the local network.
 * Calls all registered callbacks when a broadcast is detected.
 */
export function startLANDetection(): void {
  if (socket) return // Already listening

  try {
    socket = createSocket({ type: 'udp4', reuseAddr: true })

    socket.on('message', (msg) => {
      const raw = msg.toString()
      const portMatch = raw.match(AD_REGEX)
      if (!portMatch) return

      const port = parseInt(portMatch[1], 10)
      if (isNaN(port) || port < 1 || port > 65535) return

      const motdMatch = raw.match(MOTD_REGEX)
      const motd = motdMatch ? motdMatch[1] : ''

      const broadcast: LANBroadcast = { port, motd, timestamp: Date.now() }
      lastBroadcast = broadcast

      console.log(`[P2P] LAN broadcast detected: port=${port} motd="${motd}"`)
      listeners.forEach((cb) => {
        try { cb(broadcast) } catch { /* ignore listener errors */ }
      })
    })

    socket.on('error', (err) => {
      console.error('[P2P] LAN detection error:', err.message)
      stopLANDetection()
    })

    socket.bind(MULTICAST_PORT, () => {
      try {
        socket!.addMembership(MULTICAST_ADDR)
        console.log(`[P2P] LAN detection started (listening on ${MULTICAST_ADDR}:${MULTICAST_PORT})`)
      } catch (err: any) {
        console.warn('[P2P] Could not join multicast group:', err.message)
        // Still useful — some systems deliver broadcasts without explicit membership
      }
    })
  } catch (err: any) {
    console.error('[P2P] Failed to start LAN detection:', err.message)
    socket = null
  }
}

/**
 * Stop listening for LAN broadcasts and clean up.
 */
export function stopLANDetection(): void {
  if (!socket) return
  try {
    socket.dropMembership(MULTICAST_ADDR)
  } catch { /* ignore — socket may already be closed */ }
  try {
    socket.close()
  } catch { /* ignore */ }
  socket = null
  lastBroadcast = null
  console.log('[P2P] LAN detection stopped')
}

/**
 * Register a callback for LAN broadcast events.
 */
export function onLANBroadcast(callback: LANCallback): void {
  listeners.push(callback)
}

/**
 * Remove a previously registered callback.
 */
export function offLANBroadcast(callback: LANCallback): void {
  listeners = listeners.filter((cb) => cb !== callback)
}

/**
 * Get the last detected LAN broadcast (if any).
 */
export function getLastBroadcast(): LANBroadcast | null {
  return lastBroadcast
}

/**
 * Check if LAN detection is currently active.
 */
export function isDetecting(): boolean {
  return socket !== null
}
