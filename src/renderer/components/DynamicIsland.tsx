import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLoomie } from '../context/LoomieContext'
import '../styles/dynamic-island.css'
import loomIcon from '../assets/loom-icon.png'

interface SpotifyTrack {
  title: string
  artist: string
  albumArt: string
  albumArtSmall: string
  progress: number
  duration: number
}

interface LaunchStatus {
  running?: boolean
  progress?: number
  task?: string
  error?: string
}

type IslandState = 'idle' | 'music' | 'music-paused' | 'error' | 'launching' | 'running' | 'loomie' | 'loomie-standby'

interface DynamicIslandProps {
  onOpenLogs?: () => void
}

const api = (window as any).electronAPI

/* ── Loomie Logo (inline) ── */
function LoomieLogo({ size = 14 }: { size?: number }) {
  const id = `pbl-di-${Math.random().toString(36).slice(2, 6)}`
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M14 0C14 7.732 7.732 14 0 14c7.732 0 14 6.268 14 14 0-7.732 6.268-14 14-14-7.732 0-14-6.268-14-14z" fill={`url(#${id})`} />
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" /><stop offset="0.33" stopColor="#9B72CB" /><stop offset="0.66" stopColor="#D96570" /><stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
    </svg>
  )
}

/* ── Simple inline markdown for island messages ── */
function renderMiniInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)/g
  let lastIndex = 0, match: RegExpExecArray | null, key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[1]) parts.push(<strong key={key++}>{match[2]}</strong>)
    else if (match[3]) parts.push(<code key={key++} style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: 3, fontSize: '10px' }}>{match[4]}</code>)
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

