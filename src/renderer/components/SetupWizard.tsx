import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import './SetupWizard.css'

interface SetupWizardProps {
  onComplete: (settings: WizardSettings) => void
}

export interface WizardSettings {
  ram: number
  dynamicIsland: boolean
  closeOnLaunch: boolean
  discordRPC: boolean
}

const TOTAL_SCREENS = 7

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [screen, setScreen] = useState(0)
  const [prevScreen, setPrevScreen] = useState(-1)
  const [exiting, setExiting] = useState(false)

  const [ram, setRam] = useState(4)
  const [dynamicIsland, setDynamicIsland] = useState(true)
  const [closeOnLaunch, setCloseOnLaunch] = useState(false)
  const [discordRPC, setDiscordRPC] = useState(true)

  const finish = useCallback((settings: WizardSettings) => {
    setExiting(true)
    setTimeout(() => onComplete(settings), 800)
  }, [onComplete])

  const goTo = useCallback((target: number) => {
    setPrevScreen(screen)
    setScreen(target)
  }, [screen])

  const next = useCallback(() => {
    if (screen >= TOTAL_SCREENS - 1) {
      finish({ ram, dynamicIsland, closeOnLaunch, discordRPC })
    } else {
      goTo(screen + 1)
    }
  }, [screen, ram, dynamicIsland, closeOnLaunch, discordRPC, finish, goTo])

  const back = useCallback(() => {
    if (screen > 0) goTo(screen - 1)
  }, [screen, goTo])

  // Show footer on screens 1-4 (not hello or allset)
  const showFooter = screen > 0 && screen < TOTAL_SCREENS - 1

  return (
    <div className={`wizard ${exiting ? 'wizard-exit' : ''}`}>
      <div className="wizard-stage">
        {/* Screen 0: Hello */}
        <WizardScreen index={0} current={screen} prev={prevScreen}>
          <HelloScreen onContinue={next} isActive={screen === 0} />
        </WizardScreen>

        {/* Screen 1: What's New */}
        <WizardScreen index={1} current={screen} prev={prevScreen}>
          <WhatsNewScreen />
        </WizardScreen>

        {/* Screen 2: Meet Loomie */}
        <WizardScreen index={2} current={screen} prev={prevScreen}>
          <MeetLoomieScreen />
        </WizardScreen>

        {/* Screen 3: Sign In */}
        <WizardScreen index={3} current={screen} prev={prevScreen}>
          <SignInScreen onNext={next} isActive={screen === 3} />
        </WizardScreen>

        {/* Screen 4: Transfer Data (Migration) */}
        <WizardScreen index={4} current={screen} prev={prevScreen}>
          <MigrationScreen isActive={screen === 4} />
        </WizardScreen>

        {/* Screen 5: Preferences */}
        <WizardScreen index={5} current={screen} prev={prevScreen}>
          <PreferencesScreen
            ram={ram} onRamChange={setRam}
            dynamicIsland={dynamicIsland} onDynamicIslandChange={setDynamicIsland}
            discordRPC={discordRPC} onDiscordRPCChange={setDiscordRPC}
            closeOnLaunch={closeOnLaunch} onCloseOnLaunchChange={setCloseOnLaunch}
          />
        </WizardScreen>

        {/* Screen 6: All Set */}
        <WizardScreen index={6} current={screen} prev={prevScreen}>
          <AllSetScreen onFinish={() => finish({ ram, dynamicIsland, closeOnLaunch, discordRPC })} />
        </WizardScreen>
      </div>

      {/* Footer */}
      {showFooter && (
        <div className="wizard-footer">
          <div className="wizard-dots">
            {Array.from({ length: TOTAL_SCREENS }).map((_, i) => (
              <div key={i} className={`wizard-dot${i === screen ? ' active' : i < screen ? ' done' : ''}`} />
            ))}
          </div>
          <div className="wizard-nav">
            <button className="wizard-nav-back" onClick={back}>Back</button>
            <button className="wizard-nav-continue" onClick={next}>Continue</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Screen wrapper with directional transitions ── */
function WizardScreen({ index, current, prev, children }: {
  index: number; current: number; prev: number; children: React.ReactNode
}) {
  const isActive = index === current
  const wasActive = index === prev
  const goingForward = current > prev

  let className = 'wz-screen'
  if (isActive) className += ' wz-screen-enter' + (goingForward ? '-right' : '-left')
  else if (wasActive) className += ' wz-screen-exit' + (goingForward ? '-left' : '-right')
  else className += ' wz-screen-hidden'

  return <div className={className}>{children}</div>
}


/* ═══════════════════════════════════════════════════
   Screen 0: Hello
   ═══════════════════════════════════════════════════ */

function HelloScreen({ onContinue, isActive }: { onContinue: () => void; isActive: boolean }) {
  const [phase, setPhase] = useState<'hello' | 'welcome'>('hello')

  useEffect(() => {
    if (!isActive) { setPhase('hello'); return }
    const t = setTimeout(() => setPhase('welcome'), 2400)
    return () => clearTimeout(t)
  }, [isActive])

  return (
    <div className="hello">
      {/* Organic gradient blobs */}
      <div className="hello-blob hello-blob-1" />
      <div className="hello-blob hello-blob-2" />
      <div className="hello-blob hello-blob-3" />

      <div className="hello-center">
        <div className={`hello-script ${phase === 'welcome' ? 'hello-script-out' : ''}`}>
          hello
        </div>

        <div className={`hello-title ${phase === 'welcome' ? 'hello-title-in' : ''}`}>
          <span className="hello-title-text">Welcome to</span>
          <span className="hello-title-brand">Loom</span>
        </div>
      </div>

      <div className={`hello-action ${phase === 'welcome' ? 'hello-action-in' : ''}`}>
        <button className="wz-btn-hero" onClick={onContinue}>Get Started</button>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   Screen 1: What's New
   ═══════════════════════════════════════════════════ */

function WhatsNewScreen() {
  return (
    <div className="wz-content">
      <div className="wz-content-inner">
        <div className="wz-icon-wrap">
          <svg viewBox="0 0 56 56" className="wz-icon-svg">
            <defs>
              <linearGradient id="iconGrad1" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#5e5ce6" />
                <stop offset="100%" stopColor="#bf5af2" />
              </linearGradient>
            </defs>
            <rect width="56" height="56" rx="14" fill="url(#iconGrad1)" />
            <path d="M18 38V24l10-8 10 8v14H18z" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M24 38v-8h8v8" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="wz-heading">What's New</h1>
        <p className="wz-subheading">A Minecraft launcher, reimagined.</p>

        <div className="wz-features">
          <div className="wz-feature">
            <div className="wz-feature-icon">
              <svg viewBox="0 0 32 32"><defs><linearGradient id="f1" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#0a84ff" /><stop offset="100%" stopColor="#5e5ce6" /></linearGradient></defs><circle cx="16" cy="16" r="14" fill="url(#f1)" /><rect x="9" y="12" width="14" height="8" rx="4" fill="white" /></svg>
            </div>
            <div className="wz-feature-text">
              <div className="wz-feature-name">Dynamic Island</div>
              <div className="wz-feature-desc">A living HUD that follows your game — health, coordinates, music, and more.</div>
            </div>
          </div>

          <div className="wz-feature">
            <div className="wz-feature-icon">
              <svg viewBox="0 0 32 32"><defs><linearGradient id="f2" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#bf5af2" /><stop offset="100%" stopColor="#ff375f" /></linearGradient></defs><circle cx="16" cy="16" r="14" fill="url(#f2)" /><circle cx="16" cy="16" r="5" fill="white" /><circle cx="16" cy="16" r="8" fill="none" stroke="white" strokeWidth="1.5" opacity="0.6" /></svg>
            </div>
            <div className="wz-feature-text">
              <div className="wz-feature-name">Loomie AI</div>
              <div className="wz-feature-desc">Your Minecraft companion — knows every recipe, every mob, every trick.</div>
            </div>
          </div>

          <div className="wz-feature">
            <div className="wz-feature-icon">
              <svg viewBox="0 0 32 32"><defs><linearGradient id="f3" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#30d158" /><stop offset="100%" stopColor="#0a84ff" /></linearGradient></defs><circle cx="16" cy="16" r="14" fill="url(#f3)" /><rect x="10" y="11" width="12" height="10" rx="2" fill="white" /><rect x="12" y="14" width="8" height="1.5" rx="0.75" fill="url(#f3)" /><rect x="12" y="17" width="5" height="1.5" rx="0.75" fill="url(#f3)" /></svg>
            </div>
            <div className="wz-feature-text">
              <div className="wz-feature-name">Smart Library</div>
              <div className="wz-feature-desc">Create instances, browse mods, and manage everything in one place.</div>
            </div>
          </div>

          <div className="wz-feature">
            <div className="wz-feature-icon">
              <svg viewBox="0 0 32 32"><defs><linearGradient id="f4" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#f59e0b" /><stop offset="100%" stopColor="#ef4444" /></linearGradient></defs><circle cx="16" cy="16" r="14" fill="url(#f4)" /><rect x="10" y="10" width="12" height="12" rx="3" fill="white" /><path d="M14 14h4v4h-4z" fill="url(#f4)" /></svg>
            </div>
            <div className="wz-feature-text">
              <div className="wz-feature-name">Quick Servers</div>
              <div className="wz-feature-desc">Host your own Minecraft server with one click, right from Loom.</div>
            </div>
          </div>

          <div className="wz-feature">
            <div className="wz-feature-icon">
              <svg viewBox="0 0 32 32"><defs><linearGradient id="f5" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#10b981" /><stop offset="100%" stopColor="#059669" /></linearGradient></defs><circle cx="16" cy="16" r="14" fill="url(#f5)" /><path d="M11 16l3 3 7-7" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="wz-feature-text">
              <div className="wz-feature-name">Bedrock Edition</div>
              <div className="wz-feature-desc">Launch and manage Minecraft Bedrock, browse add-ons, all in one place.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   Screen 2: Meet Loomie
   ═══════════════════════════════════════════════════ */

function MeetLoomieScreen() {
  return (
    <div className="wz-content">
      <div className="wz-content-inner wz-loomie">
        <div className="loomie-glow">
          <div className="loomie-orb" />
        </div>
        <h1 className="wz-heading">Meet Loomie</h1>
        <p className="wz-subheading">Your personal Minecraft companion,<br />powered by Gemini.</p>

        <div className="loomie-caps">
          <div className="loomie-cap">
            <div className="loomie-cap-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg>
            </div>
            <div>
              <div className="loomie-cap-title">Encyclopedic knowledge</div>
              <div className="loomie-cap-desc">Every recipe, every mob stat, every redstone mechanic — instant answers.</div>
            </div>
          </div>
          <div className="loomie-cap">
            <div className="loomie-cap-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
            </div>
            <div>
              <div className="loomie-cap-title">Natural conversation</div>
              <div className="loomie-cap-desc">Ask anything the way you'd ask a friend. Loomie responds naturally.</div>
            </div>
          </div>
          <div className="loomie-cap">
            <div className="loomie-cap-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
            </div>
            <div>
              <div className="loomie-cap-title">Launcher actions</div>
              <div className="loomie-cap-desc">Install mods, create instances, adjust settings — all by asking.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   Screen 3: Sign In
   ═══════════════════════════════════════════════════ */

function SignInScreen({ onNext, isActive }: { onNext: () => void; isActive: boolean }) {
  const { addAccount, isAuthenticated, user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const autoAdvanced = useRef(false)

  const handleSignIn = useCallback(async () => {
    setLoading(true)
    try { await addAccount() } catch { /* */ }
    finally { setLoading(false) }
  }, [addAccount])

  useEffect(() => {
    if (isActive && isAuthenticated && !autoAdvanced.current) {
      setSignedIn(true)
      autoAdvanced.current = true
      const t = setTimeout(onNext, 1500)
      return () => clearTimeout(t)
    }
  }, [isActive, isAuthenticated, onNext])

  useEffect(() => {
    if (!isActive) { autoAdvanced.current = false; setSignedIn(false) }
  }, [isActive])

  return (
    <div className="wz-content">
      <div className="wz-content-inner">
        <div className="wz-icon-wrap">
          <svg viewBox="0 0 56 56" className="wz-icon-svg">
            <rect width="56" height="56" rx="14" fill="#1a1a1e" />
            <g transform="translate(15, 15)">
              <rect x="0" y="0" width="12" height="12" fill="#F25022" rx="1.5" />
              <rect x="14" y="0" width="12" height="12" fill="#7FBA00" rx="1.5" />
              <rect x="0" y="14" width="12" height="12" fill="#00A4EF" rx="1.5" />
              <rect x="14" y="14" width="12" height="12" fill="#FFB900" rx="1.5" />
            </g>
          </svg>
        </div>
        <h1 className="wz-heading">Sign in with Microsoft</h1>
        <p className="wz-subheading">Connect your Minecraft account to get started.</p>

        {signedIn ? (
          <div className="signin-done">
            <div className="signin-check">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <div className="signin-done-name">{user?.displayName || user?.username}</div>
          </div>
        ) : (
          <div className="signin-actions">
            <button className={`wz-btn-primary signin-main ${loading ? 'loading' : ''}`} onClick={handleSignIn} disabled={loading}>
              {loading ? <><span className="wz-spinner" />Signing in…</> : 'Sign In'}
            </button>
            <button className="wz-btn-text" onClick={onNext}>Set Up Later</button>
          </div>
        )}
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   Screen 4: Preferences
   ═══════════════════════════════════════════════════ */

interface PrefsProps {
  ram: number; onRamChange: (v: number) => void
  dynamicIsland: boolean; onDynamicIslandChange: (v: boolean) => void
  discordRPC: boolean; onDiscordRPCChange: (v: boolean) => void
  closeOnLaunch: boolean; onCloseOnLaunchChange: (v: boolean) => void
}

function PreferencesScreen({ ram, onRamChange, dynamicIsland, onDynamicIslandChange, discordRPC, onDiscordRPCChange, closeOnLaunch, onCloseOnLaunchChange }: PrefsProps) {
  return (
    <div className="wz-content">
      <div className="wz-content-inner">
        <div className="wz-icon-wrap">
          <svg viewBox="0 0 56 56" className="wz-icon-svg">
            <defs>
              <linearGradient id="prefsGrad" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#636366" />
                <stop offset="100%" stopColor="#48484a" />
              </linearGradient>
            </defs>
            <rect width="56" height="56" rx="14" fill="url(#prefsGrad)" />
            <circle cx="28" cy="28" r="10" fill="none" stroke="white" strokeWidth="2" />
            <circle cx="28" cy="28" r="4" fill="white" />
            <line x1="28" y1="12" x2="28" y2="18" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1="28" y1="38" x2="28" y2="44" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="28" x2="18" y2="28" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1="38" y1="28" x2="44" y2="28" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="wz-heading">Make It Yours</h1>
        <p className="wz-subheading">You can always change these later in Settings.</p>

        <div className="prefs-group">
          <RamSlider value={ram} onChange={onRamChange} />

          <div className="prefs-sep" />

          <label className="prefs-row" onClick={() => onDynamicIslandChange(!dynamicIsland)}>
            <div className="prefs-row-info">
              <span className="prefs-row-name">Dynamic Island</span>
              <span className="prefs-row-desc">Apple‑style HUD overlay in Minecraft</span>
            </div>
            <div className={`prefs-toggle ${dynamicIsland ? 'on' : ''}`}><div className="prefs-toggle-knob" /></div>
          </label>

          <label className="prefs-row" onClick={() => onDiscordRPCChange(!discordRPC)}>
            <div className="prefs-row-info">
              <span className="prefs-row-name">Discord Rich Presence</span>
              <span className="prefs-row-desc">Show what you're playing on Discord</span>
            </div>
            <div className={`prefs-toggle ${discordRPC ? 'on' : ''}`}><div className="prefs-toggle-knob" /></div>
          </label>

          <label className="prefs-row" onClick={() => onCloseOnLaunchChange(!closeOnLaunch)}>
            <div className="prefs-row-info">
              <span className="prefs-row-name">Close on Game Start</span>
              <span className="prefs-row-desc">Free up resources while you play</span>
            </div>
            <div className={`prefs-toggle ${closeOnLaunch ? 'on' : ''}`}><div className="prefs-toggle-knob" /></div>
          </label>
        </div>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   Screen 4: Transfer Data (Migration)
   ═══════════════════════════════════════════════════ */

const api = (window as any).electronAPI

function MigrationScreen({ isActive }: { isActive: boolean }) {
  const [launchers, setLaunchers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const detected = useRef(false)

  useEffect(() => {
    if (!isActive || detected.current) return
    detected.current = true
    setLoading(true)
    api?.migrationDetect?.().then((result: any[]) => {
      setLaunchers(result || [])
      // Auto-select all detected launchers
      const sel: Record<string, boolean> = {}
      ;(result || []).forEach((l: any) => { sel[l.name] = true })
      setSelected(sel)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [isActive])

  const handleImport = async (launcher: any) => {
    setImporting(true)
    try {
      await api?.migrationImport?.(launcher.type, launcher.path, {
        worlds: true, mods: true, resourcePacks: true, settings: true
      })
      setImportResult(`Imported data from ${launcher.name}`)
    } catch (e: any) {
      setImportResult(`Failed: ${e.message}`)
    }
    setImporting(false)
  }

  return (
    <div className="wz-content">
      <div className="wz-content-inner">
        <div className="wz-icon-wrap">
          <svg viewBox="0 0 56 56" className="wz-icon-svg">
            <defs>
              <linearGradient id="migrateGrad" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#0a84ff" />
                <stop offset="100%" stopColor="#30d158" />
              </linearGradient>
            </defs>
            <rect width="56" height="56" rx="14" fill="url(#migrateGrad)" />
            <path d="M18 28h20M30 20l8 8-8 8" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="wz-heading">Transfer Your Data</h1>
        <p className="wz-subheading">Import worlds, mods, and settings from another launcher.</p>

        <div className="prefs-group">
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#a1a1a6', fontSize: 13 }}>
              <span className="wz-spinner" style={{ marginRight: 8 }} />
              Scanning for launchers...
            </div>
          ) : launchers.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#a1a1a6', fontSize: 13 }}>
              No other launchers detected. You can skip this step.
            </div>
          ) : (
            <>
              {launchers.map((l: any) => (
                <label key={l.name} className="prefs-row" onClick={() => handleImport(l)} style={{ cursor: importing ? 'wait' : 'pointer' }}>
                  <div className="prefs-row-info">
                    <span className="prefs-row-name">{l.name}</span>
                    <span className="prefs-row-desc">{l.instanceCount || 0} instance{l.instanceCount !== 1 ? 's' : ''} found</span>
                  </div>
                  <div className="prefs-row-info" style={{ textAlign: 'right', opacity: 0.6, fontSize: 11 }}>
                    Import
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </label>
              ))}
              {importResult && (
                <div style={{ padding: '12px 16px', fontSize: 12, color: '#30d158', textAlign: 'center' }}>
                  {importResult}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   Screen 5: All Set
   ═══════════════════════════════════════════════════ */

function AllSetScreen({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="allset">
      <div className="allset-blob allset-blob-1" />
      <div className="allset-blob allset-blob-2" />
      <div className="allset-blob allset-blob-3" />
      <div className="allset-center">
        <h1 className="allset-heading">You're all set.</h1>
        <p className="allset-sub">Loom is ready. Let's play.</p>
        <button className="wz-btn-hero" onClick={onFinish}>Get Started</button>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════
   RAM Slider
   ═══════════════════════════════════════════════════ */

function RamSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const min = 2, max = 16
  const pct = ((value - min) / (max - min)) * 100

  const update = (x: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return
    const ratio = Math.max(0, Math.min(1, (x - r.left) / r.width))
    onChange(Math.round(ratio * (max - min) + min))
  }

  useEffect(() => {
    const move = (e: MouseEvent) => { if (dragging.current) update(e.clientX) }
    const up = () => { dragging.current = false }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, []) // eslint-disable-line

  return (
    <div className="ram-slider">
      <div className="ram-header">
        <span className="ram-label">Allocated Memory</span>
        <span className="ram-value">{value} GB</span>
      </div>
      <div className="ram-track" ref={trackRef} onMouseDown={e => { dragging.current = true; update(e.clientX); e.preventDefault() }}>
        <div className="ram-fill" style={{ width: `${pct}%` }} />
        <div className="ram-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="ram-ticks">
        <span>2 GB</span><span>4</span><span>8</span><span>12</span><span>16 GB</span>
      </div>
    </div>
  )
}
