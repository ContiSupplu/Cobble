import { useState, useEffect, useRef } from 'react'
import './SplashScreen.css'

interface SplashScreenProps {
  onComplete: () => void
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [progress, setProgress] = useState(0)
  const [step, setStep] = useState('Starting up...')
  const [fadeOut, setFadeOut] = useState(false)
  const smoothProgress = useRef(0)
  const animFrame = useRef<number | null>(null)

  // Listen for preload progress from main process
  useEffect(() => {
    const api = (window as any).electronAPI
    const startTime = Date.now()
    const MIN_DISPLAY_MS = 1800 // minimum time to show splash

    if (!api?.onPreloadProgress) {
      // No API available — just fade out after a moment
      const timer = setTimeout(() => {
        setFadeOut(true)
        setTimeout(onComplete, 800)
      }, 1500)
      return () => clearTimeout(timer)
    }

    let preloadDone = false

    const finishSplash = () => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed)

      // Ensure bar reaches 100 before fading
      smoothProgress.current = 100

      setTimeout(() => {
        setFadeOut(true)
        setTimeout(onComplete, 800)
      }, remaining + 400) // 400ms extra to show full bar
    }

    const unsub = api.onPreloadProgress((data: { step: string; progress: number }) => {
      setStep(data.step)
      smoothProgress.current = data.progress

      if (data.progress >= 100 && !preloadDone) {
        preloadDone = true
        finishSplash()
      }
    })

    // Fallback: if preload doesn't send 100% within 8s, proceed anyway
    const fallback = setTimeout(() => {
      if (!preloadDone) {
        preloadDone = true
        finishSplash()
      }
    }, 8000)

    return () => {
      unsub?.()
      clearTimeout(fallback)
    }
  }, [onComplete])

  // Smooth progress animation — fast enough to keep up
  useEffect(() => {
    const animate = () => {
      setProgress(prev => {
        const target = smoothProgress.current
        const diff = target - prev
        if (Math.abs(diff) < 0.3) return target
        return prev + diff * 0.18
      })
      animFrame.current = requestAnimationFrame(animate)
    }
    animFrame.current = requestAnimationFrame(animate)
    return () => {
      if (animFrame.current) cancelAnimationFrame(animFrame.current)
    }
  }, [])

  return (
    <div className={`splash ${fadeOut ? 'splash-fade-out' : ''}`}>
      <video
        className="splash-video"
        src="./login-bg.mp4"
        autoPlay
        loop
        muted
        playsInline
      />
      <div className="splash-overlay" />

      {/* Floating particles */}
      <div className="splash-particles">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="splash-particle"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 6}s`,
              animationDuration: `${6 + Math.random() * 8}s`,
              opacity: 0.15 + Math.random() * 0.25,
              width: `${2 + Math.random() * 3}px`,
              height: `${2 + Math.random() * 3}px`,
            }}
          />
        ))}
      </div>

      {/* Center content */}
      <div className="splash-content">
        <div className="splash-logo-group">
          <div className="splash-logo">Loom</div>
          <div className="splash-tagline">Minecraft Launcher</div>
        </div>

        <div className="splash-progress-area">
          <div className="splash-progress-track">
            <div
              className="splash-progress-fill"
              style={{ width: `${progress}%` }}
            />
            <div
              className="splash-progress-glow"
              style={{ left: `${progress}%` }}
            />
          </div>
          <div className="splash-step">
            <span className="splash-step-text">{step}</span>
            <span className="splash-step-pct">{Math.round(progress)}%</span>
          </div>
        </div>
      </div>

      <div className="splash-credit">Credit: Roburrito DX</div>
    </div>
  )
}
