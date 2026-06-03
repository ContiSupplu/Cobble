#!/usr/bin/env node
/**
 * Loom Connect — Lightweight P2P joiner for Minecraft multiplayer.
 *
 * No launcher needed. No mods needed. Just run, paste your invite link, and play.
 *
 * Flow:
 *   1. Parse invite URL (clipboard or manual input)
 *   2. Connect to Loom signaling server via WebSocket
 *   3. Join room → exchange WebRTC signals with host
 *   4. Open DataChannel → bridge to local TCP server
 *   5. User connects Minecraft to localhost:<port>
 */

import * as net from 'net'
import * as readline from 'readline'
import { execSync } from 'child_process'
import WebSocket from 'ws'

// ── Pretty Terminal Output ──────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[38;5;33m',
  green: '\x1b[38;5;42m',
  yellow: '\x1b[38;5;220m',
  red: '\x1b[38;5;196m',
  cyan: '\x1b[38;5;45m',
  magenta: '\x1b[38;5;135m',
  white: '\x1b[37m',
  gray: '\x1b[38;5;240m',
  bg: '\x1b[48;5;234m',
}

function log(msg: string) { console.log(`  ${msg}`) }
function info(msg: string) { log(`${C.blue}●${C.reset} ${msg}`) }
function success(msg: string) { log(`${C.green}✓${C.reset} ${msg}`) }
function warn(msg: string) { log(`${C.yellow}!${C.reset} ${msg}`) }
function error(msg: string) { log(`${C.red}✗${C.reset} ${msg}`) }

function banner() {
  console.log()
  console.log(`  ${C.bold}${C.blue}╔══════════════════════════════════════╗${C.reset}`)
  console.log(`  ${C.bold}${C.blue}║${C.reset}  ${C.bold}Loom Connect${C.reset}  ${C.dim}— Play with Friends${C.reset}   ${C.bold}${C.blue}║${C.reset}`)
  console.log(`  ${C.bold}${C.blue}╚══════════════════════════════════════╝${C.reset}`)
  console.log()
}

// ── Config ──────────────────────────────────────────────────────────────────

const SIGNALING_URL = process.env.LOOM_SIGNALING_URL || 'ws://localhost:8090'
const LOCAL_PORT = 25566 // Port Minecraft will connect to
const USERNAME = process.env.USERNAME || process.env.USER || 'Player'

// ── URL Parsing ─────────────────────────────────────────────────────────────

function parseInviteUrl(url: string): { roomId: string; joinToken: string } | null {
  // https://loommc.com/join/<roomId>/<token>
  const webMatch = url.match(/loommc\.com\/join\/([a-f0-9]+)\/([a-f0-9]+)/i)
  if (webMatch) return { roomId: webMatch[1], joinToken: webMatch[2] }

  // loom://join/<roomId>/<token>
  const deepMatch = url.match(/loom:\/\/join\/([a-f0-9]+)\/([a-f0-9]+)/i)
  if (deepMatch) return { roomId: deepMatch[1], joinToken: deepMatch[2] }

  return null
}

function tryReadClipboard(): string | null {
  try {
    const text = execSync('powershell -command "Get-Clipboard"', { encoding: 'utf-8' }).trim()
    if (text && (text.includes('loommc.com/join/') || text.includes('loom://join/'))) {
      return text
    }
  } catch { /* clipboard not available */ }
  return null
}

// ── Signaling ───────────────────────────────────────────────────────────────

interface SignalingEvents {
  onRoomJoined: (hostUsername: string, worldName: string, gameVersion: string) => void
  onSignal: (data: any) => void
  onRoomClosed: () => void
  onError: (message: string) => void
}

