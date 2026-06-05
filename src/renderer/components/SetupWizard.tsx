// ============================================================
// Loom Setup Wizard — Phase 1
// 5 screens · spring animations · purple/yellow brand palette
// ============================================================

import { useState, useCallback, useRef, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'
import loomIconHires from '../assets/loom-icon-hires.png'
import minecraftIcon from '../assets/minecraft-icon.svg'
import prismIcon from '../assets/prism-icon.svg'
import curseforgeIcon from '../assets/curseforge-icon.svg'
import './SetupWizard.css'

// ── Public types ─────────────────────────────────────────────

export interface WizardSettings {
  ram: number
  dynamicIsland: boolean
  closeOnLaunch: boolean
  discordRPC: boolean
  theme: 'loom' | 'midnight'
}

// ── Constants ────────────────────────────────────────────────

const TOTAL_SCREENS = 5

const RAM_STEPS = [2, 3, 4, 6, 8, 12, 16]
const RAM_MIN = RAM_STEPS[0]
const RAM_MAX = RAM_STEPS[RAM_STEPS.length - 1]
const RAM_TICKS = [2, 4, 8, 12, 16]

// ── SVG icons (inline, no deps) ──────────────────────────────

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function MusicNoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
      <path d="M18 14l1.18 3.54L22.72 18.72l-3.54 1.18L18 23.44l-1.18-3.54L13.28 18.72l3.54-1.18L18 14z" opacity={0.6} />
    </svg>
  )
}

function GamepadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="3" />
      <path d="M8 6v12M12 10v4M6 12h4" />
      <circle cx="17" cy="10" r="1" fill="currentColor" />
      <circle cx="17" cy="14" r="1" fill="currentColor" />
    </svg>
  )
}

// ── Blobs background ─────────────────────────────────────────

function BlobsBackground() {
  return (
    <div className="wizard-blobs">
      <div className="wizard-blob wizard-blob--1" />
      <div className="wizard-blob wizard-blob--2" />
      <div className="wizard-blob wizard-blob--3" />
    </div>
  )
}

// ── Toggle switch ────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`wiz-toggle ${on ? 'wiz-toggle--on' : 'wiz-toggle--off'}`}
      onClick={onToggle}
      aria-pressed={on}
    >
      <span className="wiz-toggle-knob" />
    </button>
  )
}

// ── RAM Slider (index-based positioning) ─────────────────────

function valueToIndex(val: number): number {
  let closest = 0
  let minDist = Math.abs(val - RAM_STEPS[0])
  for (let i = 1; i < RAM_STEPS.length; i++) {
    const dist = Math.abs(val - RAM_STEPS[i])
    if (dist < minDist) {
      minDist = dist
      closest = i
    }
  }
  return closest
}

function indexToPct(idx: number): number {
  return (idx / (RAM_STEPS.length - 1)) * 100
}

function tickPct(tickVal: number): number {
  const idx = RAM_STEPS.indexOf(tickVal)
  if (idx === -1) return 0
  return indexToPct(idx)
}

function RamSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const pct = indexToPct(valueToIndex(value))

  const updateFromEvent = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    // Map ratio to the nearest step index
    const floatIdx = ratio * (RAM_STEPS.length - 1)
    const snapIdx = Math.round(floatIdx)
    onChange(RAM_STEPS[snapIdx])
  }, [onChange])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    updateFromEvent(e.clientX)
  }, [updateFromEvent])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    updateFromEvent(e.clientX)
  }, [updateFromEvent])

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  return (
    <div className="ram-section">
      <div className="ram-label-row">
        <span className="ram-label">Memory (RAM)</span>
        <span className="ram-value">{value} GB</span>
      </div>
      <div
        className="ram-slider-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="ram-slider-fill" style={{ width: `${pct}%` }} />
        <div className="ram-slider-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="ram-ticks" style={{ position: 'relative', height: '18px', marginTop: '8px' }}>
        {RAM_TICKS.map(t => (
          <span
            className="ram-tick"
            key={t}
            style={{
              position: 'absolute',
              left: `${tickPct(t)}%`,
              transform: 'translateX(-50%)',
            }}
          >{t}</span>
        ))}
      </div>
    </div>
  )
}

