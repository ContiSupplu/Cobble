/**
 * useP2P — React hook that manages the entire P2P multiplayer lifecycle.
 *
 * Handles:
 *   - Session state from main process
 *   - WebRTC peer connection (simple-peer) in the renderer
 *   - Binary data tunneling between DataChannel ↔ main process TCP proxy
 *   - Event subscriptions for session updates, signals, and errors
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import SimplePeer from 'simple-peer'

const api = (window as any).electronAPI

export type P2PStatus = 'idle' | 'creating' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface P2PSession {
  id: string
  role: 'host' | 'joiner'
  status: P2PStatus
  error?: string
  roomId?: string
  inviteUrl?: string
  lanPort?: number
  proxyPort?: number
  hostUsername?: string
  joinerUsername?: string
  worldName?: string
  gameVersion?: string
  createdAt: number
  expiresAt: number
}

export function useP2P() {
  const [session, setSession] = useState<P2PSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const peerRef = useRef<SimplePeer.Instance | null>(null)

  // ── Event subscriptions ─────────────────────────────────────────

  useEffect(() => {
    if (!api) return

    const unsubs: Array<() => void> = []

    // Session state updates from main
    unsubs.push(api.onP2PSessionUpdate?.((s: P2PSession) => {
      setSession(s)
      if (s?.error) setError(s.error)
    }))

    // Start WebRTC when signaling is ready
    unsubs.push(api.onP2PStartWebRTC?.((data: { initiator: boolean }) => {
      console.log('[P2P Hook] Starting WebRTC, initiator:', data.initiator)
      createPeer(data.initiator)
    }))

    // Receive WebRTC signaling data from remote peer
    unsubs.push(api.onP2PSignal?.((data: any) => {
      if (peerRef.current && !peerRef.current.destroyed) {
        peerRef.current.signal(data)
      }
    }))

    // Receive tunnel data from main (TCP proxy → renderer → DataChannel)
    unsubs.push(api.onP2PTunnelData?.((data: number[]) => {
      if (peerRef.current && !peerRef.current.destroyed) {
        try {
          peerRef.current.send(Buffer.from(data))
        } catch { /* peer might be closing */ }
      }
    }))

    // Peer left
    unsubs.push(api.onP2PPeerLeft?.(() => {
      destroyPeer()
    }))

    // Error from mod
    unsubs.push(api.onP2PError?.((message: string) => {
      setError(message)
    }))

    // Deep link received
    unsubs.push(api.onP2PDeepLink?.((url: string) => {
      // Auto-parse and show join modal — handled by the component
      console.log('[P2P Hook] Deep link received:', url)
    }))

    return () => {
      unsubs.forEach(unsub => {
        if (typeof unsub === 'function') unsub()
      })
      destroyPeer()
    }
  }, [])

  // ── WebRTC peer management ──────────────────────────────────────

  const createPeer = useCallback(async (initiator: boolean) => {
    destroyPeer()

    // Fetch ICE servers (STUN + TURN w/ ephemeral credentials) from main process
    let iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
    try {
      const servers = await api?.p2pGetICEServers()
      if (servers && servers.length > 0) {
        iceServers = servers
      }
    } catch {
      console.warn('[P2P Hook] Failed to fetch ICE servers, using defaults')
    }

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      channelConfig: {
        ordered: true,
        maxRetransmits: undefined, // reliable mode (mimics TCP)
      },
      config: { iceServers },
    })

    peer.on('signal', (data) => {
      // Send SDP/ICE to remote peer via signaling server
      api?.p2pRelaySignal(data)
    })

    peer.on('connect', async () => {
      console.log('[P2P Hook] WebRTC DataChannel connected!')
      setError(null)

      // Start the TCP proxy on the appropriate side
      const currentSession = await api?.p2pGetSession()
      if (currentSession?.role === 'host' && currentSession?.lanPort) {
        api?.p2pStartHostProxy(currentSession.lanPort)
      } else if (currentSession?.role === 'joiner') {
        const result = await api?.p2pStartJoinProxy()
        if (result?.port) {
          console.log(`[P2P Hook] Join proxy ready on localhost:${result.port}`)
          // TODO: auto-launch MC pointing at localhost:port
        }
      }
    })

    peer.on('data', (data: Uint8Array) => {
      // DataChannel received data → forward to main → TCP proxy
      api?.p2pFeedTunnelData(Array.from(data))
    })

    peer.on('error', (err) => {
      console.error('[P2P Hook] Peer error:', err.message)
      setError(`Connection error: ${err.message}`)
    })

    peer.on('close', () => {
      console.log('[P2P Hook] Peer connection closed')
      peerRef.current = null
    })

    peerRef.current = peer
  }, [])

  const destroyPeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.destroy()
      peerRef.current = null
    }
  }, [])

  // ── Actions ─────────────────────────────────────────────────────

  const createRoom = useCallback(async (username: string, worldName?: string, gameVersion?: string) => {
    setError(null)
    const result = await api?.p2pCreateRoom(username, worldName, gameVersion)
    if (result?.success) {
      setSession(result.session)
    } else {
      setError(result?.error || 'Failed to create room')
    }
    return result
  }, [])

  const joinRoom = useCallback(async (roomId: string, joinToken: string, username: string) => {
    setError(null)
    const result = await api?.p2pJoinRoom(roomId, joinToken, username)
    if (result?.success) {
      setSession(result.session)
    } else {
      setError(result?.error || 'Failed to join room')
    }
    return result
  }, [])

  const joinFromUrl = useCallback(async (url: string, username: string) => {
    setError(null)
    const result = await api?.p2pJoinFromUrl(url, username)
    if (result?.success) {
      setSession(result.session)
    } else {
      setError(result?.error || 'Invalid invite link')
    }
    return result
  }, [])

  const closeRoom = useCallback(async () => {
    destroyPeer()
    await api?.p2pCloseRoom()
    setSession(null)
    setError(null)
  }, [destroyPeer])

  const copyInviteLink = useCallback(() => {
    if (session?.inviteUrl) {
      navigator.clipboard.writeText(session.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [session])

  return {
    session,
    error,
    copied,
    isActive: session !== null && session.status !== 'disconnected' && session.status !== 'idle',
    isHost: session?.role === 'host',
    isJoiner: session?.role === 'joiner',
    createRoom,
    joinRoom,
    joinFromUrl,
    closeRoom,
    copyInviteLink,
    clearError: () => setError(null),
  }
}