/* ── Truncate without breaking markdown ── */
function smartTruncate(text: string, max: number): string {
  if (text.length <= max) return text
  // Strip markdown for cleaner truncation
  let clean = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
  if (clean.length <= max) return clean
  return clean.slice(0, max) + '...'
}
export default function DynamicIsland({ onOpenLogs }: DynamicIslandProps) {
  const [track, setTrack] = useState<SpotifyTrack | null>(null)
  const [spotifyPlaying, setSpotifyPlaying] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [launchTask, setLaunchTask] = useState('')
  const [launchProgress, setLaunchProgress] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [firstDownload, setFirstDownload] = useState(false)
  const [error, setError] = useState('')
  const [contentKey, setContentKey] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const prevState = useRef<IslandState>('idle')

  // Loomie integration
  const loomie = useLoomie()
  const location = useLocation()
  const navigate = useNavigate()
  const [loomieInput, setLoomieInput] = useState('')
  const [showLoomieTransition, setShowLoomieTransition] = useState(false)
  const wasOnGeminiPage = useRef(false)

  // Detect navigation away from Gemini page — trigger transition animation
  useEffect(() => {
    const onGemini = location.pathname === '/gemini'
    if (wasOnGeminiPage.current && !onGemini && loomie.isOnTheGo) {
      // User just left the Loomie page with On the Go active
      setShowLoomieTransition(true)
      setTimeout(() => setShowLoomieTransition(false), 600)
    }
    wasOnGeminiPage.current = onGemini
  }, [location.pathname, loomie.isOnTheGo])

  // State priority: error > running > launching > loomie > music > loomie-standby > idle
  const getState = useCallback((): IslandState => {
    if (error) return 'error'
    if (isRunning && launchProgress >= 100) return 'running'
    if (isRunning && launchProgress < 100) return 'launching'
    if (loomie.isOnTheGo && !loomie.onGeminiPage) return 'loomie'
    if (spotifyPlaying && track) return 'music'
    if (loomie.isOnTheGo && loomie.onGeminiPage) return 'loomie-standby'
    if (spotifyConnected && track && !spotifyPlaying) return 'music-paused'
    return 'idle'
  }, [error, isRunning, launchTask, launchProgress, spotifyPlaying, spotifyConnected, track, loomie.isOnTheGo, loomie.onGeminiPage])

  const state = getState()

  // Animate content on state change
  useEffect(() => {
    const prev = prevState.current
    if (state !== prev) {
      if (!(prev === 'launching' && state === 'launching')) {
        setContentKey(k => k + 1)
      }
      if (state !== 'music' && state !== 'music-paused' && state !== 'loomie') setExpanded(false)
      prevState.current = state
    }
  }, [state])

  // Launch status listener
  useEffect(() => {
    const remove = api?.onLaunchStatus?.((status: LaunchStatus) => {
      if (status.task !== undefined) setLaunchTask(status.task)
      if (status.progress !== undefined) setLaunchProgress(status.progress)
      if (status.running !== undefined) setIsRunning(status.running)
      if (status.firstDownload !== undefined) setFirstDownload(status.firstDownload)
      if (status.error) setError(status.error)
      if (status.running === false) {
        const delay = status.error ? 0 : 2000
        setTimeout(() => { setLaunchTask(''); setLaunchProgress(0); setFirstDownload(false) }, delay)
      }
    })
    return () => remove?.()
  }, [])

  // Spotify polling
  useEffect(() => {
    let alive = true
    const poll = async () => {
      if (!alive) return
      try {
        const s = await api?.getSpotifyStatus?.()
        if (!s || !alive) return
        setSpotifyConnected(s.connected || false)
        setSpotifyPlaying(s.playing || false)
        if (s.track) setTrack(s.track)
      } catch { /* ignore */ }
    }
    poll()
    const iv = setInterval(poll, 2000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  // Click handler
  const handleClick = () => {
    if (state === 'error') {
      setError('')
    } else if (state === 'loomie-standby') {
      // Do nothing — just a status indicator
    } else {
      setExpanded(!expanded)
    }
  }

  // Spotify controls
  const handlePause = (e: React.MouseEvent) => { e.stopPropagation(); api?.spotifyPause?.(); setSpotifyPlaying(false) }
  const handlePlay = (e: React.MouseEvent) => { e.stopPropagation(); api?.spotifyPlay?.(); setSpotifyPlaying(true) }
  const handlePrev = (e: React.MouseEvent) => { e.stopPropagation(); api?.spotifyPrevious?.() }
  const handleNext = (e: React.MouseEvent) => { e.stopPropagation(); api?.spotifyNext?.() }

  // Loomie island send
  const handleLoomieSend = async (e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!loomieInput.trim() || loomie.isLoading) return
    const text = loomieInput
    setLoomieInput('')
    await loomie.sendFromIsland(text)
  }

  const musicPct = track ? Math.min(100, (track.progress / Math.max(1, track.duration)) * 100) : 0
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const eqBars = useMemo(() => (
    [0.5, 0.85, 0.35, 0.7, 0.45, 0.8, 0.4].map((h, i) => ({
      h: `${h * 100}%`,
      delay: `${i * 0.09}s`,
      dur: `${0.45 + i * 0.1}s`,
    }))
  ), [])

  // Get last 2 messages for loomie display
  const loomieMessages = loomie.lastMessages.slice(-2)
  const lastResponse = loomie.lastMessages.filter(m => m.role === 'model').slice(-1)[0]

  // Shared music content
  const renderMusicContent = (playing: boolean) => {
    if (!expanded) {
      return (
        <div className="di-content" key={contentKey}>
          <div className="di-art-wrap">
            {track?.albumArtSmall && <img className="di-art" src={track.albumArtSmall} alt="" />}
            <div className="di-art-glow" style={track?.albumArtSmall ? { backgroundImage: `url(${track.albumArtSmall})` } : {}} />
          </div>
          <div className="di-track-info">
            <span className="di-track-title">{track?.title}</span>
            <span className="di-track-artist">{track?.artist}</span>
          </div>
          {playing ? (
            <div className="di-eq">
              {eqBars.map((bar, i) => (
                <div key={i} className="di-eq-bar" style={{ '--h': bar.h, '--delay': bar.delay, '--dur': bar.dur } as React.CSSProperties} />
              ))}
            </div>
          ) : (
            <div className="di-paused-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(255,255,255,0.35)">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
              </svg>
            </div>
          )}
        </div>
      )
    }

    // Expanded music view
    return (
      <div className="di-content di-content-expanded" key={contentKey}>
        <div className="di-expanded-top">
          <div className="di-art-wrap">
            {track?.albumArtSmall && <img className="di-art" src={track.albumArtSmall} alt="" />}
            <div className="di-art-glow" style={track?.albumArtSmall ? { backgroundImage: `url(${track.albumArtSmall})` } : {}} />
          </div>
          <div className="di-track-info">
            <span className="di-track-title">{track?.title}</span>
            <span className="di-track-artist">{track?.artist}</span>
          </div>
          {playing && (
            <div className="di-eq">
              {eqBars.map((bar, i) => (
                <div key={i} className="di-eq-bar" style={{ '--h': bar.h, '--delay': bar.delay, '--dur': bar.dur } as React.CSSProperties} />
              ))}
            </div>
          )}
        </div>
        <div className="di-music-extra">
          <div className="di-music-progress-track">
            <div className="di-music-progress-fill" style={{ width: `${musicPct}%` }} />
          </div>
          <div className="di-music-times">
            <span>{fmt(track?.progress || 0)}</span>
            <span>{fmt(track?.duration || 0)}</span>
          </div>
          <div className="di-music-actions">
            <button className="di-ctrl-btn" onClick={handlePrev}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z"/></svg>
            </button>
            <button className="di-ctrl-btn di-ctrl-play" onClick={playing ? handlePause : handlePlay}>
              {playing ? (
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
              )}
            </button>
            <button className="di-ctrl-btn" onClick={handleNext}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 18h2V6h-2v12zM6 18l8.5-6L6 6v12z"/></svg>
            </button>
          </div>
          <div className="di-expanded-footer">
            <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); onOpenLogs?.() }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              Logs
            </button>
            <div style={{ display: 'flex', gap: '2px' }}>
              <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); setMinimized(true); setExpanded(false) }} title="Minimize">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); setExpanded(false) }} title="Collapse">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (state) {
      /* ── Loomie Standby (still on Gemini page) ── */
      case 'loomie-standby':
        return (
          <div className="di-content di-loomie-standby" key="loomie-standby">
            <div className="di-loomie-logo"><LoomieLogo size={14} /></div>
            <span className="di-label di-loomie-label">Loomie is on the go</span>
            <div className="di-loomie-dot" />
          </div>
        )

      /* ── Loomie Active (away from Gemini page) ── */
      case 'loomie':
        if (!expanded) {
          return (
            <div className="di-content di-loomie-compact" key={contentKey}>
              <div className="di-loomie-logo"><LoomieLogo size={14} /></div>
              <span className="di-label di-loomie-last-msg">
                {lastResponse ? (lastResponse.text.length > 40 ? lastResponse.text.slice(0, 40) + '...' : lastResponse.text) : 'Ask Loomie anything'}
              </span>
            </div>
          )
        }
        return (
          <div className="di-content di-content-expanded di-loomie-expanded" key="loomie-expanded">
            <div className="di-loomie-header">
              <div className="di-loomie-logo"><LoomieLogo size={16} /></div>
              <span className="di-loomie-title">Loomie</span>
              <span className="di-loomie-powered">Powered by Gemini</span>
              <button className="di-loomie-collapse" onClick={(e) => { e.stopPropagation(); setExpanded(false) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
            </div>
            <div className="di-loomie-messages" onClick={e => e.stopPropagation()}>
              {loomieMessages.map((msg, i) => (
                <div key={i} className={`di-loomie-msg di-loomie-msg--${msg.role}`}>
                  {msg.role === 'model' && <div className="di-loomie-msg-avatar"><LoomieLogo size={12} /></div>}
                  <div className="di-loomie-msg-text">
                    {renderMiniInline(smartTruncate(msg.text, 200))}
                  </div>
                </div>
              ))}
              {loomie.isLoading && (
                <div className="di-loomie-msg di-loomie-msg--model">
                  <div className="di-loomie-msg-avatar"><LoomieLogo size={12} /></div>
                  <div className="di-loomie-typing">
                    <span className="di-loomie-dot-anim" /><span className="di-loomie-dot-anim" /><span className="di-loomie-dot-anim" />
                  </div>
                </div>
              )}
            </div>
            <form className="di-loomie-input-wrap" onSubmit={handleLoomieSend} onClick={e => e.stopPropagation()}>
              <input
                className="di-loomie-input"
                value={loomieInput}
                onChange={e => setLoomieInput(e.target.value)}
                placeholder="Ask Loomie..."
                disabled={loomie.isLoading}
                onClick={e => e.stopPropagation()}
              />
              <button
                className={`di-loomie-send ${loomieInput.trim() && !loomie.isLoading ? 'active' : ''}`}
                onClick={handleLoomieSend}
                disabled={!loomieInput.trim() || loomie.isLoading}
                type="submit"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </form>
            <div className="di-loomie-footer">
              <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); navigate('/gemini') }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Full chat
              </button>
              <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); loomie.setOnTheGo(false); setExpanded(false) }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Dismiss
              </button>
            </div>
          </div>
        )

      case 'error':
        return (
          <div className="di-content" key={contentKey}>
            <div className="di-dot di-dot-red" />
            <span className="di-label">
              {error.length > 32 ? error.slice(0, 32) + '...' : error}
            </span>
            <button className="di-dismiss-btn" onClick={(e) => { e.stopPropagation(); setError('') }} aria-label="Dismiss">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )

      case 'launching': {
        const taskLabel = launchTask || 'Starting'
        const shortLabel = taskLabel.length > 28 ? taskLabel.slice(0, 28) + '...' : taskLabel
        if (!expanded) {
          return (
            <div className="di-content" key="launching">
              <div className="di-dot di-dot-amber" />
              <span className="di-label di-label-dim">{shortLabel}</span>
              <div className="di-progress">
                <div className="di-progress-bar" style={{ width: `${launchProgress}%` }} />
              </div>
              <span className="di-progress-pct">{Math.round(launchProgress)}%</span>
            </div>
          )
        }
        return (
          <div className="di-content di-content-expanded" key="launching-expanded">
            <div className="di-expanded-top">
              <div className="di-dot di-dot-amber" />
              <span className="di-label">{taskLabel}</span>
              <span className="di-progress-pct">{Math.round(launchProgress)}%</span>
            </div>
            <div className="di-launch-extra">
              <div className="di-progress" style={{ width: '100%' }}>
                <div className="di-progress-bar" style={{ width: `${launchProgress}%` }} />
              </div>
              {firstDownload && (
                <span className="di-first-download-hint">First launch — downloading game files. This may take a minute.</span>
              )}
              <div className="di-expanded-footer">
                <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); onOpenLogs?.() }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  View Logs
                </button>
                <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); setExpanded(false) }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
                  Collapse
                </button>
              </div>
            </div>
          </div>
        )
      }

      case 'running':
        if (!expanded) {
          return (
            <div className="di-content" key={contentKey}>
              <div className="di-dot di-dot-green" />
              <span className="di-label">Running</span>
            </div>
          )
        }
        return (
          <div className="di-content di-content-expanded" key="running-expanded">
            <div className="di-expanded-top">
              <div className="di-dot di-dot-green" />
              <span className="di-label">Minecraft is Running</span>
            </div>
            <div className="di-launch-extra">
              <div className="di-expanded-footer">
                <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); onOpenLogs?.() }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  View Logs
                </button>
                <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); setExpanded(false) }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
                  Collapse
                </button>
              </div>
            </div>
          </div>
        )

      case 'music':
        return renderMusicContent(true)

      case 'music-paused':
        return renderMusicContent(false)

      default: // idle
        if (expanded) {
          return (
            <div className="di-idle-expanded-content" key="idle-expanded">
              <div className="di-idle-header">
                <img src={loomIcon} alt="" width="14" height="14" style={{ borderRadius: 3 }} />
                <span className="di-idle-label">Loom</span>
              </div>
              <div className="di-expanded-footer">
                <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); onOpenLogs?.(); setExpanded(false) }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  Logs
                </button>
                <div style={{ display: 'flex', gap: '2px' }}>
                  <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); setMinimized(true); setExpanded(false) }} title="Minimize">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                  <button className="di-footer-btn" onClick={(e) => { e.stopPropagation(); setExpanded(false) }} title="Collapse">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )
        }
        return (
          <div className="di-idle-content" key={contentKey}>
            <div className="di-logo-mark">
              <img src={loomIcon} alt="" width="12" height="12" style={{ borderRadius: 3 }} />
            </div>
            <span className="di-idle-label">Loom</span>
          </div>
        )
    }
  }

  const pillClass = [
    'di-pill',
    `di-${state}`,
    (state === 'music' || state === 'music-paused') && expanded ? 'di-music-expanded' : '',
    (state === 'launching' || state === 'running') && expanded ? 'di-launch-expanded' : '',
    state === 'idle' && expanded ? 'di-idle-expanded' : '',
    state === 'loomie' && expanded ? 'di-loomie-full-expanded' : '',
    showLoomieTransition ? 'di-loomie-arrive' : '',
  ].filter(Boolean).join(' ')

  if (minimized) {
    return (
      <div
        className="di-mini"
        onClick={() => setMinimized(false)}
        title="Restore Dynamic Island"
      >
        {state === 'music' && track?.albumArtSmall ? (
          <img className="di-mini-art" src={track.albumArtSmall} alt="" />
        ) : state === 'loomie' || state === 'loomie-standby' ? (
          <div className="di-mini-loomie"><LoomieLogo size={10} /></div>
        ) : state === 'running' ? (
          <div className="di-mini-dot di-mini-dot-green" />
        ) : state === 'error' ? (
          <div className="di-mini-dot di-mini-dot-red" />
        ) : (
          <div className="di-mini-dot di-mini-dot-white" />
        )}
      </div>
    )
  }

  return (
    <div className="di-wrapper">
      <div className={pillClass} onClick={handleClick}>
        {renderContent()}
      </div>
    </div>
  )
}
