import { useState, useCallback, useRef, useEffect } from 'react'
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

const STEPS = 4

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0)
  const [exiting, setExiting] = useState(false)

  // Settings
  const [ram, setRam] = useState(4)
  const [dynamicIsland, setDynamicIsland] = useState(true)
  const [closeOnLaunch, setCloseOnLaunch] = useState(false)
  const [discordRPC, setDiscordRPC] = useState(true)

  const finish = useCallback((settings: WizardSettings) => {
    setExiting(true)
    setTimeout(() => onComplete(settings), 600)
  }, [onComplete])

  const next = useCallback(() => {
    if (step >= STEPS - 1) {
      finish({ ram, dynamicIsland, closeOnLaunch, discordRPC })
    } else {
      setStep(s => s + 1)
    }
  }, [step, ram, dynamicIsland, closeOnLaunch, discordRPC, finish])

  const back = useCallback(() => {
    if (step > 0) setStep(s => s - 1)
  }, [step])

  const skip = useCallback(() => {
    finish({ ram: 4, dynamicIsland: true, closeOnLaunch: false, discordRPC: true })
  }, [finish])

  const pageClass = (i: number) =>
    i === step ? 'wizard-page active' : i < step ? 'wizard-page exit' : 'wizard-page'

  return (
    <div className={`wizard ${exiting ? 'wizard-exit' : ''}`}>
      {/* Ambient orbs */}
      <div className="wizard-bg">
        <div className="wizard-orb wizard-orb-1" />
        <div className="wizard-orb wizard-orb-2" />
        <div className="wizard-orb wizard-orb-3" />
      </div>

      {/* Content */}
      <div className="wizard-body">
        {/* Step 0: Hello */}
        <div className={pageClass(0)}>
          <div className="wizard-hello">Hello.</div>
          <div className="wizard-subtitle">
            Welcome to Cobble — your Minecraft launcher, reimagined.
            Let's get a few things set up.
          </div>
        </div>

        {/* Step 1: Performance */}
        <div className={pageClass(1)}>
          <div className="wizard-section-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div className="wizard-heading">Performance</div>
          <div className="wizard-caption">
            Choose how much memory to give Minecraft. More RAM helps with
            mods and longer render distances.
          </div>

          <RamSlider value={ram} onChange={setRam} />

          <div className="wizard-options">
            <div className="wizard-option" onClick={() => setCloseOnLaunch(!closeOnLaunch)}>
              <div className="wizard-option-left">
                <div className="wizard-option-title">Close launcher when game starts</div>
                <div className="wizard-option-desc">Frees up system resources while you play</div>
              </div>
              <div className={`wizard-toggle ${closeOnLaunch ? 'on' : ''}`} />
            </div>
          </div>
        </div>

        {/* Step 2: Features */}
        <div className={pageClass(2)}>
          <div className="wizard-section-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </div>
          <div className="wizard-heading">Features</div>
          <div className="wizard-caption">
            Turn on the extras you'd like. You can always change these later in Settings.
          </div>

          <div className="wizard-options">
            <div className="wizard-option" onClick={() => setDynamicIsland(!dynamicIsland)}>
              <div className="wizard-option-left">
                <div className="wizard-option-title">Dynamic Island</div>
                <div className="wizard-option-desc">In-game HUD with alerts, music, and notifications</div>
              </div>
              <div className={`wizard-toggle ${dynamicIsland ? 'on' : ''}`} />
            </div>

            <div className="wizard-option" onClick={() => setDiscordRPC(!discordRPC)}>
              <div className="wizard-option-left">
                <div className="wizard-option-title">Discord Rich Presence</div>
                <div className="wizard-option-desc">Show what you're playing on your Discord profile</div>
              </div>
              <div className={`wizard-toggle ${discordRPC ? 'on' : ''}`} />
            </div>
          </div>
        </div>

        {/* Step 3: Done */}
        <div className={pageClass(3)}>
          <div className="wizard-finish-icon">
            <svg viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="wizard-heading">You're all set.</div>
          <div className="wizard-caption">
            Everything's configured. You can adjust any of these in Settings at any time.
          </div>

          <div className="wizard-summary">
            <div className="wizard-summary-row">
              <span className="wizard-summary-key">Memory</span>
              <span className="wizard-summary-val">{ram} GB</span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-key">Dynamic Island</span>
              <span className="wizard-summary-val">{dynamicIsland ? 'On' : 'Off'}</span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-key">Discord RPC</span>
              <span className="wizard-summary-val">{discordRPC ? 'On' : 'Off'}</span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-key">Auto-close launcher</span>
              <span className="wizard-summary-val">{closeOnLaunch ? 'On' : 'Off'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer: dots + buttons */}
      <div className="wizard-footer">
        <div className="wizard-dots">
          {Array.from({ length: STEPS }).map((_, i) => (
            <div key={i} className={`wizard-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>

        <div className="wizard-footer-btns">
          {step === 0 && (
            <button className="wizard-btn wizard-btn-ghost" onClick={skip}>
              Skip
            </button>
          )}
          {step > 0 && (
            <button className="wizard-btn wizard-btn-secondary" onClick={back}>
              Back
            </button>
          )}
          <button className="wizard-btn wizard-btn-primary" onClick={next}>
            {step === 0 ? 'Get Started' : step === STEPS - 1 ? 'Done' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Custom RAM Slider ── */
function RamSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const min = 2, max = 16

  const pct = ((value - min) / (max - min)) * 100

  const updateFromEvent = (clientX: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const snapped = Math.round(ratio * (max - min) + min)
    onChange(snapped)
  }

  const onDown = (e: React.MouseEvent) => {
    dragging.current = true
    updateFromEvent(e.clientX)
    e.preventDefault()
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) updateFromEvent(e.clientX)
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, []) // eslint-disable-line

  return (
    <div className="wizard-slider-group">
      <div className="wizard-slider-header">
        <span className="wizard-slider-label">Allocated RAM</span>
        <span className="wizard-slider-value">{value} GB</span>
      </div>
      <div className="wizard-slider-track" ref={trackRef} onMouseDown={onDown}>
        <div className="wizard-slider-fill" style={{ width: `${pct}%` }} />
        <div className="wizard-slider-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="wizard-slider-ticks">
        <span className="wizard-slider-tick">2</span>
        <span className="wizard-slider-tick">4</span>
        <span className="wizard-slider-tick">8</span>
        <span className="wizard-slider-tick">12</span>
        <span className="wizard-slider-tick">16</span>
      </div>
    </div>
  )
}
