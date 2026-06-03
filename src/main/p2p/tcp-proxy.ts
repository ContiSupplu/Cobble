/**
 * P2P TCP Proxy — Bridges Minecraft's TCP traffic to/from a WebRTC DataChannel.
 *
 * Host mode:  Accepts data from DataChannel → forwards to localhost:<mcPort>
 * Join mode:  Creates local TCP server on random port → forwards to DataChannel
 *
 * The WebRTC DataChannel operates in reliable + ordered mode, which mimics TCP.
 * This module handles the TCP socket ↔ binary buffer conversion.
 */

import { createServer, createConnection, Server, Socket } from 'net'

export interface TunnelCallbacks {
  /** Called when the tunnel has data to send over the WebRTC DataChannel */
  onData: (data: Buffer) => void
  /** Called when the tunnel is ready (with the local port for join mode) */
  onReady: (port: number) => void
  /** Called when the tunnel encounters an error */
  onError: (error: string) => void
  /** Called when a Minecraft client connects (join mode) or when connected to MC server (host mode) */
  onConnected: () => void
  /** Called when the connection closes */
  onClose: () => void
}

// ─── Host-side proxy ───────────────────────────────────────────────────────

let hostSocket: Socket | null = null

/**
 * Host mode: Connect to the local Minecraft LAN server.
 * Data received from MC is forwarded via onData callback (→ DataChannel).
 * Data from the remote peer comes in via feedHostData().
 */
export function startHostProxy(mcPort: number, callbacks: TunnelCallbacks): void {
  console.log(`[P2P Tunnel] Host: connecting to localhost:${mcPort}`)

  hostSocket = createConnection({ host: '127.0.0.1', port: mcPort }, () => {
    console.log(`[P2P Tunnel] Host: connected to MC server on port ${mcPort}`)
    callbacks.onConnected()
    callbacks.onReady(mcPort)
  })

  hostSocket.on('data', (data: Buffer) => {
    // MC server sent data → forward to DataChannel
    callbacks.onData(data)
  })

  hostSocket.on('error', (err) => {
    console.error(`[P2P Tunnel] Host: connection error:`, err.message)
    callbacks.onError(`Host proxy error: ${err.message}`)
  })

  hostSocket.on('close', () => {
    console.log('[P2P Tunnel] Host: MC connection closed')
    hostSocket = null
    callbacks.onClose()
  })
}

/**
 * Feed data from the WebRTC DataChannel into the host-side MC connection.
 */
export function feedHostData(data: Buffer): void {
  if (hostSocket && !hostSocket.destroyed) {
    hostSocket.write(data)
  }
}

/**
 * Stop the host proxy and close the MC connection.
 */
export function stopHostProxy(): void {
  if (hostSocket) {
    hostSocket.destroy()
    hostSocket = null
    console.log('[P2P Tunnel] Host: proxy stopped')
  }
}

// ─── Join-side proxy ───────────────────────────────────────────────────────

let joinServer: Server | null = null
let joinClient: Socket | null = null

/**
 * Join mode: Create a local TCP server that Minecraft can connect to.
 * When MC connects, its traffic is forwarded via onData callback (→ DataChannel).
 * Data from the host comes in via feedJoinData().
 *
 * Returns the random local port that MC should connect to.
 */
export function startJoinProxy(callbacks: TunnelCallbacks): void {
  joinServer = createServer((socket) => {
    console.log('[P2P Tunnel] Join: Minecraft client connected')

    // Only allow one MC client at a time
    if (joinClient) {
      console.warn('[P2P Tunnel] Join: rejecting duplicate MC connection')
      socket.destroy()
      return
    }

    joinClient = socket
    callbacks.onConnected()

    socket.on('data', (data: Buffer) => {
      // MC client sent data → forward to DataChannel
      callbacks.onData(data)
    })

    socket.on('error', (err) => {
      console.error('[P2P Tunnel] Join: MC client error:', err.message)
      callbacks.onError(`Join proxy error: ${err.message}`)
    })

    socket.on('close', () => {
      console.log('[P2P Tunnel] Join: MC client disconnected')
      joinClient = null
      callbacks.onClose()
    })
  })

  joinServer.on('error', (err) => {
    console.error('[P2P Tunnel] Join: server error:', err.message)
    callbacks.onError(`Join server error: ${err.message}`)
  })

  // Listen on a random port on localhost
  joinServer.listen(0, '127.0.0.1', () => {
    const addr = joinServer!.address()
    if (addr && typeof addr !== 'string') {
      const port = addr.port
      console.log(`[P2P Tunnel] Join: local proxy listening on localhost:${port}`)
      callbacks.onReady(port)
    }
  })
}

/**
 * Feed data from the WebRTC DataChannel into the join-side MC connection.
 */
export function feedJoinData(data: Buffer): void {
  if (joinClient && !joinClient.destroyed) {
    joinClient.write(data)
  }
}

/**
 * Stop the join proxy — close server and any connected client.
 */
export function stopJoinProxy(): void {
  if (joinClient) {
    joinClient.destroy()
    joinClient = null
  }
  if (joinServer) {
    joinServer.close()
    joinServer = null
    console.log('[P2P Tunnel] Join: proxy stopped')
  }
}

// ─── Shared utilities ──────────────────────────────────────────────────────

/**
 * Stop all proxies (both host and join).
 */
export function stopAllProxies(): void {
  stopHostProxy()
  stopJoinProxy()
}

/**
 * Check if the host proxy is connected to MC.
 */
export function isHostConnected(): boolean {
  return hostSocket !== null && !hostSocket.destroyed
}

/**
 * Check if a MC client is connected to the join proxy.
 */
export function isJoinClientConnected(): boolean {
  return joinClient !== null && !joinClient.destroyed
}
