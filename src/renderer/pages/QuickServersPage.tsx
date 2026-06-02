import React, { useState, useEffect, useRef, useCallback } from 'react'
import './QuickServers.css'
import qsBgImage from '../assets/quick-servers-bg.jpg'
import {
  getServers,
  createServer,
  deleteServer,
  startServer,
  stopServer,
  restartServer,
  sendCommand,
  getPrice,
  getTierLimits,
  getDomainSuffixes,
  createBackup,
  restoreBackup,
} from '../services/quick-servers-mock'
import type {
  QuickServer,
  ServerTier,
  ServerSoftware,
  ServerStatus,
  CreateServerConfig,
  Backup,
} from '../services/quick-servers-mock'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimeRemaining(expiresAt: number): string {
  const diff = expiresAt - Date.now()
  if (diff <= 0) return 'Expired'
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  if (days > 0) return `${days}d ${hours}h left`
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  return `${hours}h ${minutes}m left`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function tierLabel(tier: ServerTier): string {
  switch (tier) {
    case 'free': return 'FREE'
    case 'pro': return 'PRO'
    case 'proplus': return 'PRO+'
    case 'promax': return 'PRO MAX'
  }
}

function tierColor(tier: ServerTier): string {
  switch (tier) {
    case 'free': return '#30D158'
    case 'pro': return '#0A84FF'
    case 'proplus': return '#BF5AF2'
    case 'promax': return '#FFD60A'
  }
}

function statusColor(status: ServerStatus): string {
  switch (status) {
    case 'online': return '#30D158'
    case 'offline': return '#6e6e73'
    case 'starting': return '#FFD60A'
    case 'sleeping': return '#FF9F0A'
    case 'queued': return '#0A84FF'
  }
}

function softwareLabel(s: ServerSoftware): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type View = 'landing' | 'dashboard' | 'create' | 'control'
type PlayType = 'vanilla' | 'plugins' | 'modded'
type ControlTab = 'console' | 'players' | 'files' | 'plugins' | 'settings' | 'backups' | 'overview'

// ── Icons (Inline SVGs) ──────────────────────────────────────────────────────

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}
function RestartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}
function ArrowLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}
function ServerIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

// ── Usage Bar Component ──────────────────────────────────────────────────────

