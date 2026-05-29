import { useState, useEffect, useRef } from 'react'
import SpotifySetup from './SpotifySetup'
import './SpotifyWidget.css'

interface Track {
  title: string
  artist: string
  albumArt: string
  albumArtSmall: string
  progress: number
  duration: number
}

interface LyricLine {
  time: number
  text: string
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function parseLyrics(lyricStr: string): LyricLine[] {
  const lines = lyricStr.split('\n')
  const result: LyricLine[] = []
  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2}\.\d{2,})\]\s*(.*)$/)
    if (match) {
      const min = parseInt(match[1])
      const sec = parseFloat(match[2])
      result.push({ time: (min * 60 + sec) * 1000, text: match[3] || ' ' })
    }
  }
  return result
}

export default function SpotifyWidget() {
  const [connected, setConnected] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [track, setTrack] = useState<Track | null>(null)
  
  const [connecting, setConnecting] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [clientId, setClientId] = useState('')
  const [redirectUri, setRedirectUri] = useState('https://127.0.0.1:18492/callback')
  const [configSaved, setConfigSaved] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [copied, setCopied] = useState(false)
  
  // Progress ticking
  const [localProgress, setLocalProgress] = useState(0)
  const lastSyncTimeRef = useRef(Date.now())
  
  // Volume state
  const [volume, setVolume] = useState(100)
  
  // Lyrics state
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  const [showLyrics, setShowLyrics] = useState(false)
  
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const api = (window as any).electronAPI

  const pollStatus = async () => {
    try {
      const status = await api?.getSpotifyStatus()
      if (!status) return
      setConnected(status.connected)
      if (status.connected && status.track) {
        setPlaying(status.playing)
        setVolume(status.volume || 100)
        
        // Only update track if it changed
        setTrack(prevTrack => {
          if (prevTrack?.title !== status.track.title || prevTrack?.artist !== status.track.artist) {
            fetchLyrics(status.track.title, status.track.artist, status.track.duration)
          }
          return status.track
        })
        
        // Sync local progress
        setLocalProgress(status.track.progress)
        lastSyncTimeRef.current = Date.now()
      } else if (status.connected) {
        setPlaying(false)
      }
    } catch { /* ignore */ }
  }

  const fetchLyrics = async (title: string, artist: string, duration: number) => {
    setLyrics([])
    try {
      const rawLyrics = await api?.getSpotifyLyrics(title, artist, duration)
      if (rawLyrics) {
        setLyrics(parseLyrics(rawLyrics))
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    api?.getSpotifyConfig().then((cfg: any) => {
      if (cfg?.clientId) {
        setClientId(cfg.clientId)
        setConfigSaved(true)
      }
      if (cfg?.redirectUri) setRedirectUri(cfg.redirectUri)
    })
    
    pollStatus()
    pollRef.current = setInterval(pollStatus, 3000)
    
    // Smooth progress tick every 500ms
    tickRef.current = setInterval(() => {
      setPlaying(isPlaying => {
        if (isPlaying) {
          setLocalProgress(prev => {
            const delta = Date.now() - lastSyncTimeRef.current
            // Cap the drift at what Spotify says + the elapsed time since last sync
            const estimated = prev + 500
            return estimated
          })
        }
        return isPlaying
      })
    }, 500)
    
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [])

  const handleConnect = async () => {
    if (!configSaved) {
      setShowSetup(true)
      return
    }
    setConnecting(true)
    setSetupError('')
    try {
      const result = await api?.spotifyLogin()
      if (result?.connected) {
        setConnected(true)
        setShowSetup(false)
        pollStatus()
      } else if (result?.error) {
        setSetupError(result.error)
        setShowSetup(true)
      }
    } catch { /* ignore */ }
    setConnecting(false)
  }

  const handleSaveConfig = async () => {
    if (!clientId.trim()) return
    await api?.setSpotifyConfig({ clientId: clientId.trim(), redirectUri: redirectUri.trim() })
    setConfigSaved(true)
    setSetupError('')
    setConnecting(true)
    try {
      const result = await api?.spotifyLogin()
      if (result?.connected) {
        setConnected(true)
        setShowSetup(false)
        pollStatus()
      } else if (result?.error) {
        setSetupError(result.error)
      }
    } catch { /* ignore */ }
    setConnecting(false)
  }

  const handlePlayPause = async () => {
    if (playing) await api?.spotifyPause()
    else await api?.spotifyPlay()
    setPlaying(!playing)
    setTimeout(pollStatus, 500)
  }

  const handleNext = async () => {
    await api?.spotifyNext()
    setTimeout(pollStatus, 500)
  }

  const handlePrev = async () => {
    await api?.spotifyPrevious()
    setTimeout(pollStatus, 500)
  }

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value)
    setVolume(v)
    await api?.setSpotifyVolume(v)
  }

  if (showSetup) {
    return (
      <SpotifySetup
        onClose={() => setShowSetup(false)}
        onConnected={() => {
          setConnected(true)
          setShowSetup(false)
          pollStatus()
        }}
      />
    )
  }

  if (!connected) {
    return (
      <div className="spotify-widget spotify-disconnected">
        <div className="spotify-icon-wrap">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
        </div>
        <div className="spotify-info">
          <div className="spotify-title">Spotify</div>
          <div className="spotify-artist">Connect to see what you're playing</div>
        </div>
        <button className="spotify-connect-btn" onClick={handleConnect} disabled={connecting}>
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    )
  }

  if (!track) {
    return (
      <div className="spotify-widget">
        <div className="spotify-icon-wrap spotify-icon-green">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
        </div>
        <div className="spotify-info">
          <div className="spotify-title">Connected</div>
          <div className="spotify-artist">Play something on Spotify</div>
        </div>
      </div>
    )
  }

  const boundedProgress = Math.min(localProgress, track.duration)
  const progressPct = track.duration > 0 ? (boundedProgress / track.duration) * 100 : 0

  // Calculate active lyric
  let activeLyricIndex = -1
  if (lyrics.length > 0) {
    for (let i = 0; i < lyrics.length; i++) {
      if (boundedProgress >= lyrics[i].time) {
        activeLyricIndex = i
      } else {
        break
      }
    }
  }

  return (
    <div className={`spotify-widget spotify-playing ${showLyrics ? 'spotify-lyrics-expanded' : ''}`}>
      <div className="spotify-main-row">
        {track.albumArt && (
          <div 
            className="spotify-art" 
            onClick={() => lyrics.length > 0 && setShowLyrics(!showLyrics)}
            data-has-lyrics={lyrics.length > 0}
          >
            <img src={track.albumArtSmall || track.albumArt} alt="" />
            {lyrics.length > 0 && (
              <div className="spotify-art-overlay">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {showLyrics ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
                </svg>
              </div>
            )}
          </div>
        )}
        
        <div className="spotify-info">
          <div className="spotify-title">{track.title}</div>
          <div className="spotify-artist">{track.artist}</div>
        </div>
        
        <div className="spotify-controls">
          <button className="spotify-ctrl" onClick={handlePrev}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polygon points="19 20 9 12 19 4" /><line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>
          <button className="spotify-ctrl spotify-play" onClick={handlePlayPause}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" fill="currentColor" />
                <rect x="14" y="4" width="4" height="16" fill="currentColor" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21" fill="currentColor" />
              </svg>
            )}
          </button>
          <button className="spotify-ctrl" onClick={handleNext}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polygon points="5 4 15 12 5 20" /><line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        </div>

        <div className="spotify-volume-wrapper">
          <div className="spotify-volume-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </div>
          <div className="spotify-volume-slider-container">
            <input 
              type="range" 
              className="spotify-volume-slider" 
              min="0" 
              max="100" 
              value={volume}
              onChange={handleVolumeChange}
              style={{ '--vol-pct': `${volume}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </div>
      
      {showLyrics && lyrics.length > 0 && (
        <div className="spotify-lyrics-container">
          <div 
            className="spotify-lyrics-scroll"
            style={{ transform: `translateY(-${Math.max(0, activeLyricIndex) * 24}px)` }}
          >
            {lyrics.map((lyric, idx) => {
              const isActive = idx === activeLyricIndex
              const isPassed = idx < activeLyricIndex
              
              return (
                <div 
                  key={idx} 
                  className={`spotify-lyric-line ${isActive ? 'active' : ''} ${isPassed ? 'passed' : ''}`}
                >
                  {lyric.text}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="spotify-progress">
        <span className="spotify-time">{formatTime(boundedProgress)}</span>
        <div className="spotify-bar">
          <div className="spotify-bar-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="spotify-time">{formatTime(track.duration)}</span>
      </div>
    </div>
  )
}
