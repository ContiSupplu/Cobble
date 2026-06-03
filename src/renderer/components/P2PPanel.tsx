/**
 * P2PPanel — Full P2P multiplayer panel with Host/Join tabs.
 *
 * Host flow: Create room → Copy invite link → Wait for friend → Connected
 * Join flow: Paste invite link → Connect → Playing
 */

import { useState, useEffect } from 'react'
import { useP2P } from '../hooks/useP2P'
import '../styles/p2p-panel.css'

const api = (window as any).electronAPI

interface P2PPanelProps {
  onClose: () => void
}

export default function P2PPanel({ onClose }: P2PPanelProps) {
  const {
    session,
    error,
    copied,
    isActive,
    createRoom,
    joinFromUrl,
    closeRoom,
    copyInviteLink,
    clearError,
  } = useP2P()

  const [tab, setTab] = useState<'host' | 'join'>('host')
  const [inviteInput, setInviteInput] = useState('')
  const [loading, setLoading] = useState(false)

  // Get current user info
  const [username, setUsername] = useState('Player')
  useEffect(() => {
    api?.getAccount?.().then((account: any) => {
      if (account?.username) setUsername(account.username)
    })
  }, [])

  // Auto-switch to host tab when session is active as host
  useEffect(() => {
    if (session?.role === 'host') setTab('host')
    if (session?.role === 'joiner') setTab('join')
  }, [session?.role])

  const handleCreate = async () => {
    setLoading(true)
    clearError()
    await createRoom(username, 'Singleplayer World', '1.21.11')
    setLoading(false)
  }

  const handleJoin = async () => {
    if (!inviteInput.trim()) return
    setLoading(true)
    clearError()
    await joinFromUrl(inviteInput.trim(), username)
    setLoading(false)
  }

  const handleDisconnect = async () => {
    await closeRoom()
  }

  const getStatusDotClass = () => {
    if (!session) return ''
    switch (session.status) {
      case 'waiting': return 'waiting'
      case 'creating':
      case 'connecting': return 'connecting'
      case 'connected': return 'connected'
      case 'error': return 'error'
      default: return ''
    }
  }

  const getStatusText = () => {
    if (!session) return ''
    switch (session.status) {
      case 'creating': return 'Setting up room...'
      case 'waiting': return 'Waiting for friend to join...'
      case 'connecting': return 'Establishing connection...'
      case 'connected': return 'Connected — playing!'
      case 'disconnected': return 'Session ended'
      case 'error': return session.error || 'Something went wrong'
      default: return ''
    }
  }

  return (
    <div className="p2p-overlay" onClick={onClose}>
      <div className="p2p-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p2p-header">
          <div className="p2p-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Play with Friends
          </div>
          <button className="p2p-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p2p-body">
          {/* Tabs — only show when no active session */}
          {!isActive && (
            <div className="p2p-tabs">
              <button className={`p2p-tab ${tab === 'host' ? 'active' : ''}`} onClick={() => setTab('host')}>
                Host
              </button>
              <button className={`p2p-tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>
                Join
              </button>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p2p-error">{error}</div>
          )}

          {/* ── HOST TAB ── */}
          {tab === 'host' && !isActive && (
            <>
              <div className="p2p-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8" /><path d="M12 17v4" />
                </svg>
                <p>Open your singleplayer world to a friend over the internet. No port forwarding needed.</p>
              </div>
              <button className="p2p-action" onClick={handleCreate} disabled={loading}>
                {loading ? <span className="p2p-spinner" /> : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14" /><path d="M5 12h14" />
                  </svg>
                )}
                {loading ? 'Creating...' : 'Create Room'}
              </button>
            </>
          )}

          {/* ── HOST: Active session ── */}
          {tab === 'host' && isActive && session?.role === 'host' && (
            <>
              {/* Status */}
              <div className="p2p-status">
                <div className={`p2p-status-dot ${getStatusDotClass()}`} />
                <span className="p2p-status-text">{getStatusText()}</span>
              </div>

              {/* Invite link */}
              {session.inviteUrl && (
                <>
                  <p className="p2p-label">Invite Link</p>
                  <div className="p2p-invite-box">
                    <span className="p2p-invite-url">{session.inviteUrl}</span>
                    <button className={`p2p-copy-btn ${copied ? 'copied' : ''}`} onClick={copyInviteLink}>
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </>
              )}

              {/* Session info */}
              <div className="p2p-session-info">
                <div className="p2p-session-row">
                  <span className="p2p-session-key">Host</span>
                  <span className="p2p-session-val">{session.hostUsername}</span>
                </div>
                <div className="p2p-session-row">
                  <span className="p2p-session-key">World</span>
                  <span className="p2p-session-val">{session.worldName || 'World'}</span>
                </div>
                {session.joinerUsername && (
                  <div className="p2p-session-row">
                    <span className="p2p-session-key">Friend</span>
                    <span className="p2p-session-val">
                      <span className="p2p-player">
                        <span className="p2p-player-dot" />
                        {session.joinerUsername}
                      </span>
                    </span>
                  </div>
                )}
                <div className="p2p-session-row">
                  <span className="p2p-session-key">Status</span>
                  <span className="p2p-session-val" style={{ fontFamily: 'var(--font-sans)' }}>
                    {session.status === 'connected' ? '🟢 Connected' : session.status === 'waiting' ? '🟡 Waiting' : session.status}
                  </span>
                </div>
              </div>

              <button className="p2p-disconnect" onClick={handleDisconnect}>
                End Session
              </button>
            </>
          )}

          {/* ── JOIN TAB ── */}
          {tab === 'join' && !isActive && (
            <>
              <p className="p2p-label">Paste Invite Link</p>
              <input
                className="p2p-input"
                placeholder="https://loommc.com/join/... or loom://join/..."
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                autoFocus
              />
              <button className="p2p-action" onClick={handleJoin} disabled={loading || !inviteInput.trim()}>
                {loading ? <span className="p2p-spinner" /> : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M15 3h6v6" /><path d="M10 14 21 3" />
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                )}
                {loading ? 'Joining...' : 'Join Game'}
              </button>
            </>
          )}

          {/* ── JOIN: Active session ── */}
          {tab === 'join' && isActive && session?.role === 'joiner' && (
            <>
              <div className="p2p-status">
                <div className={`p2p-status-dot ${getStatusDotClass()}`} />
                <span className="p2p-status-text">{getStatusText()}</span>
              </div>

              <div className="p2p-session-info">
                {session.hostUsername && (
                  <div className="p2p-session-row">
                    <span className="p2p-session-key">Host</span>
                    <span className="p2p-session-val">{session.hostUsername}</span>
                  </div>
                )}
                {session.worldName && (
                  <div className="p2p-session-row">
                    <span className="p2p-session-key">World</span>
                    <span className="p2p-session-val">{session.worldName}</span>
                  </div>
                )}
                {session.proxyPort && (
                  <div className="p2p-session-row">
                    <span className="p2p-session-key">Connect to</span>
                    <span className="p2p-session-val">localhost:{session.proxyPort}</span>
                  </div>
                )}
              </div>

              <button className="p2p-disconnect" onClick={handleDisconnect}>
                Leave Game
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