// ── Screen 0: Welcome ────────────────────────────────────────

function WelcomeScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="wizard-fullscreen">
      <BlobsBackground />
      <div className="welcome-content">
        <span className="welcome-to">Welcome to</span>
        <span className="welcome-loom">Loom</span>
        <div className="hello-get-started">
          <button className="wiz-btn-pill" onClick={onNext}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Screen 1: Migration ──────────────────────────────────────

interface DetectedLauncher {
  id: string
  name: string
  instanceCount: number
}

function LauncherIcon({ name }: { name: string }) {
  const n = name.toLowerCase()
  if (n.includes('minecraft') || n.includes('official') || n.includes('vanilla')) {
    return <img className="migration-launcher-icon" src={minecraftIcon} alt="Minecraft" />
  }
  if (n.includes('prism')) {
    return <img className="migration-launcher-icon" src={prismIcon} alt="Prism Launcher" />
  }
  if (n.includes('curse') || n.includes('forge') || n.includes('overwolf')) {
    return (
      <div className="migration-launcher-icon" style={{ background: '#F16436', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={curseforgeIcon} alt="CurseForge" style={{ width: '22px', height: '22px', filter: 'invert(1)' }} />
      </div>
    )
  }
  // Generic launcher icon
  return (
    <svg className="migration-launcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <rect x="7" y="7" width="4" height="4" rx="1" />
      <rect x="13" y="7" width="4" height="4" rx="1" />
      <rect x="7" y="13" width="4" height="4" rx="1" />
      <rect x="13" y="13" width="4" height="4" rx="1" />
    </svg>
  )
}

function MigrationScreen() {
  const [loading, setLoading] = useState(true)
  const [launchers, setLaunchers] = useState<DetectedLauncher[]>([])
  const [importing, setImporting] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const detect = async () => {
      try {
        const api = (window as any).electronAPI
        const detected = await api.migrationDetect()
        if (!cancelled) {
          setLaunchers(detected || [])
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    detect()
    return () => { cancelled = true }
  }, [])

  const handleImport = useCallback(async (id: string) => {
    setImporting(id)
    setResult(null)
    try {
      const api = (window as any).electronAPI
      const res = await api.migrationImport(id)
      setResult(res?.message || 'Import complete!')
    } catch {
      setResult('Import failed — you can try again later.')
    } finally {
      setImporting(null)
    }
  }, [])

  return (
    <>
      <div className="wiz-icon-box wiz-icon-box--migration">
        <ArrowIcon />
      </div>
      <h2 className="wiz-screen-heading">Transfer Your Data</h2>
      <p className="wiz-screen-sub">Import worlds, mods, and settings from another launcher.</p>

      <div className="migration-body">
        {loading ? (
          <div className="migration-status">
            <div className="migration-spinner" />
            <span>Scanning for launchers…</span>
          </div>
        ) : launchers.length === 0 ? (
          <div className="migration-empty">Fresh start! You can skip this step.</div>
        ) : (
          <div className="wiz-glass-card">
            {launchers.map(l => (
              <div className="migration-launcher-row" key={l.id}>
                <LauncherIcon name={l.name} />
                <div className="migration-launcher-info">
                  <div className="migration-launcher-name">{l.name}</div>
                  <div className="migration-launcher-count">
                    {l.instanceCount} instance{l.instanceCount !== 1 ? 's' : ''}
                  </div>
                </div>
                <button
                  className="wiz-btn-sm"
                  disabled={importing !== null}
                  onClick={() => handleImport(l.id)}
                >
                  {importing === l.id ? 'Importing…' : 'Import'}
                </button>
              </div>
            ))}
          </div>
        )}

        {result && <div className="migration-result">{result}</div>}
      </div>
    </>
  )
}

// ── Screen 2: Preferences ────────────────────────────────────

function PreferencesScreen({
  settings,
  onUpdate,
  onThemeChange,
}: {
  settings: WizardSettings
  onUpdate: (patch: Partial<WizardSettings>) => void
  onThemeChange: (theme: 'loom' | 'midnight') => void
}) {
  return (
    <>
      <div className="wiz-icon-box wiz-icon-box--prefs">
        <GearIcon />
      </div>
      <h2 className="wiz-screen-heading">Make It Yours</h2>
      <p className="wiz-screen-sub">You can always change these later in Settings.</p>

      <div className="prefs-body">
        <div className="wiz-glass-card">
          <RamSlider value={settings.ram} onChange={v => onUpdate({ ram: v })} />

          <div className="prefs-separator" />

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">Dynamic Island</div>
              <div className="setting-desc">Floating status bar for downloads &amp; tasks</div>
            </div>
            <Toggle on={settings.dynamicIsland} onToggle={() => onUpdate({ dynamicIsland: !settings.dynamicIsland })} />
          </div>

          <div className="prefs-separator" />

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">Discord Rich Presence</div>
              <div className="setting-desc">Show what you're playing on Discord</div>
            </div>
            <Toggle on={settings.discordRPC} onToggle={() => onUpdate({ discordRPC: !settings.discordRPC })} />
          </div>

          <div className="prefs-separator" />

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">Close on Game Start</div>
              <div className="setting-desc">Hide launcher when Minecraft launches</div>
            </div>
            <Toggle on={settings.closeOnLaunch} onToggle={() => onUpdate({ closeOnLaunch: !settings.closeOnLaunch })} />
          </div>
        </div>

        {/* Theme Picker */}
        <div className="theme-picker">
          <div className="theme-picker-label">Choose Your Look</div>
          <div className="theme-picker-row">
            <div
              className={`theme-card theme-card--loom ${settings.theme === 'loom' ? 'selected' : ''}`}
              onClick={() => { onUpdate({ theme: 'loom' }); onThemeChange('loom') }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') { onUpdate({ theme: 'loom' }); onThemeChange('loom') } }}
            >
              <div className="theme-card-inner">
                <div className="theme-card-stripe" />
                <div className="theme-card-preview">
                  <div className="theme-card-bar" />
                  <div className="theme-card-bar" />
                  <div className="theme-card-bar" />
                </div>
                <span className="theme-card-name">Loom</span>
              </div>
            </div>

            <div
              className={`theme-card theme-card--midnight ${settings.theme === 'midnight' ? 'selected' : ''}`}
              onClick={() => { onUpdate({ theme: 'midnight' }); onThemeChange('midnight') }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') { onUpdate({ theme: 'midnight' }); onThemeChange('midnight') } }}
            >
              <div className="theme-card-inner">
                <div className="theme-card-stripe" />
                <div className="theme-card-preview">
                  <div className="theme-card-bar" />
                  <div className="theme-card-bar" />
                  <div className="theme-card-bar" />
                </div>
                <span className="theme-card-name">Midnight</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Screen 3: Feature Preview ────────────────────────────────

function FeaturePreviewScreen() {
  return (
    <>
      <h2 className="wiz-screen-heading">More Than a Launcher</h2>
      <p className="wiz-screen-sub">Here's a taste of what Loom can do.</p>

      <div className="feature-body">
        <div className="feature-cards">
          <div className="feature-card feature-card--music">
            <div className="feature-card-icon"><MusicNoteIcon /></div>
            <div className="feature-card-title">Music</div>
            <div className="feature-card-desc">Spotify in your game</div>
          </div>
          <div className="feature-card feature-card--ai">
            <div className="feature-card-icon"><SparkleIcon /></div>
            <div className="feature-card-title">Loomie</div>
            <div className="feature-card-desc">Your AI companion</div>
          </div>
          <div className="feature-card feature-card--bedrock">
            <div className="feature-card-icon"><GamepadIcon /></div>
            <div className="feature-card-title">Bedrock</div>
            <div className="feature-card-desc">Java + Bedrock</div>
          </div>
        </div>
        <div className="feature-bottom-text">We'll show you around inside</div>
      </div>
    </>
  )
}

// ── Screen 4: Transition ─────────────────────────────────────

function TransitionScreen({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="wizard-fullscreen">
      <BlobsBackground />
      <div className="transition-content">
        <img src={loomIconHires} alt="Loom" className="transition-logo-img" />
        <h2 className="transition-heading">Ready to explore.</h2>
        <p className="transition-sub">Your launcher awaits.</p>
        <div className="transition-cta">
          <button className="wiz-btn-pill wiz-btn-pill--large" onClick={onEnter}>
            Enter Loom
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Wizard screen transition wrapper ─────────────────────────

function WizardScreenWrap({
  screenIndex,
  direction,
  children,
}: {
  screenIndex: number
  direction: 'right' | 'left'
  children: React.ReactNode
}) {
  return (
    <div
      key={screenIndex}
      className={`wizard-screen enter-${direction}`}
    >
      {children}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────

export default function SetupWizard({ onComplete }: { onComplete: (settings: WizardSettings) => void }) {
  const { setTheme: applyTheme } = useTheme()
  const [screen, setScreen] = useState(0)
  const [direction, setDirection] = useState<'right' | 'left'>('right')
  const [exiting, setExiting] = useState(false)
  const [prevScreen, setPrevScreen] = useState<number | null>(null)
  const [prevDirection, setPrevDirection] = useState<'right' | 'left'>('right')

  const [settings, setSettings] = useState<WizardSettings>({
    ram: 4,
    dynamicIsland: true,
    closeOnLaunch: false,
    discordRPC: true,
    theme: 'loom',
  })

  const updateSettings = useCallback((patch: Partial<WizardSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }))
  }, [])

  const handleThemeChange = useCallback((theme: 'loom' | 'midnight') => {
    applyTheme(theme)
  }, [applyTheme])

  const goTo = useCallback((target: number) => {
    const dir = target > screen ? 'right' : 'left'
    setPrevScreen(screen)
    setPrevDirection(dir === 'right' ? 'left' : 'right')
    setDirection(dir)
    setScreen(target)
  }, [screen])

  const next = useCallback(() => {
    if (screen < TOTAL_SCREENS - 1) goTo(screen + 1)
  }, [screen, goTo])

  const back = useCallback(() => {
    if (screen > 0) goTo(screen - 1)
  }, [screen, goTo])

  const finish = useCallback(() => {
    setExiting(true)
    setTimeout(() => onComplete(settings), 780)
  }, [settings, onComplete])

  const showFooter = screen >= 1 && screen <= 3

  // Render the active screen
  const renderScreen = (idx: number) => {
    switch (idx) {
      case 0:
        return <WelcomeScreen onNext={next} />
      case 1:
        return <MigrationScreen />
      case 2:
        return <PreferencesScreen settings={settings} onUpdate={updateSettings} onThemeChange={handleThemeChange} />
      case 3:
        return <FeaturePreviewScreen />
      case 4:
        return <TransitionScreen onEnter={finish} />
      default:
        return null
    }
  }

  // Determine exit direction for previous screen
  const exitDir = prevDirection === 'left' ? 'left' : 'right'

  return (
    <div className={`setup-wizard ${exiting ? 'wizard-exiting' : ''} ${settings.theme === 'midnight' ? 'wizard-midnight' : ''}`}>
      <div className="wizard-screen-wrapper">
        {/* Exiting screen */}
        {prevScreen !== null && (
          <div
            key={`exit-${prevScreen}`}
            className={`wizard-screen exit-${exitDir}`}
            onAnimationEnd={() => setPrevScreen(null)}
          >
            {renderScreen(prevScreen)}
          </div>
        )}

        {/* Active screen */}
        {screen === 0 || screen === 4 ? (
          // Fullscreen screens render directly (no wrapper padding)
          <div key={`screen-${screen}`} className={`wizard-screen enter-${direction}`}>
            {renderScreen(screen)}
          </div>
        ) : (
          <WizardScreenWrap screenIndex={screen} direction={direction}>
            {renderScreen(screen)}
          </WizardScreenWrap>
        )}
      </div>

      {/* Footer with dots and nav */}
      {showFooter && (
        <div className="wizard-footer">
          <button className="wiz-btn-text" onClick={back}>
            Back
          </button>

          <div className="wizard-dots">
            {Array.from({ length: TOTAL_SCREENS }, (_, i) => {
              let cls = 'wizard-dot '
              if (i === screen) cls += 'wizard-dot--active'
              else if (i < screen) cls += 'wizard-dot--done'
              else cls += 'wizard-dot--upcoming'
              return <div key={i} className={cls} />
            })}
          </div>

          <button className="wiz-btn-pill" onClick={next}>
            Continue
          </button>
        </div>
      )}
    </div>
  )
}