function UsageBar({ used, max, label, color }: { used: number; max: number; label: string; color: string }) {
  const pct = Math.min((used / max) * 100, 100)
  return (
    <div className="qs-usage-bar">
      <div className="qs-usage-bar-header">
        <span className="qs-usage-bar-label">{label}</span>
        <span className="qs-usage-bar-value">{used.toFixed(1)} / {max} GB</span>
      </div>
      <div className="qs-usage-bar-track">
        <div className="qs-usage-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const QuickServersPage: React.FC = () => {
  const [view, setView] = useState<View>('landing')
  const [servers, setServers] = useState<QuickServer[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedServer, setSelectedServer] = useState<QuickServer | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  // Load servers
  const loadServers = useCallback(async () => {
    try {
      const data = await getServers()
      setServers(data)
      // On initial load, decide which view to show
      if (!initialLoadDone) {
        setInitialLoadDone(true)
        if (data.length > 0) setView('dashboard')
        else setView('landing')
      }
      // Update selected server if viewing control panel
      if (selectedServer) {
        const updated = data.find(s => s.id === selectedServer.id)
        if (updated) setSelectedServer(updated)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [selectedServer, initialLoadDone])

  useEffect(() => {
    loadServers()
    const interval = setInterval(loadServers, 5000)
    return () => clearInterval(interval)
  }, [loadServers])

  // Server actions
  const handleStart = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setActionLoading(id)
    await startServer(id)
    await loadServers()
    setActionLoading(null)
  }
  const handleStop = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setActionLoading(id)
    await stopServer(id)
    await loadServers()
    setActionLoading(null)
  }
  const handleRestart = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setActionLoading(id)
    await restartServer(id)
    await loadServers()
    setActionLoading(null)
  }
  const handleDelete = async (id: string) => {
    setActionLoading(id)
    await deleteServer(id)
    await loadServers()
    setActionLoading(null)
    if (selectedServer?.id === id) {
      setView('dashboard')
      setSelectedServer(null)
    }
  }

  const openControl = (server: QuickServer) => {
    setSelectedServer(server)
    setView('control')
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="qs-page page-enter">
      {view === 'landing' && (
        <LandingPage
          onStart={() => setView('create')}
          onViewServers={() => setView('dashboard')}
          hasServers={servers.length > 0}
        />
      )}
      {view === 'dashboard' && (
        <DashboardView
          servers={servers}
          loading={loading}
          actionLoading={actionLoading}
          onCreateClick={() => setView('create')}
          onCardClick={openControl}
          onStart={handleStart}
          onStop={handleStop}
          onRestart={handleRestart}
          onUpgrade={() => setView('create')}
        />
      )}
      {view === 'create' && (
        <CreateWizard
          onBack={() => servers.length > 0 ? setView('dashboard') : setView('landing')}
          onCreated={async (server) => {
            setSelectedServer(server)
            await loadServers()
            setView('control')
          }}
        />
      )}
      {view === 'control' && selectedServer && (
        <ControlPanel
          server={selectedServer}
          actionLoading={actionLoading}
          onBack={() => { setView('dashboard'); setSelectedServer(null) }}
          onStart={handleStart}
          onStop={handleStop}
          onRestart={handleRestart}
          onDelete={handleDelete}
          onRefresh={loadServers}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LANDING PAGE — Conversion-optimized hero for new users
// Psychology: Future Self technique + Curiosity Gap + single high-contrast CTA
// ═══════════════════════════════════════════════════════════════════════════════

interface LandingProps {
  onStart: () => void
  onViewServers: () => void
  hasServers: boolean
}

function LandingPage({ onStart, onViewServers, hasServers }: LandingProps) {
  const [faqOpen, setFaqOpen] = useState(false)
  const [showComingSoon, setShowComingSoon] = useState(false)

  return (
    <div className="qs-landing">
      {/* Full-bleed background image */}
      <div className="qs-landing-bg">
        <img src={qsBgImage} alt="" className="qs-landing-bg-img" />
        <div className="qs-landing-overlay" />
      </div>

      {/* Upper zone — headline in the sky */}
      <div className="qs-landing-upper">
        <h1 className="qs-landing-headline">
          What would you build if you had<br />your own world tonight?
        </h1>
      </div>

      {/* Lower zone — CTA + FAQ on the ground */}
      <div className="qs-landing-lower">
        <button className="qs-landing-cta" onClick={() => setShowComingSoon(true)}>
          Make it POP
        </button>

        <div className="qs-landing-faq">
          <button
            className={`qs-landing-faq-toggle ${faqOpen ? 'qs-faq-open' : ''}`}
            onClick={() => setFaqOpen(!faqOpen)}
          >
            <span className="qs-faq-chevron">{faqOpen ? '▾' : '▸'}</span>
            What is quick servers?
          </button>
          {faqOpen && (
            <p className="qs-landing-faq-body">
              A whole Minecraft world, for less than a coffee, gone before you forget about it.
              Spin one up in seconds, invite your friends, play all week, walk away clean.
              No maintenance, no subscription. Its not a dog, so don't think about it.
            </p>
          )}
        </div>
      </div>

      {/* Credit link — bottom left, subtle */}
      <a
        href="https://goto.now/Q0B99"
        target="_blank"
        rel="noopener noreferrer"
        className="qs-landing-credit"
      >
        Credit
      </a>

      {/* Coming Soon — Liquid Glass */}
      {showComingSoon && (
        <div onClick={() => setShowComingSoon(false)} style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(10, 12, 18, 0.55)',
          backdropFilter: 'blur(60px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(60px) saturate(1.8)',
          cursor: 'pointer',
          animation: 'qs-fadein 0.4s ease',
        }}>
          {/* Specular highlight — top */}
          <div style={{
            position: 'absolute',
            top: '-20%',
            left: '30%',
            width: '40%',
            height: '50%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,0.04) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Glass card */}
          <div onClick={e => e.stopPropagation()} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            padding: '48px 56px',
            borderRadius: 28,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.06) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(255,255,255,0.02)',
            backdropFilter: 'blur(20px)',
            cursor: 'default',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
            <h2 style={{ fontSize: 24, fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: 0, letterSpacing: '-0.03em' }}>Coming Soon</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', margin: 0, textAlign: 'center', lineHeight: 1.6 }}>
              Quick Servers is currently in development.
            </p>
          </div>

          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', marginTop: 32, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Tap anywhere to dismiss</span>
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════════════════════

interface DashboardProps {
  servers: QuickServer[]
  loading: boolean
  actionLoading: string | null
  onCreateClick: () => void
  onCardClick: (server: QuickServer) => void
  onStart: (id: string, e?: React.MouseEvent) => void
  onStop: (id: string, e?: React.MouseEvent) => void
  onRestart: (id: string, e?: React.MouseEvent) => void
  onUpgrade: () => void
}

function DashboardView({ servers, loading, actionLoading, onCreateClick, onCardClick, onStart, onStop, onRestart, onUpgrade }: DashboardProps) {
  const hasFreeTier = servers.some(s => s.tier === 'free')

  return (
    <div className="qs-dashboard">
      <div className="qs-header">
        <div className="qs-header-left">
          <h1 className="qs-title">Quick Servers</h1>
          <span className="qs-server-count">{servers.length} server{servers.length !== 1 ? 's' : ''}</span>
        </div>
        <button className="qs-create-btn" onClick={onCreateClick}>
          <PlusIcon /> Create Server
        </button>
      </div>

      {loading ? (
        <div className="qs-loading">
          <div className="qs-spinner" />
          <span>Loading servers…</span>
        </div>
      ) : servers.length === 0 ? (
        <div className="qs-empty">
          <ServerIcon />
          <h2 className="qs-empty-title">No servers yet</h2>
          <p className="qs-empty-desc">Create your first Minecraft server in seconds. Free tier available!</p>
          <button className="qs-create-btn" onClick={onCreateClick}>
            <PlusIcon /> Create Your First Server
          </button>
        </div>
      ) : (
        <>
          <div className="qs-grid">
            {servers.map(server => {
              const timeLeft = server.expiresAt - Date.now()
              const urgent = timeLeft < 172_800_000 // 48h

              return (
                <div
                  className="qs-card"
                  key={server.id}
                  onClick={() => onCardClick(server)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onCardClick(server) }}
                >
                  <div className="qs-card-header">
                    <div className="qs-card-status">
                      <span
                        className={`qs-status-dot ${server.status === 'online' ? 'qs-status-pulse' : ''}`}
                        style={{ background: statusColor(server.status) }}
                      />
                      <span className="qs-status-label">{server.status}</span>
                    </div>
                    <span
                      className="qs-tier-badge"
                      style={{ background: `${tierColor(server.tier)}22`, color: tierColor(server.tier), borderColor: `${tierColor(server.tier)}44` }}
                    >
                      {tierLabel(server.tier)}
                    </span>
                  </div>

                  <h3 className="qs-card-name">{server.name}</h3>
                  <div className="qs-card-domain">{server.domain}:{server.port}</div>

                  <div className="qs-card-stats">
                    <div className="qs-card-stat">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                      <span>{server.players.online}/{server.players.max} players</span>
                    </div>
                    <div className="qs-card-stat">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
                      <span>{server.ram}GB RAM</span>
                    </div>
                  </div>

                  <UsageBar used={server.storage.used} max={server.storage.max} label="Storage" color={tierColor(server.tier)} />

                  <div className="qs-card-footer">
                    <span className={`qs-time-badge ${urgent ? 'qs-time-urgent' : ''}`}>
                      {formatTimeRemaining(server.expiresAt)}
                    </span>
                    <div className="qs-card-actions" onClick={e => e.stopPropagation()}>
                      {server.status === 'offline' ? (
                        <button
                          className="qs-action-btn qs-action-start"
                          onClick={e => onStart(server.id, e)}
                          disabled={actionLoading === server.id}
                          title="Start"
                        >
                          <PlayIcon />
                        </button>
                      ) : server.status === 'online' ? (
                        <>
                          <button
                            className="qs-action-btn qs-action-stop"
                            onClick={e => onStop(server.id, e)}
                            disabled={actionLoading === server.id}
                            title="Stop"
                          >
                            <StopIcon />
                          </button>
                          <button
                            className="qs-action-btn qs-action-restart"
                            onClick={e => onRestart(server.id, e)}
                            disabled={actionLoading === server.id}
                            title="Restart"
                          >
                            <RestartIcon />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {hasFreeTier && (
            <div className="qs-ad-banner">
              <span className="qs-ad-label">Ad</span>
              <div className="qs-ad-content">
                <span className="qs-ad-text">Upgrade to Pro for more RAM, mod support, and custom domains</span>
                <button className="qs-ad-cta" onClick={onUpgrade}>Upgrade →</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE WIZARD
// ═══════════════════════════════════════════════════════════════════════════════

const WIZARD_STEPS = ['Play Type', 'Plan', 'Configure', 'Name & Domain', 'Checkout']
const MC_VERSIONS = ['1.21.1', '1.20.4', '1.20.1']

interface CreateWizardProps {
  onBack: () => void
  onCreated: (server: QuickServer) => void
}

function CreateWizard({ onBack, onCreated }: CreateWizardProps) {
  const [step, setStep] = useState(0)
  const [playType, setPlayType] = useState<PlayType | null>(null)
  const [tier, setTier] = useState<ServerTier | null>(null)
  const [ram, setRam] = useState(2)
  const [duration, setDuration] = useState(7)
  const [software, setSoftware] = useState<ServerSoftware>('paper')
  const [mcVersion, setMcVersion] = useState('1.21.1')
  const [serverName, setServerName] = useState('')
  const [domainName, setDomainName] = useState('')
  const [domainSuffix, setDomainSuffix] = useState('')
  const [price, setPrice] = useState(0)
  const [creating, setCreating] = useState(false)
  const [nameError, setNameError] = useState('')

  // Update price
  useEffect(() => {
    if (!tier) return
    getPrice(tier, ram, duration).then(setPrice)
  }, [tier, ram, duration])

  // Set defaults when tier changes
  useEffect(() => {
    if (!tier) return
    const limits = getTierLimits(tier)
    setRam(limits.ramOptions[0])
    setDuration(limits.durationOptions[0])
    setSoftware(limits.softwareOptions[0])
    const suffixes = getDomainSuffixes(tier)
    setDomainSuffix(suffixes[0])
  }, [tier])

  const canNext = (): boolean => {
    switch (step) {
      case 0: return playType !== null
      case 1: return tier !== null
      case 2: return true
      case 3: return serverName.length >= 3 && serverName.length <= 16 && /^[a-zA-Z0-9-]+$/.test(serverName) && domainName.length >= 3
      case 4: return true
      default: return false
    }
  }

  const handleNext = () => {
    if (step < 4) setStep(step + 1)
  }

  const handleLaunch = async () => {
    if (!tier) return
    setCreating(true)
    try {
      const config: CreateServerConfig = {
        name: serverName,
        tier,
        software,
        mcVersion,
        ram,
        duration,
        domain: domainName,
        domainSuffix,
      }
      const newServer = await createServer(config)
      onCreated(newServer)
    } catch {
      setCreating(false)
    }
  }

  const validateName = (val: string) => {
    setServerName(val)
    if (val.length > 0 && val.length < 3) setNameError('Name must be at least 3 characters')
    else if (val.length > 16) setNameError('Name must be 16 characters or less')
    else if (val.length > 0 && !/^[a-zA-Z0-9-]+$/.test(val)) setNameError('Only letters, numbers, and hyphens allowed')
    else setNameError('')
  }

  const limits = tier ? getTierLimits(tier) : null
  const suffixes = tier ? getDomainSuffixes(tier) : []

  // Step icon SVGs for the progress bar
  const stepIcons = [
    // Step 1: Gamepad
    <svg key="s1" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>,
    // Step 2: Tag/price
    <svg key="s2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
    // Step 3: Gear
    <svg key="s3" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    // Step 4: Edit / pencil
    <svg key="s4" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    // Step 5: Checkmark
    <svg key="s5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  ]

  const stepSubtitles = [
    'Choose your server type to get started',
    'Select the plan that fits your needs',
    'Customize RAM, duration, and software',
    'Give your server a name and address',
    'Review your order and launch',
  ]

  return (
    <div className="qs-wizard">
      <div className="qs-wizard-header">
        <button className="qs-back-btn" onClick={onBack}>
          <ArrowLeftIcon /> <span>Back</span>
        </button>
      </div>

      {/* ── Step Progress Bar ──────────────────────────────────────── */}
      <div className="qs-steps">
        {WIZARD_STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div className={`qs-step ${i === step ? 'qs-step-active' : ''} ${i < step ? 'qs-step-done' : ''}`}>
              <div className="qs-step-circle">
                {i < step ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  stepIcons[i]
                )}
              </div>
              <span className="qs-step-label">{label}</span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div className={`qs-step-line ${i < step ? 'qs-step-line-done' : ''}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Thin proportional progress bar */}
      <div style={{
        width: '100%',
        maxWidth: 560,
        height: 3,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.06)',
        margin: '0 auto 8px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${((step) / (WIZARD_STEPS.length - 1)) * 100}%`,
          height: '100%',
          borderRadius: 2,
          background: 'linear-gradient(90deg, #10B981, #059669)',
          transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 0 8px rgba(16,185,129,0.4)',
        }} />
      </div>

      {/* Step header info */}
      <div style={{
        textAlign: 'center',
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-2)',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.1em',
          marginBottom: 6,
        }}>
          Step {step + 1} of {WIZARD_STEPS.length}
        </div>
        <h2 style={{
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--text-0)',
          margin: '0 0 4px',
        }}>
          {step === 0 && 'How do you want to play?'}
          {step === 1 && 'Choose your plan'}
          {step === 2 && 'Configure your server'}
          {step === 3 && 'Name your world'}
          {step === 4 && "You're almost there!"}
        </h2>
        <p style={{
          fontSize: 14,
          color: 'var(--text-2)',
          margin: 0,
        }}>
          {stepSubtitles[step]}
        </p>
      </div>

      {/* ── Step Content ───────────────────────────────────────────── */}
      <div className="qs-step-content" key={step}>

        {/* ════ Step 1: Play Type ════ */}
        {step === 0 && (
          <div className="qs-play-type-grid">
            {([
              {
                type: 'vanilla' as PlayType,
                icon: (
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="1.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                ),
                title: 'Vanilla',
                emoji: '🎮',
                desc: 'The pure, unmodified Minecraft experience. Perfect for survival, creative, or playing with friends.',
                color: '#30D158',
              },
              {
                type: 'plugins' as PlayType,
                icon: (
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF453A" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                  </svg>
                ),
                title: 'Plugins',
                emoji: '🔌',
                desc: 'Extend your server with Paper or Spigot plugins. Minigames, economy, permissions, and more.',
                color: '#FF453A',
              },
              {
                type: 'modded' as PlayType,
                icon: (
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#BF5AF2" strokeWidth="1.5">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                ),
                title: 'Modded',
                emoji: '⚡',
                desc: 'Full Forge or Fabric mod support. Run modpacks, custom dimensions, and total overhauls.',
                color: '#BF5AF2',
              },
            ]).map(card => (
              <div
                key={card.type}
                className={`qs-play-card ${playType === card.type ? 'qs-play-card-active' : ''}`}
                onClick={() => setPlayType(card.type)}
              >
                <div className="qs-play-icon">
                  {card.icon}
                </div>
                <h3 className="qs-play-title">{card.emoji} {card.title}</h3>
                <p className="qs-play-desc">{card.desc}</p>
                {/* Select / Selected CTA */}
                <div style={{
                  marginTop: 'auto',
                  paddingTop: 14,
                  width: '100%',
                  textAlign: 'center',
                }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 20px',
                    borderRadius: 'var(--qs-radius-sm)',
                    fontSize: 13,
                    fontWeight: 600,
                    transition: 'all 150ms ease',
                    ...(playType === card.type
                      ? {
                          background: 'rgba(16,185,129,0.15)',
                          color: '#10B981',
                          border: '1px solid rgba(16,185,129,0.3)',
                        }
                      : {
                          background: 'rgba(255,255,255,0.04)',
                          color: 'var(--text-2)',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }),
                  }}>
                    {playType === card.type ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Selected
                      </>
                    ) : 'Select'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ════ Step 2: Choose Plan ════ */}
        {step === 1 && (
          <div className="qs-plan-grid">
            {([
              {
                id: 'free' as ServerTier,
                name: 'Free',
                desc: 'Try it out, no strings attached',
                priceText: '$0',
                period: '',
                color: '#30D158',
                features: ['2GB RAM', '10 players', '7-day duration', 'Paper / Spigot / Vanilla', 'Basic DDoS protection'],
                cta: 'Start Free',
                disabled: playType === 'modded',
                recommended: false,
              },
              {
                id: 'pro' as ServerTier,
                name: 'Pro',
                desc: 'More power for serious play',
                priceText: '$2.50',
                period: '/wk',
                color: '#0A84FF',
                features: ['3–10GB RAM', '15 players', 'Full mod support', 'Custom domains', 'Auto backups', 'Email support'],
                cta: 'Choose Pro',
                disabled: false,
                recommended: false,
              },
              {
                id: 'proplus' as ServerTier,
                name: 'Pro Plus',
                desc: 'Best performance for communities',
                priceText: '$8.00',
                period: '/wk',
                color: '#BF5AF2',
                features: ['8–16GB RAM', 'Unlimited players', 'Dedicated CPU core', 'Scheduled backups', 'Priority support', '24/7 uptime option'],
                cta: 'Choose Pro+',
                disabled: false,
                recommended: true,
              },
              {
                id: 'promax' as ServerTier,
                name: 'Pro Max',
                desc: 'Enterprise-grade infrastructure',
                priceText: '$40',
                period: '/mo',
                color: '#FFD60A',
                features: ['16–32GB RAM', 'Unlimited everything', 'Dedicated CPU cores', 'Premium domains', 'Unlimited backups', 'SLA guarantee'],
                cta: 'Choose Pro Max',
                disabled: false,
                recommended: false,
              },
            ]).map(plan => (
              <div
                key={plan.id}
                className={`qs-plan-card ${tier === plan.id ? 'qs-plan-active' : ''} ${plan.disabled ? 'qs-plan-disabled' : ''}`}
                onClick={() => { if (!plan.disabled) setTier(plan.id) }}
                style={{ '--plan-color': plan.color } as React.CSSProperties}
              >
                {plan.disabled && <div className="qs-plan-disabled-label">Mods require Pro or higher</div>}
                {plan.recommended && <span className="qs-plan-recommended">✦ BEST VALUE</span>}

                <div className="qs-plan-header-area">
                  {/* Name with colored dot */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: plan.color,
                      boxShadow: `0 0 8px ${plan.color}44`,
                      flexShrink: 0,
                    }} />
                    <h3 className="qs-plan-name">{plan.name}</h3>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '4px 0 8px' }}>{plan.desc}</p>
                  <span className="qs-plan-price">
                    {plan.priceText}
                    {plan.period && <span className="qs-plan-period">{plan.period}</span>}
                  </span>
                </div>

                <ul className="qs-plan-features">
                  {plan.features.map(f => <li key={f}>{f}</li>)}
                </ul>

                {/* CTA button at bottom */}
                <div style={{ marginTop: 'auto', paddingTop: 16 }}>
                  <span style={{
                    display: 'block',
                    textAlign: 'center',
                    padding: '10px 0',
                    borderRadius: 'var(--qs-radius-sm)',
                    fontSize: 13,
                    fontWeight: 600,
                    transition: 'all 150ms ease',
                    ...(tier === plan.id
                      ? {
                          background: `${plan.color}22`,
                          color: plan.color,
                          border: `1px solid ${plan.color}55`,
                        }
                      : {
                          background: 'rgba(255,255,255,0.04)',
                          color: 'var(--text-2)',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }),
                  }}>
                    {tier === plan.id ? '✓ Selected' : plan.cta}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ════ Step 3: Configure ════ */}
        {step === 2 && limits && (
          <div className="qs-configure">
            <div className="qs-config-row">
              <div className="qs-config-group">
                <label className="qs-config-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 6, opacity: 0.5 }}><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                  RAM
                </label>
                <div className="qs-ram-options">
                  {limits.ramOptions.map(r => (
                    <button
                      key={r}
                      className={`qs-ram-btn ${ram === r ? 'qs-ram-active' : ''}`}
                      onClick={() => setRam(r)}
                    >
                      {r}GB
                    </button>
                  ))}
                </div>
              </div>

              <div className="qs-config-group">
                <label className="qs-config-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 6, opacity: 0.5 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Duration
                </label>
                <div className="qs-duration-options">
                  {limits.durationOptions.map(d => (
                    <button
                      key={d}
                      className={`qs-duration-btn ${duration === d ? 'qs-duration-active' : ''}`}
                      onClick={() => setDuration(d)}
                    >
                      {tier === 'promax' ? 'Monthly' : `${d} days`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="qs-config-row">
              <div className="qs-config-group">
                <label className="qs-config-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 6, opacity: 0.5 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                  Software
                </label>
                <select
                  className="qs-select"
                  value={software}
                  onChange={e => setSoftware(e.target.value as ServerSoftware)}
                >
                  {limits.softwareOptions.map(s => (
                    <option key={s} value={s}>{softwareLabel(s)}</option>
                  ))}
                </select>
              </div>

              <div className="qs-config-group">
                <label className="qs-config-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 6, opacity: 0.5 }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                  Minecraft Version
                </label>
                <select
                  className="qs-select"
                  value={mcVersion}
                  onChange={e => setMcVersion(e.target.value)}
                >
                  {MC_VERSIONS.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Live price card */}
            <div className="qs-price-display" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 24px',
              borderRadius: 'var(--qs-radius)',
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              backdropFilter: 'blur(12px)',
            }}>
              <span className="qs-price-label" style={{ fontSize: 14, fontWeight: 600 }}>
                {tier === 'free' ? '🎉 Free tier selected' : '💰 Estimated total'}
              </span>
              <span className="qs-price-value" style={{ fontSize: 32 }}>
                {tier === 'free' ? (
                  <span style={{ color: '#10B981', textShadow: '0 0 20px rgba(16,185,129,0.25)' }}>Free</span>
                ) : (
                  <>
                    ${price.toFixed(2)}
                    {tier === 'promax'
                      ? <span className="qs-price-suffix">/month</span>
                      : <span className="qs-price-suffix">/{duration} days</span>
                    }
                  </>
                )}
              </span>
            </div>
          </div>
        )}

        {/* ════ Step 4: Name & Domain ════ */}
        {step === 3 && (
          <div className="qs-naming">
            <div className="qs-config-group">
              <label className="qs-config-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 6, opacity: 0.5 }}><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                Server Name
              </label>
              <input
                className={`qs-input ${nameError ? 'qs-input-error' : ''}`}
                type="text"
                value={serverName}
                onChange={e => validateName(e.target.value)}
                placeholder="my-awesome-server"
                maxLength={16}
              />
              {nameError && <span className="qs-error-text">{nameError}</span>}
              <span className="qs-hint-text">3–16 characters, letters, numbers, and hyphens only</span>
            </div>

            <div className="qs-config-group">
              <label className="qs-config-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 6, opacity: 0.5 }}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                Domain
              </label>
              <div className="qs-domain-input-row">
                <input
                  className="qs-input qs-domain-input"
                  type="text"
                  value={domainName}
                  onChange={e => setDomainName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="yourserver"
                  maxLength={24}
                />
                <span className="qs-domain-dot">.</span>
                <select
                  className="qs-select qs-domain-suffix-select"
                  value={domainSuffix}
                  onChange={e => setDomainSuffix(e.target.value)}
                >
                  {suffixes.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {domainName && (
                <div className="qs-domain-preview">
                  <span className="qs-domain-preview-label">Your server address:</span>
                  <span className="qs-domain-preview-value">{domainName}.{domainSuffix}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════ Step 5: Checkout — Two-Column Layout ════ */}
        {step === 4 && (
          <div className="qs-checkout">
            {creating ? (
              <div className="qs-creating">
                <div className="qs-spinner qs-spinner-large" />
                <h2 className="qs-creating-title">Setting up your world…</h2>
                <p className="qs-creating-desc">Your server is being provisioned. This takes a moment.</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr',
                gap: 24,
                width: '100%',
                alignItems: 'start',
              }}>
                {/* ── Left Column: Details ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                  {/* Section 1: Server Details */}
                  <div className="qs-checkout-card">
                    <div className="qs-checkout-header">
                      <h2 className="qs-checkout-title" style={{ fontSize: 15 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, marginRight: 8, opacity: 0.6 }}><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                        Server Details
                      </h2>
                    </div>
                    <div className="qs-checkout-lines">
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">Server Name</span>
                        <span className="qs-checkout-line-value" style={{ color: 'var(--text-0)', fontWeight: 600 }}>{serverName}</span>
                      </div>
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">Software</span>
                        <span className="qs-checkout-line-value">{softwareLabel(software)} · {mcVersion}</span>
                      </div>
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">Tier</span>
                        <span className="qs-tier-badge" style={{
                          background: tier ? `${tierColor(tier)}22` : undefined,
                          color: tier ? tierColor(tier) : undefined,
                          borderColor: tier ? `${tierColor(tier)}44` : undefined,
                          fontSize: 11,
                          padding: '3px 10px',
                        }}>
                          {tier ? tierLabel(tier) : ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Configuration */}
                  <div className="qs-checkout-card">
                    <div className="qs-checkout-header">
                      <h2 className="qs-checkout-title" style={{ fontSize: 15 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, marginRight: 8, opacity: 0.6 }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                        Configuration
                      </h2>
                    </div>
                    <div className="qs-checkout-lines">
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">RAM</span>
                        <span className="qs-checkout-line-value" style={{ color: 'var(--text-0)' }}>{ram}GB</span>
                      </div>
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">Duration</span>
                        <span className="qs-checkout-line-value" style={{ color: 'var(--text-0)' }}>
                          {tier === 'promax' ? 'Monthly subscription' : `${duration} days`}
                        </span>
                      </div>
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">Domain</span>
                        <span className="qs-checkout-line-value" style={{
                          color: 'var(--qs-free)',
                          fontFamily: 'var(--font-mono, monospace)',
                          fontWeight: 600,
                        }}>
                          {domainName}.{domainSuffix}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Payment */}
                  <div className="qs-checkout-card">
                    <div className="qs-checkout-header">
                      <h2 className="qs-checkout-title" style={{ fontSize: 15 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -3, marginRight: 8, opacity: 0.6 }}><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                        Payment
                      </h2>
                      <span className="qs-checkout-secure">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                        Secure
                      </span>
                    </div>
                    <div style={{ padding: '16px 24px' }}>
                      {tier === 'free' ? (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '12px 16px',
                          borderRadius: 'var(--qs-radius-sm)',
                          background: 'rgba(16,185,129,0.08)',
                          border: '1px solid rgba(16,185,129,0.15)',
                        }}>
                          <span style={{ fontSize: 20 }}>🎉</span>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#10B981' }}>No payment needed</div>
                            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Your free server will be ready in seconds</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '12px 16px',
                          borderRadius: 'var(--qs-radius-sm)',
                          background: 'var(--qs-surface-0)',
                          border: '1px solid var(--glass-border)',
                        }}>
                          <span style={{ fontSize: 20 }}>🔒</span>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>Secured by Stripe</div>
                            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Clicking Launch will open Stripe checkout in your browser</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Right Column: Order Summary ── */}
                <div style={{ position: 'sticky', top: 24 }}>
                  <div className="qs-checkout-card">
                    <div className="qs-checkout-header">
                      <h2 className="qs-checkout-title" style={{ fontSize: 15 }}>Order Summary</h2>
                    </div>

                    <div className="qs-checkout-lines">
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">{softwareLabel(software)} Server · {mcVersion}</span>
                        <span className="qs-checkout-line-value">{tier === 'free' ? 'Included' : ''}</span>
                      </div>
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">{ram}GB RAM</span>
                        <span className="qs-checkout-line-value">{tier === 'free' ? 'Included' : ''}</span>
                      </div>
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">{tier === 'promax' ? 'Monthly subscription' : `${duration}-day duration`}</span>
                        <span className="qs-checkout-line-value">{tier === 'free' ? 'Included' : ''}</span>
                      </div>
                      <div className="qs-checkout-line">
                        <span className="qs-checkout-line-label">DDoS Protection</span>
                        <span className="qs-checkout-line-value" style={{ color: 'var(--qs-free)' }}>Included</span>
                      </div>
                      {tier !== 'free' && (
                        <div className="qs-checkout-line">
                          <span className="qs-checkout-line-label">Custom Domain</span>
                          <span className="qs-checkout-line-value" style={{ color: 'var(--qs-free)' }}>Included</span>
                        </div>
                      )}
                      {(tier === 'pro' || tier === 'proplus' || tier === 'promax') && (
                        <div className="qs-checkout-line">
                          <span className="qs-checkout-line-label">Automated Backups</span>
                          <span className="qs-checkout-line-value" style={{ color: 'var(--qs-free)' }}>Included</span>
                        </div>
                      )}
                    </div>

                    <div className="qs-checkout-divider" />

                    <div className="qs-checkout-total">
                      <span className="qs-checkout-total-label">Total</span>
                      <span className="qs-checkout-total-value">
                        {tier === 'free' ? (
                          <span className="qs-checkout-free">FREE</span>
                        ) : (
                          <>
                            <span className="qs-checkout-amount">${price.toFixed(2)}</span>
                            <span className="qs-checkout-period">{tier === 'promax' ? '/month' : `/${duration} days`}</span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* CTA Button */}
                  <button className="qs-checkout-cta" onClick={handleLaunch} style={{ marginTop: 16 }}>
                    {tier === 'free' ? '🚀 Launch My Server' : `🚀 Pay $${price.toFixed(2)} & Launch`}
                  </button>

                  {/* Trust signals */}
                  <div className="qs-checkout-trust" style={{ marginTop: 12 }}>
                    {tier === 'free' ? (
                      <span>✓ No credit card required · Server live in seconds</span>
                    ) : (
                      <span>✓ 48-hour money-back guarantee · No contracts, ever</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Navigation Buttons ─────────────────────────────────────── */}
      {!creating && step < 4 && (
        <div className="qs-wizard-nav">
          {step > 0 && (
            <button className="qs-nav-btn qs-nav-prev" onClick={() => setStep(step - 1)}>
              <ArrowLeftIcon /> Back
            </button>
          )}
          <button className="qs-nav-btn qs-nav-next" onClick={handleNext} disabled={!canNext()}>
            {step === 3 ? 'Review Order' : 'Continue'} <ChevronRightIcon />
          </button>
        </div>
      )}
      {/* Back-only nav on checkout step */}
      {!creating && step === 4 && (
        <div className="qs-wizard-nav">
          <button className="qs-nav-btn qs-nav-prev" onClick={() => setStep(step - 1)}>
            <ArrowLeftIcon /> Back
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROL PANEL
// ═══════════════════════════════════════════════════════════════════════════════

interface ControlPanelProps {
  server: QuickServer
  actionLoading: string | null
  onBack: () => void
  onStart: (id: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: () => void
}

function ControlPanel({ server, actionLoading, onBack, onStart, onStop, onRestart, onDelete, onRefresh }: ControlPanelProps) {
  const [tab, setTab] = useState<ControlTab>('console')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cpuUsage, setCpuUsage] = useState(0)
  const [ramUsed, setRamUsed] = useState(0)

  useEffect(() => {
    const update = () => {
      if (server.status === 'online') {
        setCpuUsage(parseFloat((15 + Math.random() * 25).toFixed(1)))
        setRamUsed(Math.round(server.ram * 1024 * (0.3 + Math.random() * 0.35)))
      } else {
        setCpuUsage(0)
        setRamUsed(0)
      }
    }
    update()
    const interval = setInterval(update, 5000)
    return () => clearInterval(interval)
  }, [server.status, server.ram])

  const ramMax = server.ram * 1024
  const diskUsed = server.storage.used
  const diskMax = server.storage.max

  const tabs: { key: ControlTab; label: string; icon: React.ReactNode }[] = [
    { key: 'console', label: 'Console', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
    )},
    { key: 'players', label: 'Players', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    )},
    { key: 'files', label: 'Files', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    )},
    { key: 'plugins', label: 'Plugins', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
    )},
    { key: 'settings', label: 'Settings', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    )},
    { key: 'backups', label: 'Backups', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    )},
    { key: 'overview', label: 'Overview', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    )},
  ]

  return (
    <div className="qs-dashboard-layout">
      {/* ── Left Sidebar ── */}
      <div className="qs-dashboard-sidebar">
        {/* Back button */}
        <button className="qs-back-btn" onClick={onBack} style={{ padding: '8px 0', marginBottom: 4 }}>
          <ArrowLeftIcon /> <span>Servers</span>
        </button>

        {/* Server Identity */}
        <div className="qs-dashboard-sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className={`qs-status-dot ${server.status === 'online' ? 'qs-status-pulse' : ''}`}
              style={{ background: statusColor(server.status), width: 10, height: 10 }}
            />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-0)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{server.name}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span className="qs-status-label" style={{ color: statusColor(server.status), fontSize: 11, textTransform: 'capitalize' }}>{server.status}</span>
            <span className="qs-tier-badge" style={{ background: `${tierColor(server.tier)}22`, color: tierColor(server.tier), borderColor: `${tierColor(server.tier)}44`, fontSize: 9, padding: '2px 8px' }}>
              {tierLabel(server.tier)}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="qs-dashboard-sidebar-nav">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`qs-dashboard-nav-item ${tab === t.key ? 'qs-dashboard-nav-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--glass-border)', margin: '8px 0' }} />

        {/* Action Buttons */}
        <div className="qs-dashboard-sidebar-actions">
          {server.status === 'offline' ? (
            <button className="qs-ctrl-btn qs-ctrl-start" onClick={() => onStart(server.id)} disabled={actionLoading === server.id}>
              <PlayIcon /> Start
            </button>
          ) : server.status === 'online' ? (
            <>
              <button className="qs-ctrl-btn qs-ctrl-stop" onClick={() => onStop(server.id)} disabled={actionLoading === server.id}>
                <StopIcon /> Stop
              </button>
              <button className="qs-ctrl-btn qs-ctrl-restart" onClick={() => onRestart(server.id)} disabled={actionLoading === server.id}>
                <RestartIcon /> Restart
              </button>
            </>
          ) : (
            <span className="qs-ctrl-status-text">
              {server.status === 'starting' ? 'Starting…' : server.status}
            </span>
          )}

          {/* Delete */}
          {confirmDelete ? (
            <div className="qs-delete-confirm">
              <span>Delete this server?</span>
              <button className="qs-delete-yes" onClick={() => onDelete(server.id)}>Yes, delete</button>
              <button className="qs-delete-no" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button className="qs-ctrl-btn qs-ctrl-delete" onClick={() => setConfirmDelete(true)} title="Delete server">
              <TrashIcon /> Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="qs-dashboard-main">
        {/* Stats Bar */}
        <div className="qs-dashboard-stats">
          <div className="qs-dashboard-stat-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--qs-free)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span className="qs-dashboard-stat-label">Players</span>
            <span className="qs-dashboard-stat-value">{server.players.list.length}<span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 400 }}>/{server.players.max}</span></span>
          </div>
          <div className="qs-dashboard-stat-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--qs-pro)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <span className="qs-dashboard-stat-label">CPU</span>
            <span className="qs-dashboard-stat-value">{cpuUsage.toFixed(1)}<span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 400 }}>%</span></span>
          </div>
          <div className="qs-dashboard-stat-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--qs-proplus)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            <span className="qs-dashboard-stat-label">RAM</span>
            <span className="qs-dashboard-stat-value">{ramUsed}<span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 400 }}> / {ramMax} MB</span></span>
          </div>
          <div className="qs-dashboard-stat-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--qs-promax)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
            <span className="qs-dashboard-stat-label">Disk</span>
            <span className="qs-dashboard-stat-value">{diskUsed.toFixed(1)}<span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 400 }}> / {diskMax} GB</span></span>
          </div>
        </div>

        {/* Tab Content */}
        <div className="qs-tab-content">
          {tab === 'console' && <ConsoleTab server={server} onRefresh={onRefresh} />}
          {tab === 'players' && <PlayersTab server={server} />}
          {tab === 'files' && <FilesTab server={server} />}
          {tab === 'plugins' && <PluginsTab server={server} />}
          {tab === 'settings' && <SettingsTab server={server} />}
          {tab === 'backups' && <BackupsTab server={server} onRefresh={onRefresh} />}
          {tab === 'overview' && <OverviewTab server={server} />}
        </div>
      </div>
    </div>
  )
}

// ── Console Tab ──────────────────────────────────────────────────────────────

function ConsoleTab({ server, onRefresh }: { server: QuickServer; onRefresh: () => void }) {
  const [cmd, setCmd] = useState('')
  const [sending, setSending] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [server.consoleLog.length])

  const handleSend = async () => {
    if (!cmd.trim() || sending) return
    setSending(true)
    try {
      await sendCommand(server.id, cmd.trim())
      setCmd('')
      await onRefresh()
    } catch {
      // ignore
    } finally {
      setSending(false)
    }
  }

  const getLogLineClass = (line: string): string => {
    if (line.includes('/WARN]') || line.includes('[WARN]')) return 'qs-log-warn'
    if (line.includes('/ERROR]') || line.includes('[ERROR]')) return 'qs-log-error'
    if (line.includes('> ')) return 'qs-log-cmd'
    return 'qs-log-info'
  }

  return (
    <div className="qs-console">
      <div className="qs-console-log">
        {server.consoleLog.map((line, i) => (
          <div key={i} className={`qs-log-line ${getLogLineClass(line)}`}>
            {line}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
      <div className="qs-console-input-row">
        <span className="qs-console-prompt">&gt;</span>
        <input
          className="qs-console-input"
          type="text"
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
          placeholder={server.status === 'online' ? 'Type a command…' : 'Server is offline'}
          disabled={server.status !== 'online' || sending}
        />
        <button className="qs-console-send" onClick={handleSend} disabled={server.status !== 'online' || !cmd.trim() || sending}>
          <SendIcon />
        </button>
      </div>
    </div>
  )
}

// ── Players Tab ─────────────────────────────────────────────────────────────

function PlayersTab({ server }: { server: QuickServer }) {
  if (server.players.list.length === 0) {
    return (
      <div className="qs-empty-tab">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <h3>No players online</h3>
        <p>Players will appear here when they join your server.</p>
      </div>
    )
  }

  return (
    <div className="qs-players">
      <table className="qs-players-table">
        <thead>
          <tr>
            <th></th>
            <th>Player</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {server.players.list.map(player => (
            <tr key={player}>
              <td>
                <div className="qs-player-avatar">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="1.5">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="8" y="8" width="3" height="3" fill="var(--text-2)" />
                    <rect x="13" y="8" width="3" height="3" fill="var(--text-2)" />
                    <rect x="9" y="14" width="6" height="2" fill="var(--text-2)" />
                  </svg>
                </div>
              </td>
              <td className="qs-player-name">{player}</td>
              <td>
                <div className="qs-player-actions">
                  <button className="qs-player-action-btn" title="Kick player" onClick={() => sendCommand(server.id, `kick ${player}`)}>Kick</button>
                  <button className="qs-player-action-btn qs-player-ban" title="Ban player" onClick={() => sendCommand(server.id, `ban ${player}`)}>Ban</button>
                  <button className="qs-player-action-btn qs-player-op" title="Make operator" onClick={() => sendCommand(server.id, `op ${player}`)}>Op</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Settings Tab ────────────────────────────────────────────────────────────

function SettingsTab({ server }: { server: QuickServer }) {
  // ── Save state ──
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    // Simulate saving to server.properties
    await new Promise(r => setTimeout(r, 1200))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  // ── Crossplay ──
  const [bedrockCrossplay, setBedrockCrossplay] = useState(false)
  const [bedrockPort, setBedrockPort] = useState(19132)

  // ── General ──
  const [motd, setMotd] = useState(server.name)
  const [gameMode, setGameMode] = useState('survival')
  const [difficulty, setDifficulty] = useState('normal')
  const [hardcore, setHardcore] = useState(false)

  // ── Players ──
  const [maxPlayers, setMaxPlayers] = useState(server.players.max)
  const [pvp, setPvp] = useState(true)
  const [allowFlight, setAllowFlight] = useState(false)
  const [forceGamemode, setForceGamemode] = useState(false)
  const [playerIdleTimeout, setPlayerIdleTimeout] = useState(0)
  const [whitelist, setWhitelist] = useState(false)
  const [onlineMode, setOnlineMode] = useState(true)

  // ── World ──
  const [viewDistance, setViewDistance] = useState(10)
  const [simulationDistance, setSimulationDistance] = useState(10)
  const [spawnProtection, setSpawnProtection] = useState(16)
  const [worldType, setWorldType] = useState('normal')
  const [generateStructures, setGenerateStructures] = useState(true)
  const [allowNether, setAllowNether] = useState(true)
  const [seed, setSeed] = useState('')
  const [levelName, setLevelName] = useState('world')

  // ── Performance ──
  const [commandBlocks, setCommandBlocks] = useState(false)
  const [entityBroadcastRange, setEntityBroadcastRange] = useState(100)
  const [maxTickTime, setMaxTickTime] = useState(60000)
  const [networkCompression, setNetworkCompression] = useState(256)

  // ── Security ──
  const [enableRcon, setEnableRcon] = useState(false)
  const [rconPassword, setRconPassword] = useState('')
  const [rconPort, setRconPort] = useState(25575)
  const [serverPort, setServerPort] = useState(25565)
  const [enableQuery, setEnableQuery] = useState(false)

  // ── Advanced ──
  const [jvmArguments, setJvmArguments] = useState('')
  const [resourcePackUrl, setResourcePackUrl] = useState('')
  const [resourcePackRequired, setResourcePackRequired] = useState(false)

  return (
    <div className="qs-settings">

      {/* ═══════════ Crossplay ═══════════ */}
      <div className="qs-settings-section">
        <h3 className="qs-settings-section-title">Crossplay</h3>
        <div className="qs-settings-grid">
          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Allow Bedrock Crossplay</label>
              <span className="qs-setting-desc">Let Xbox, PlayStation, Switch & mobile players join</span>
            </div>
            <div className={`qs-toggle ${bedrockCrossplay ? 'qs-toggle-on' : ''}`} onClick={() => setBedrockCrossplay(!bedrockCrossplay)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>
        </div>

        {bedrockCrossplay && (
          <div className="qs-crossplay-card">
            <div className="qs-crossplay-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--qs-free)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="3" width="12" height="18" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
              <span>Bedrock Crossplay Setup</span>
            </div>
            <p className="qs-crossplay-desc">On next server restart, the following will be automatically installed and configured:</p>
            <div className="qs-crossplay-items">
              <div className="qs-crossplay-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--qs-free)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Geyser <span style={{ color: 'var(--text-3)', fontSize: 11 }}>(Bedrock → Java bridge)</span></span>
              </div>
              <div className="qs-crossplay-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--qs-free)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Floodgate <span style={{ color: 'var(--text-3)', fontSize: 11 }}>(Xbox/PSN authentication)</span></span>
              </div>
            </div>
            <div className="qs-crossplay-port">
              <label className="qs-setting-label">Bedrock Port</label>
              <input className="qs-input qs-input-small" type="number" value={bedrockPort} onChange={e => setBedrockPort(Number(e.target.value))} min={1} max={65535} />
            </div>
            <p className="qs-crossplay-note">Players on Xbox, PlayStation, Switch, and mobile can join your Java server.</p>
          </div>
        )}
      </div>

      {/* ═══════════ Section 1: General ═══════════ */}
      <div className="qs-settings-section">
        <h3 className="qs-settings-section-title">General</h3>
        <div className="qs-settings-grid">
          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Server Name (MOTD)</label>
              <span className="qs-setting-desc">The message shown in the server browser</span>
            </div>
            <input className="qs-input" type="text" value={motd} onChange={e => setMotd(e.target.value)} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Game Mode</label>
              <span className="qs-setting-desc">Default game mode for new players</span>
            </div>
            <select className="qs-select" value={gameMode} onChange={e => setGameMode(e.target.value)}>
              <option value="survival">Survival</option>
              <option value="creative">Creative</option>
              <option value="adventure">Adventure</option>
              <option value="spectator">Spectator</option>
            </select>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Difficulty</label>
              <span className="qs-setting-desc">World difficulty level</span>
            </div>
            <select className="qs-select" value={difficulty} onChange={e => setDifficulty(e.target.value)}>
              <option value="peaceful">Peaceful</option>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Hardcore</label>
              <span className="qs-setting-desc">Players are banned on death — one life only</span>
            </div>
            <div className={`qs-toggle ${hardcore ? 'qs-toggle-on' : ''}`} onClick={() => setHardcore(!hardcore)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ Section 2: Players ═══════════ */}
      <div className="qs-settings-section">
        <h3 className="qs-settings-section-title">Players</h3>
        <div className="qs-settings-grid">
          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Max Players</label>
              <span className="qs-setting-desc">Maximum number of concurrent players</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))} min={1} max={server.players.max} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">PvP</label>
              <span className="qs-setting-desc">Allow player versus player combat</span>
            </div>
            <div className={`qs-toggle ${pvp ? 'qs-toggle-on' : ''}`} onClick={() => setPvp(!pvp)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Allow Flight</label>
              <span className="qs-setting-desc">Allow players to fly in survival mode</span>
            </div>
            <div className={`qs-toggle ${allowFlight ? 'qs-toggle-on' : ''}`} onClick={() => setAllowFlight(!allowFlight)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Force Gamemode</label>
              <span className="qs-setting-desc">Force players to join in the default game mode</span>
            </div>
            <div className={`qs-toggle ${forceGamemode ? 'qs-toggle-on' : ''}`} onClick={() => setForceGamemode(!forceGamemode)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Player Idle Timeout</label>
              <span className="qs-setting-desc">Kick idle players after X minutes (0 = never)</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={playerIdleTimeout} onChange={e => setPlayerIdleTimeout(Number(e.target.value))} min={0} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Whitelist</label>
              <span className="qs-setting-desc">Only whitelisted players can join</span>
            </div>
            <div className={`qs-toggle ${whitelist ? 'qs-toggle-on' : ''}`} onClick={() => setWhitelist(!whitelist)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Online Mode</label>
              <span className="qs-setting-desc">Verify player accounts with Mojang (disable for offline/cracked)</span>
            </div>
            <div className={`qs-toggle ${onlineMode ? 'qs-toggle-on' : ''}`} onClick={() => setOnlineMode(!onlineMode)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ Section 3: World ═══════════ */}
      <div className="qs-settings-section">
        <h3 className="qs-settings-section-title">World</h3>
        <div className="qs-settings-grid">
          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">View Distance</label>
              <span className="qs-setting-desc">Number of chunks sent to the client (3–32)</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={viewDistance} onChange={e => setViewDistance(Number(e.target.value))} min={3} max={32} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Simulation Distance</label>
              <span className="qs-setting-desc">Distance in chunks for entity ticking</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={simulationDistance} onChange={e => setSimulationDistance(Number(e.target.value))} min={3} max={32} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Spawn Protection</label>
              <span className="qs-setting-desc">Radius of protected blocks around spawn (0 = off)</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={spawnProtection} onChange={e => setSpawnProtection(Number(e.target.value))} min={0} max={256} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">World Type</label>
              <span className="qs-setting-desc">World generation type (applies on new world)</span>
            </div>
            <select className="qs-select" value={worldType} onChange={e => setWorldType(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="flat">Flat</option>
              <option value="large_biomes">Large Biomes</option>
              <option value="amplified">Amplified</option>
            </select>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Generate Structures</label>
              <span className="qs-setting-desc">Generate villages, temples, and other structures</span>
            </div>
            <div className={`qs-toggle ${generateStructures ? 'qs-toggle-on' : ''}`} onClick={() => setGenerateStructures(!generateStructures)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Allow Nether</label>
              <span className="qs-setting-desc">Allow players to travel to the Nether</span>
            </div>
            <div className={`qs-toggle ${allowNether ? 'qs-toggle-on' : ''}`} onClick={() => setAllowNether(!allowNether)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Seed</label>
              <span className="qs-setting-desc">World generation seed (leave blank for random)</span>
            </div>
            <input className="qs-input" type="text" value={seed} onChange={e => setSeed(e.target.value)} placeholder="Leave blank for random" />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Level Name</label>
              <span className="qs-setting-desc">Name of the world folder</span>
            </div>
            <input className="qs-input" type="text" value={levelName} onChange={e => setLevelName(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ═══════════ Section 4: Performance ═══════════ */}
      <div className="qs-settings-section">
        <h3 className="qs-settings-section-title">Performance</h3>
        <div className="qs-settings-grid">
          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Command Blocks</label>
              <span className="qs-setting-desc">Enable or disable command blocks</span>
            </div>
            <div className={`qs-toggle ${commandBlocks ? 'qs-toggle-on' : ''}`} onClick={() => setCommandBlocks(!commandBlocks)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Entity Broadcast Range</label>
              <span className="qs-setting-desc">Percentage of default entity visibility distance</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={entityBroadcastRange} onChange={e => setEntityBroadcastRange(Number(e.target.value))} min={10} max={1000} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Max Tick Time</label>
              <span className="qs-setting-desc">Max milliseconds per tick before watchdog kills (-1 = disabled)</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={maxTickTime} onChange={e => setMaxTickTime(Number(e.target.value))} min={-1} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Network Compression</label>
              <span className="qs-setting-desc">Threshold for packet compression in bytes (0–256)</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={networkCompression} onChange={e => setNetworkCompression(Number(e.target.value))} min={0} max={256} />
          </div>
        </div>
      </div>

      {/* ═══════════ Section 5: Security ═══════════ */}
      <div className="qs-settings-section">
        <h3 className="qs-settings-section-title">Security</h3>
        <div className="qs-settings-grid">
          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Enable RCON</label>
              <span className="qs-setting-desc">Allow remote console access</span>
            </div>
            <div className={`qs-toggle ${enableRcon ? 'qs-toggle-on' : ''}`} onClick={() => setEnableRcon(!enableRcon)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>

          {enableRcon && (
            <>
              <div className="qs-setting-item">
                <div className="qs-setting-info">
                  <label className="qs-setting-label">RCON Password</label>
                  <span className="qs-setting-desc">Password for remote console</span>
                </div>
                <input className="qs-input" type="password" value={rconPassword} onChange={e => setRconPassword(e.target.value)} placeholder="Enter RCON password" />
              </div>

              <div className="qs-setting-item">
                <div className="qs-setting-info">
                  <label className="qs-setting-label">RCON Port</label>
                  <span className="qs-setting-desc">Port for RCON connections</span>
                </div>
                <input className="qs-input qs-input-small" type="number" value={rconPort} onChange={e => setRconPort(Number(e.target.value))} min={1} max={65535} />
              </div>
            </>
          )}

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Server Port</label>
              <span className="qs-setting-desc">Port the server listens on</span>
            </div>
            <input className="qs-input qs-input-small" type="number" value={serverPort} onChange={e => setServerPort(Number(e.target.value))} min={1} max={65535} />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Enable Query</label>
              <span className="qs-setting-desc">Enable GameSpy4 query protocol</span>
            </div>
            <div className={`qs-toggle ${enableQuery ? 'qs-toggle-on' : ''}`} onClick={() => setEnableQuery(!enableQuery)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ Section 6: Advanced ═══════════ */}
      <div className="qs-settings-section">
        <h3 className="qs-settings-section-title">Advanced</h3>
        <div className="qs-settings-grid">
          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">JVM Arguments</label>
              <span className="qs-setting-desc">Custom Java arguments (advanced users only)</span>
            </div>
            <input className="qs-input" type="text" value={jvmArguments} onChange={e => setJvmArguments(e.target.value)} placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50" />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Server Icon</label>
              <span className="qs-setting-desc">Custom server icon (64×64 PNG)</span>
            </div>
            <button className="qs-files-btn" onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/png'
              input.onchange = () => { /* Will connect to backend */ }
              input.click()
            }}>Upload Icon</button>
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Resource Pack URL</label>
              <span className="qs-setting-desc">URL to a resource pack for players to download</span>
            </div>
            <input className="qs-input" type="text" value={resourcePackUrl} onChange={e => setResourcePackUrl(e.target.value)} placeholder="https://example.com/pack.zip" />
          </div>

          <div className="qs-setting-item">
            <div className="qs-setting-info">
              <label className="qs-setting-label">Resource Pack Required</label>
              <span className="qs-setting-desc">Force players to use the resource pack</span>
            </div>
            <div className={`qs-toggle ${resourcePackRequired ? 'qs-toggle-on' : ''}`} onClick={() => setResourcePackRequired(!resourcePackRequired)}>
              <div className="qs-toggle-dot" />
            </div>
          </div>
        </div>
      </div>

      <button className="qs-save-btn" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}

// ── Backups Tab ─────────────────────────────────────────────────────────────

function BackupsTab({ server, onRefresh }: { server: QuickServer; onRefresh: () => void }) {
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)

  const handleCreate = async () => {
    setCreatingBackup(true)
    try {
      await createBackup(server.id)
      await onRefresh()
    } catch { /* ignore */ } finally {
      setCreatingBackup(false)
    }
  }

  const handleRestore = async (backupId: string) => {
    setRestoring(backupId)
    setConfirmRestore(null)
    try {
      await restoreBackup(server.id, backupId)
      await onRefresh()
    } catch { /* ignore */ } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="qs-backups">
      <div className="qs-backups-header">
        <h3 className="qs-backups-title">Backups ({server.backups.length})</h3>
        <button className="qs-backup-create-btn" onClick={handleCreate} disabled={creatingBackup}>
          {creatingBackup ? <div className="qs-spinner-small" /> : <PlusIcon />}
          Create Backup
        </button>
      </div>

      {server.backups.length === 0 ? (
        <div className="qs-empty-tab">
          <DownloadIcon />
          <h3>No backups yet</h3>
          <p>Create a manual backup or wait for auto backups.</p>
        </div>
      ) : (
        <div className="qs-backup-list">
          {[...server.backups].reverse().map(backup => (
            <div className="qs-backup-item" key={backup.id}>
              <div className="qs-backup-info">
                <span className="qs-backup-date">{formatDate(backup.createdAt)}</span>
                <div className="qs-backup-meta">
                  <span className={`qs-backup-type ${backup.type === 'auto' ? 'qs-backup-auto' : 'qs-backup-manual'}`}>
                    {backup.type === 'auto' ? 'Auto' : 'Manual'}
                  </span>
                  <span className="qs-backup-size">{backup.size} MB</span>
                </div>
              </div>
              <div className="qs-backup-actions">
                {confirmRestore === backup.id ? (
                  <div className="qs-restore-confirm">
                    <span>Restore this backup?</span>
                    <button className="qs-restore-yes" onClick={() => handleRestore(backup.id)}>Yes</button>
                    <button className="qs-restore-no" onClick={() => setConfirmRestore(null)}>No</button>
                  </div>
                ) : (
                  <button
                    className="qs-restore-btn"
                    onClick={() => setConfirmRestore(backup.id)}
                    disabled={restoring === backup.id}
                  >
                    {restoring === backup.id ? <div className="qs-spinner-small" /> : 'Restore'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({ server }: { server: QuickServer }) {
  const timeLeft = server.expiresAt - Date.now()
  const urgent = timeLeft < 172_800_000
  const [showExtend, setShowExtend] = useState(false)
  const [overviewCpu, setOverviewCpu] = useState(0)
  const [overviewRamFraction, setOverviewRamFraction] = useState(0)

  useEffect(() => {
    const update = () => {
      if (server.status === 'online') {
        setOverviewCpu(15 + Math.random() * 40)
        setOverviewRamFraction(0.3 + Math.random() * 0.4)
      } else {
        setOverviewCpu(0)
        setOverviewRamFraction(0)
      }
    }
    update()
    const interval = setInterval(update, 5000)
    return () => clearInterval(interval)
  }, [server.status])

  return (
    <div className="qs-overview">
      <div className="qs-overview-grid">
        {/* Server Info */}
        <div className="qs-overview-card">
          <h3 className="qs-overview-card-title">Server Info</h3>
          <div className="qs-overview-rows">
            <div className="qs-overview-row">
              <span className="qs-overview-label">Domain</span>
              <span className="qs-overview-value">{server.domain}</span>
            </div>
            <div className="qs-overview-row">
              <span className="qs-overview-label">IP / Port</span>
              <span className="qs-overview-value">{server.domain}:{server.port}</span>
            </div>
            <div className="qs-overview-row">
              <span className="qs-overview-label">Tier</span>
              <span className="qs-overview-value" style={{ color: tierColor(server.tier) }}>{tierLabel(server.tier)}</span>
            </div>
            <div className="qs-overview-row">
              <span className="qs-overview-label">Software</span>
              <span className="qs-overview-value">{softwareLabel(server.software)}</span>
            </div>
            <div className="qs-overview-row">
              <span className="qs-overview-label">Version</span>
              <span className="qs-overview-value">{server.mcVersion}</span>
            </div>
            <div className="qs-overview-row">
              <span className="qs-overview-label">Uptime Type</span>
              <span className="qs-overview-value">{server.uptimeType === '24/7' ? '24/7' : 'On Demand'}</span>
            </div>
          </div>
        </div>

        {/* Resources */}
        <div className="qs-overview-card">
          <h3 className="qs-overview-card-title">Resources</h3>
          <div className="qs-overview-resources">
            <UsageBar used={server.ram * overviewRamFraction} max={server.ram} label="RAM" color="#0A84FF" />
            <UsageBar used={server.storage.used} max={server.storage.max} label="Storage" color="#BF5AF2" />
            <div className="qs-usage-bar">
              <div className="qs-usage-bar-header">
                <span className="qs-usage-bar-label">CPU</span>
                <span className="qs-usage-bar-value">{overviewCpu.toFixed(0)}%</span>
              </div>
              <div className="qs-usage-bar-track">
                <div className="qs-usage-bar-fill" style={{ width: `${overviewCpu}%`, background: '#30D158' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Time Remaining */}
        <div className="qs-overview-card">
          <h3 className="qs-overview-card-title">Time Remaining</h3>
          <div className="qs-overview-time">
            <span className={`qs-overview-time-value ${urgent ? 'qs-time-urgent' : ''}`}>
              {formatTimeRemaining(server.expiresAt)}
            </span>
            <span className="qs-overview-time-date">Expires {formatDate(server.expiresAt)}</span>
            <button className="qs-extend-btn" onClick={() => setShowExtend(true)}>Extend / Renew</button>
            {showExtend && (
              <div className="qs-plugin-modal-overlay" onClick={() => setShowExtend(false)}>
                <div className="qs-plugin-modal" onClick={e => e.stopPropagation()}>
                  <h3 className="qs-plugin-modal-title">Extend Server Time</h3>
                  <p className="qs-plugin-modal-desc">Choose how much time to add to your server:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                    {[7, 14, 30].map(days => (
                      <button key={days} className="qs-plugin-modal-cancel" style={{ textAlign: 'left' }} onClick={() => setShowExtend(false)}>
                        +{days} days — ${days === 7 ? '2.50' : days === 14 ? '4.50' : '8.00'}
                      </button>
                    ))}
                  </div>
                  <div className="qs-plugin-modal-actions">
                    <button className="qs-plugin-modal-cancel" onClick={() => setShowExtend(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Files Tab ────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string
  type: 'folder' | 'file'
  size?: number
  modified: string
  children?: FileEntry[]
}

const MOCK_FILES: FileEntry[] = [
  { name: 'plugins', type: 'folder', modified: '2024-03-15', children: [
    { name: 'EssentialsX.jar', type: 'file', size: 1240000, modified: '2024-03-14' },
    { name: 'LuckPerms.jar', type: 'file', size: 2180000, modified: '2024-03-10' },
    { name: 'WorldEdit.jar', type: 'file', size: 3450000, modified: '2024-03-12' },
    { name: 'WorldGuard.jar', type: 'file', size: 1890000, modified: '2024-03-12' },
    { name: 'Vault.jar', type: 'file', size: 98000, modified: '2024-02-28' },
    { name: 'PlaceholderAPI.jar', type: 'file', size: 540000, modified: '2024-03-01' },
  ]},
  { name: 'world', type: 'folder', modified: '2024-03-15', children: [
    { name: 'level.dat', type: 'file', size: 19800, modified: '2024-03-15' },
    { name: 'region', type: 'folder', modified: '2024-03-15', children: [] },
    { name: 'playerdata', type: 'folder', modified: '2024-03-15', children: [] },
  ]},
  { name: 'world_nether', type: 'folder', modified: '2024-03-15', children: [] },
  { name: 'world_the_end', type: 'folder', modified: '2024-03-15', children: [] },
  { name: 'logs', type: 'folder', modified: '2024-03-15', children: [
    { name: 'latest.log', type: 'file', size: 245000, modified: '2024-03-15' },
  ]},
  { name: 'server.properties', type: 'file', size: 1200, modified: '2024-03-15' },
  { name: 'bukkit.yml', type: 'file', size: 4200, modified: '2024-03-10' },
  { name: 'spigot.yml', type: 'file', size: 3800, modified: '2024-03-10' },
  { name: 'paper-global.yml', type: 'file', size: 8900, modified: '2024-03-10' },
  { name: 'eula.txt', type: 'file', size: 180, modified: '2024-03-01' },
  { name: 'server-icon.png', type: 'file', size: 4096, modified: '2024-03-05' },
]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(entry: FileEntry): React.ReactNode {
  if (entry.type === 'folder') return (
    <svg className="qs-file-icon qs-file-icon-folder" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>
  )
  const ext = entry.name.split('.').pop()?.toLowerCase()
  const colorMap: Record<string, string> = { jar: '#10B981', yml: '#3B82F6', yaml: '#3B82F6', json: '#F59E0B', properties: '#8B5CF6', log: '#6B7280', txt: '#9CA3AF', png: '#EC4899', toml: '#F97316' }
  const color = colorMap[ext || ''] || 'var(--text-3)'
  return (
    <svg className="qs-file-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  )
}

function FilesTab({ server }: { server: QuickServer }) {
  const [path, setPath] = useState<string[]>([])
  const [search, setSearch] = useState('')

  // Navigate the mock file tree
  let currentFiles = MOCK_FILES
  for (const segment of path) {
    const folder = currentFiles.find(f => f.name === segment && f.type === 'folder')
    if (folder?.children) currentFiles = folder.children
    else break
  }

  // Sort: folders first, then alpha
  const sorted = [...currentFiles].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const filtered = search ? sorted.filter(f => f.name.toLowerCase().includes(search.toLowerCase())) : sorted

  return (
    <div className="qs-files">
      {/* Toolbar */}
      <div className="qs-files-toolbar">
        <div className="qs-files-breadcrumb">
          <button className="qs-breadcrumb-item" onClick={() => setPath([])}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            <span>/</span>
          </button>
          {path.map((segment, i) => (
            <React.Fragment key={i}>
              <span className="qs-breadcrumb-sep">/</span>
              <button className="qs-breadcrumb-item" onClick={() => setPath(path.slice(0, i + 1))}>{segment}</button>
            </React.Fragment>
          ))}
        </div>
        <div className="qs-files-actions">
          <div className="qs-files-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search files..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="qs-files-btn" title="Upload file">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload
          </button>
          <button className="qs-files-btn" title="New folder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            New Folder
          </button>
        </div>
      </div>

      {/* File Table */}
      <div className="qs-files-table">
        <div className="qs-files-table-header">
          <span className="qs-files-col-name">Name</span>
          <span className="qs-files-col-size">Size</span>
          <span className="qs-files-col-date">Modified</span>
          <span className="qs-files-col-actions"></span>
        </div>
        {filtered.length === 0 ? (
          <div className="qs-files-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span>{search ? 'No files match your search' : 'This folder is empty'}</span>
          </div>
        ) : filtered.map((entry, i) => (
          <div
            className="qs-files-row"
            key={entry.name}
            onDoubleClick={() => { if (entry.type === 'folder') setPath([...path, entry.name]) }}
            style={{ animationDelay: `${i * 0.02}s` }}
          >
            <span className="qs-files-col-name">
              {fileIcon(entry)}
              <span className="qs-files-filename">{entry.name}</span>
            </span>
            <span className="qs-files-col-size">{entry.type === 'file' && entry.size ? formatFileSize(entry.size) : '—'}</span>
            <span className="qs-files-col-date">{entry.modified}</span>
            <span className="qs-files-col-actions">
              {entry.type === 'file' && (
                <>
                  <button className="qs-files-action-btn" title="Download"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                  <button className="qs-files-action-btn" title="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button className="qs-files-action-btn qs-files-action-delete" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </>
              )}
              {entry.type === 'folder' && (
                <button className="qs-files-action-btn" title="Open" onClick={() => setPath([...path, entry.name])}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg></button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Plugins Tab ──────────────────────────────────────────────────────────────

interface PluginInfo {
  id: string
  name: string
  author: string
  description: string
  version: string
  downloads: number
  follows: number
  category: string
  installed: boolean
  installedVersion?: string
  hasUpdate?: boolean
  dependencies?: string[]
  mcVersions: string[]
  iconColor: string
  iconUrl?: string
  slug?: string
}

// Installed plugins (local state until backend exists)
const INSTALLED_PLUGINS: PluginInfo[] = [
  { id: 'essentialsx-mock', name: 'EssentialsX', author: 'EssentialsX Team', description: 'The essential plugin suite for Minecraft servers.', version: '2.21.0', downloads: 12500000, follows: 45000, category: 'admin', installed: true, installedVersion: '2.20.1', hasUpdate: true, dependencies: ['Vault'], mcVersions: ['1.21'], iconColor: '#10B981' },
  { id: 'luckperms-mock', name: 'LuckPerms', author: 'Luck', description: 'An advanced permissions plugin.', version: '5.4.120', downloads: 9800000, follows: 38000, category: 'admin', installed: true, installedVersion: '5.4.120', mcVersions: ['1.21'], iconColor: '#8B5CF6' },
  { id: 'worldedit-mock', name: 'WorldEdit', author: 'EngineHub', description: 'In-game map editor.', version: '7.3.0', downloads: 8200000, follows: 31000, category: 'world', installed: true, installedVersion: '7.3.0', mcVersions: ['1.21'], iconColor: '#F59E0B' },
  { id: 'vault-mock', name: 'Vault', author: 'MilkBowl', description: 'Permission, chat, and economy API.', version: '1.7.3', downloads: 11000000, follows: 25000, category: 'admin', installed: true, installedVersion: '1.7.3', mcVersions: ['1.21'], iconColor: '#3B82F6' },
]

const MODRINTH_CATEGORIES = [
  { key: 'all', label: 'All', facet: '' },
  { key: 'popular', label: '🔥 Popular', facet: '' },
  { key: 'bukkit', label: 'Bukkit / Paper', facet: 'categories:bukkit' },
  { key: 'fabric', label: 'Fabric', facet: 'categories:fabric' },
  { key: 'forge', label: 'Forge', facet: 'categories:forge' },
  { key: 'utility', label: 'Utility', facet: 'categories:utility' },
  { key: 'management', label: 'Management', facet: 'categories:management' },
  { key: 'economy', label: 'Economy', facet: 'categories:economy' },
]

// Generate a consistent color from a string
function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const colors = ['#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#3B82F6', '#06B6D4', '#F97316', '#14B8A6', '#EC4899', '#22C55E', '#A855F7', '#0EA5E9', '#D946EF', '#6366F1', '#F43F5E', '#84CC16']
  return colors[Math.abs(hash) % colors.length]
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

interface ModrinthHit {
  slug: string
  project_id: string
  title: string
  description: string
  categories: string[]
  client_side: string
  server_side: string
  project_type: string
  downloads: number
  icon_url: string
  author: string
  versions: string[]
  follows: number
  date_modified: string
  latest_version?: string
  display_categories?: string[]
}

async function searchModrinth(query: string, categoryFacet: string, offset = 0): Promise<{ hits: ModrinthHit[]; total: number }> {
  const facets: string[][] = [['server_side:required', 'server_side:optional']]
  if (categoryFacet) facets.push([categoryFacet])

  const params = new URLSearchParams({
    query: query,
    limit: '20',
    offset: String(offset),
    index: query ? 'relevance' : 'downloads',
    facets: JSON.stringify(facets),
  })

  const res = await fetch(`https://api.modrinth.com/v2/search?${params}`, {
    headers: { 'User-Agent': 'CobbleLauncher/1.0 (contact@cobble.gg)' }
  })
  if (!res.ok) throw new Error(`Modrinth API error: ${res.status}`)
  const data = await res.json()
  return { hits: data.hits || [], total: data.total_hits || 0 }
}

function PluginsTab({ server }: { server: QuickServer }) {
  const [view, setView] = useState<'installed' | 'browse'>('browse')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [installing, setInstalling] = useState<string | null>(null)
  const [showDepModal, setShowDepModal] = useState<PluginInfo | null>(null)
  const [modrinthResults, setModrinthResults] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalResults, setTotalResults] = useState(0)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  // Fetch from Modrinth
  useEffect(() => {
    let cancelled = false
    const fetchPlugins = async () => {
      setLoading(true)
      setError(null)
      try {
        const cat = MODRINTH_CATEGORIES.find(c => c.key === category)
        const facet = cat?.facet || ''
        const { hits, total } = await searchModrinth(debouncedSearch, facet)
        if (cancelled) return

        const plugins: PluginInfo[] = hits.map(h => ({
          id: h.project_id,
          slug: h.slug,
          name: h.title,
          author: h.author,
          description: h.description,
          version: h.latest_version || '',
          downloads: h.downloads,
          follows: h.follows,
          category: h.categories[0] || 'other',
          installed: INSTALLED_PLUGINS.some(ip => ip.name.toLowerCase() === h.title.toLowerCase()),
          mcVersions: h.versions.slice(0, 5),
          iconColor: hashColor(h.title),
          iconUrl: h.icon_url || undefined,
        }))

        setModrinthResults(plugins)
        setTotalResults(total)
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load plugins')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (view === 'browse') fetchPlugins()
    return () => { cancelled = true }
  }, [debouncedSearch, category, view])

  const handleInstall = (plugin: PluginInfo) => {
    setInstalling(plugin.id)
    setTimeout(() => setInstalling(null), 2500)
  }

  const confirmInstall = () => {
    if (showDepModal) {
      setInstalling(showDepModal.id)
      setShowDepModal(null)
      setTimeout(() => setInstalling(null), 2500)
    }
  }

  return (
    <div className="qs-plugins">
      {/* Header */}
      <div className="qs-plugins-header">
        <div className="qs-plugins-tabs">
          <button className={`qs-plugins-tab ${view === 'installed' ? 'qs-plugins-tab-active' : ''}`} onClick={() => setView('installed')}>
            Installed <span className="qs-plugins-count">{INSTALLED_PLUGINS.length}</span>
          </button>
          <button className={`qs-plugins-tab ${view === 'browse' ? 'qs-plugins-tab-active' : ''}`} onClick={() => setView('browse')}>
            Browse
          </button>
        </div>
        <div className="qs-plugins-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search Modrinth plugins..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {view === 'installed' ? (
        /* Installed View */
        <div className="qs-plugins-installed">
          {INSTALLED_PLUGINS.length === 0 ? (
            <div className="qs-plugins-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/></svg>
              <span>No plugins installed yet</span>
              <button className="qs-plugins-browse-btn" onClick={() => setView('browse')}>Browse Plugins</button>
            </div>
          ) : INSTALLED_PLUGINS.map(plugin => (
            <div className="qs-plugin-installed-row" key={plugin.id}>
              <div className="qs-plugin-installed-icon" style={{ background: `${plugin.iconColor}22`, color: plugin.iconColor }}>
                {plugin.name.charAt(0)}
              </div>
              <div className="qs-plugin-installed-info">
                <div className="qs-plugin-installed-name">
                  {plugin.name}
                  {plugin.hasUpdate && <span className="qs-plugin-update-badge">Update available</span>}
                </div>
                <span className="qs-plugin-installed-meta">v{plugin.installedVersion} · by {plugin.author}</span>
              </div>
              <div className="qs-plugin-installed-actions">
                {plugin.hasUpdate && (
                  <button className="qs-plugin-update-btn">Update to v{plugin.version}</button>
                )}
                <button className="qs-plugin-uninstall-btn" title="Uninstall">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Browse View */
        <>
          {/* Categories */}
          <div className="qs-plugins-categories">
            {MODRINTH_CATEGORIES.map(cat => (
              <button
                key={cat.key}
                className={`qs-plugins-cat ${category === cat.key ? 'qs-plugins-cat-active' : ''}`}
                onClick={() => setCategory(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Loading / Error / Results */}
          {loading ? (
            <div className="qs-plugins-empty">
              <span className="qs-plugin-installing-spinner" style={{ width: 24, height: 24 }} />
              <span>Searching Modrinth...</span>
            </div>
          ) : error ? (
            <div className="qs-plugins-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--qs-danger)" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <span>{error}</span>
              <button className="qs-plugins-browse-btn" onClick={() => setCategory(category)}>Retry</button>
            </div>
          ) : (
            <>
              {totalResults > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-3)', paddingLeft: 2 }}>
                  {formatDownloads(totalResults)} results from Modrinth
                </span>
              )}
              <div className="qs-plugins-grid">
                {modrinthResults.map(plugin => (
                  <div className="qs-plugin-card" key={plugin.id}>
                    <div className="qs-plugin-card-header">
                      {plugin.iconUrl ? (
                        <img
                          src={plugin.iconUrl}
                          alt=""
                          style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div className="qs-plugin-icon" style={{ background: `${plugin.iconColor}18`, color: plugin.iconColor }}>
                          {plugin.name.charAt(0)}
                        </div>
                      )}
                      <div className="qs-plugin-card-info">
                        <span className="qs-plugin-name">{plugin.name}</span>
                        <span className="qs-plugin-author">by {plugin.author}</span>
                      </div>
                    </div>
                    <p className="qs-plugin-desc">{plugin.description}</p>
                    <div className="qs-plugin-card-footer">
                      <div className="qs-plugin-stats">
                        <span className="qs-plugin-downloads">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          {formatDownloads(plugin.downloads)}
                        </span>
                        <span className="qs-plugin-rating">
                          ♥ {formatDownloads(plugin.follows)}
                        </span>
                      </div>
                      {plugin.installed ? (
                        <span className="qs-plugin-installed-badge">✓ Installed</span>
                      ) : installing === plugin.id ? (
                        <span className="qs-plugin-installing">
                          <span className="qs-plugin-installing-spinner" />
                          Installing…
                        </span>
                      ) : (
                        <button className="qs-plugin-install-btn" onClick={() => handleInstall(plugin)}>Install</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {modrinthResults.length === 0 && !loading && (
                <div className="qs-plugins-empty">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <span>No plugins found{search ? ` for "${search}"` : ''}</span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Dependency Modal */}
      {showDepModal && (
        <div className="qs-plugin-modal-overlay" onClick={() => setShowDepModal(null)}>
          <div className="qs-plugin-modal" onClick={e => e.stopPropagation()}>
            <h3 className="qs-plugin-modal-title">Install {showDepModal.name} v{showDepModal.version}</h3>
            <p className="qs-plugin-modal-desc">The following dependencies will also be installed:</p>
            <div className="qs-plugin-modal-deps">
              <div className="qs-plugin-modal-dep">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--qs-free)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                <span>{showDepModal.name} v{showDepModal.version}</span>
              </div>
              {showDepModal.dependencies?.map(dep => (
                <div className="qs-plugin-modal-dep" key={dep}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--qs-free)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{dep}</span>
                </div>
              ))}
            </div>
            <div className="qs-plugin-modal-actions">
              <button className="qs-plugin-modal-cancel" onClick={() => setShowDepModal(null)}>Cancel</button>
              <button className="qs-plugin-modal-confirm" onClick={confirmInstall}>Install All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default QuickServersPage