function connectSignaling(
  roomId: string,
  joinToken: string,
  username: string,
  events: SignalingEvents
): { sendSignal: (data: any) => void; close: () => void } {
  const ws = new WebSocket(SIGNALING_URL)

  ws.on('open', () => {
    info(`Connected to signaling server`)
    ws.send(JSON.stringify({
      type: 'join_room',
      roomId,
      token: joinToken,
      username,
    }))
  })

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString())

      switch (msg.type) {
        case 'room_joined':
          events.onRoomJoined(msg.hostUsername, msg.worldName, msg.gameVersion)
          break
        case 'signal':
          events.onSignal(msg.data)
          break
        case 'room_closed':
        case 'host_disconnected':
          events.onRoomClosed()
          break
        case 'error':
          events.onError(msg.message || 'Unknown error')
          break
      }
    } catch { /* ignore parse errors */ }
  })

  ws.on('error', (err) => {
    events.onError(`Signaling connection error: ${err.message}`)
  })

  ws.on('close', () => {
    info(`Signaling connection closed`)
  })

  return {
    sendSignal: (data: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'signal', data }))
      }
    },
    close: () => ws.close(),
  }
}

// ── WebRTC + TCP Tunnel ─────────────────────────────────────────────────────

async function createTunnel(
  sendSignal: (data: any) => void,
  onReady: (port: number) => void,
  onClose: () => void,
): Promise<{ feedSignal: (data: any) => void; destroy: () => void }> {
  // Dynamically import node-datachannel polyfill for WebRTC
  let wrtcImpl: any
  try {
    wrtcImpl = await import('node-datachannel/polyfill')
  } catch {
    // Fallback: try wrtc package
    try {
      wrtcImpl = await import('wrtc' as any)
    } catch {
      error('No WebRTC implementation found. Install node-datachannel or wrtc.')
      process.exit(1)
    }
  }

  const SimplePeer = (await import('simple-peer')).default

  const peer = new SimplePeer({
    initiator: false,
    trickle: true,
    wrtc: wrtcImpl,
    channelConfig: {
      ordered: true,
    },
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    },
  })

  // TCP server for Minecraft to connect to
  let tcpServer: net.Server | null = null
  let mcSocket: net.Socket | null = null

  peer.on('signal', (data: any) => {
    sendSignal(data)
  })

  peer.on('connect', () => {
    success('WebRTC DataChannel connected!')
    log('')

    // Create TCP server for Minecraft
    tcpServer = net.createServer((socket) => {
      if (mcSocket) {
        socket.destroy()
        return
      }

      mcSocket = socket
      success(`Minecraft connected!`)
      log('')
      log(`  ${C.bold}${C.green}▶ You're in! Have fun playing! ◀${C.reset}`)
      log('')

      socket.on('data', (data) => {
        try {
          if (peer && !peer.destroyed) {
            peer.send(data)
          }
        } catch { /* peer closing */ }
      })

      socket.on('close', () => {
        warn('Minecraft disconnected')
        mcSocket = null
      })

      socket.on('error', () => {
        mcSocket = null
      })
    })

    tcpServer.listen(LOCAL_PORT, '127.0.0.1', () => {
      onReady(LOCAL_PORT)
    })

    tcpServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // Try next port
        tcpServer?.listen(LOCAL_PORT + 1, '127.0.0.1', () => {
          onReady(LOCAL_PORT + 1)
        })
      } else {
        error(`TCP server error: ${err.message}`)
      }
    })
  })

  peer.on('data', (data: Uint8Array) => {
    // DataChannel → Minecraft TCP
    if (mcSocket && !mcSocket.destroyed) {
      mcSocket.write(Buffer.from(data))
    }
  })

  peer.on('error', (err: Error) => {
    error(`Connection error: ${err.message}`)
  })

  peer.on('close', () => {
    warn('Peer connection closed')
    mcSocket?.destroy()
    tcpServer?.close()
    onClose()
  })

  return {
    feedSignal: (data: any) => {
      if (!peer.destroyed) {
        peer.signal(data)
      }
    },
    destroy: () => {
      peer.destroy()
      mcSocket?.destroy()
      tcpServer?.close()
    },
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  banner()

  // Step 1: Get the invite URL
  let inviteUrl: string | null = null

  // Check command line args first
  const urlArg = process.argv.find(a => a.includes('loommc.com/join/') || a.includes('loom://join/'))
  if (urlArg) {
    inviteUrl = urlArg
    info(`Invite URL from command line`)
  }

  // Try clipboard
  if (!inviteUrl) {
    const clipUrl = tryReadClipboard()
    if (clipUrl) {
      inviteUrl = clipUrl
      info(`Found invite link in clipboard`)
    }
  }

  // Ask for manual input
  if (!inviteUrl) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    inviteUrl = await new Promise<string>((resolve) => {
      rl.question(`  ${C.cyan}?${C.reset} Paste your invite link: `, (answer) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  // Parse the URL
  const parsed = parseInviteUrl(inviteUrl)
  if (!parsed) {
    error('Invalid invite link. Expected format:')
    log(`  ${C.dim}https://loommc.com/join/<roomId>/<token>${C.reset}`)
    log(`  ${C.dim}loom://join/<roomId>/<token>${C.reset}`)
    process.exit(1)
  }

  success(`Invite parsed: room ${C.cyan}${parsed.roomId.slice(0, 8)}...${C.reset}`)
  log('')

  // Step 2: Connect and set up tunnel
  info(`Connecting to host...`)

  let tunnel: { feedSignal: (data: any) => void; destroy: () => void } | null = null
  let signaling: { sendSignal: (data: any) => void; close: () => void } | null = null

  signaling = connectSignaling(parsed.roomId, parsed.joinToken, USERNAME, {
    onRoomJoined: async (hostUsername, worldName, gameVersion) => {
      success(`Joined ${C.bold}${hostUsername}${C.reset}'s room`)
      log(`  ${C.dim}World: ${worldName}  •  Version: ${gameVersion}${C.reset}`)
      log('')
      info('Establishing peer-to-peer connection...')

      // Create WebRTC tunnel
      tunnel = await createTunnel(
        (data) => signaling!.sendSignal(data),
        (port) => {
          log('')
          console.log(`  ${C.bold}${C.green}╔══════════════════════════════════════╗${C.reset}`)
          console.log(`  ${C.bold}${C.green}║${C.reset}                                      ${C.bold}${C.green}║${C.reset}`)
          console.log(`  ${C.bold}${C.green}║${C.reset}   ${C.bold}Ready! Open Minecraft and add${C.reset}     ${C.bold}${C.green}║${C.reset}`)
          console.log(`  ${C.bold}${C.green}║${C.reset}   this server:                       ${C.bold}${C.green}║${C.reset}`)
          console.log(`  ${C.bold}${C.green}║${C.reset}                                      ${C.bold}${C.green}║${C.reset}`)
          console.log(`  ${C.bold}${C.green}║${C.reset}     ${C.bold}${C.cyan}localhost:${port}${C.reset}                ${C.bold}${C.green}║${C.reset}`)
          console.log(`  ${C.bold}${C.green}║${C.reset}                                      ${C.bold}${C.green}║${C.reset}`)
          console.log(`  ${C.bold}${C.green}╚══════════════════════════════════════╝${C.reset}`)
          log('')
          info(`${C.dim}Press Ctrl+C to disconnect${C.reset}`)
          log('')
        },
        () => {
          warn('Session ended by host')
          process.exit(0)
        },
      )
    },

    onSignal: (data) => {
      tunnel?.feedSignal(data)
    },

    onRoomClosed: () => {
      warn('Room was closed by the host')
      tunnel?.destroy()
      process.exit(0)
    },

    onError: (message) => {
      error(message)
      if (message.includes('not exist') || message.includes('expired') || message.includes('Invalid')) {
        error('The invite link may have expired. Ask your friend for a new one.')
        process.exit(1)
      }
    },
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('')
    info('Disconnecting...')
    tunnel?.destroy()
    signaling?.close()
    setTimeout(() => process.exit(0), 500)
  })
}

main().catch((err) => {
  error(`Fatal error: ${err.message}`)
  process.exit(1)
})
