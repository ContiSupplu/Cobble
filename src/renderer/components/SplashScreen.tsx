import { useState, useEffect, useRef } from 'react'
import './SplashScreen.css'
import loomIconHires from '../assets/loom-icon-hires.png'

interface SplashScreenProps {
  onComplete: () => void
  quickLaunchEnabled?: boolean
  onQuickLaunch?: () => void
}

export default function SplashScreen({ onComplete, quickLaunchEnabled, onQuickLaunch }: SplashScreenProps) {
  const [state, setState] = useState<'idle' | 'in' | 'done'>('idle')
  const [determinate, setDeterminate] = useState(false)
  const [fillWidth, setFillWidth] = useState(0)
  // Use refs to avoid stale closures in the preload effect
  const doneRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  // Trigger entrance animation on mount
  useEffect(() => {
    requestAnimationFrame(() => setState('in'))
  }, [])

  // Stable complete function — no dependency on state, uses ref
  const completeRef = useRef(() => {
    if (doneRef.current) return
    doneRef.current = true
    setState('done')
    setTimeout(() => {
      onCompleteRef.current()
    }, 400)
  })

  // Listen for preload progress from main process — runs ONCE on mount
  useEffect(() => {
    const api = (window as any).electronAPI
    const startTime = Date.now()
    const MIN_DISPLAY_MS = 800 // Just enough for the logo to register visually

    if (!api?.onPreloadProgress) {
      // No API — brief hold then finish
      const timer = setTimeout(() => completeRef.current(), 1500)
      return () => clearTimeout(timer)
    }

    let preloadDone = false

    const finishSplash = () => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed)

      // Fill bar to 100% before fading
      setDeterminate(true)
      setFillWidth(100)

      setTimeout(() => {
        completeRef.current()
      }, remaining + 300)
    }

    const unsub = api.onPreloadProgress((data: { step: string; progress: number }) => {
      if (data.progress > 0 && data.progress < 100) {
        setDeterminate(true)
        setFillWidth(data.progress)
      }

      if (data.progress >= 100 && !preloadDone) {
        preloadDone = true
        finishSplash()
      }
    })

    // Fallback: if preload doesn't complete within 4s, proceed anyway
    const fallback = setTimeout(() => {
      if (!preloadDone) {
        preloadDone = true
        finishSplash()
      }
    }, 4000)

    return () => {
      unsub?.()
      clearTimeout(fallback)
    }
  }, []) // Empty deps — runs once, uses refs for everything

  const stageClass = ['splash-stage', state].filter(Boolean).join(' ')

  return (
    <div id="splash-stage" className={stageClass}>
      <img
        className="splash-logo"
        src={loomIconHires}
        alt="Loom"
        draggable={false}
      />

      <div className={`splash-bar ${determinate ? 'determinate' : ''}`}>
        <div className="splash-sweep" />
        <div className="splash-fill" style={{ width: `${fillWidth}%` }} />
      </div>

      {/* Quick Launch button */}
      {quickLaunchEnabled && state !== 'done' && (
        <button
          className="splash-quick-launch"
          onClick={() => {
            setState('done')
            setTimeout(() => onQuickLaunch?.(), 400)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Quick Launch
        </button>
      )}
    </div>
  )
}
