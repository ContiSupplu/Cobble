import { useState, useEffect, useCallback, useRef } from 'react'
import './WelcomeWalkthrough.css'

/* ═══════════════════════════════════════════════════════
   Welcome Walkthrough — One UI 8-inspired post-update screen
   ═══════════════════════════════════════════════════════ */

export interface WalkthroughSlide {
  title: string
  subtitle?: string
  bullets?: string[]
  emoji?: string
  gradient?: string
}

export interface WelcomeWalkthroughProps {
  version: string
  slides: WalkthroughSlide[]
  onComplete: () => void
}

export default function WelcomeWalkthrough({ version, slides, onComplete }: WelcomeWalkthroughProps) {
  const [current, setCurrent] = useState(0)
  const [prevIndex, setPrevIndex] = useState(-1)
  const [exiting, setExiting] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isLast = current === slides.length - 1

  /* ── Navigation ── */

  const goTo = useCallback((index: number) => {
    if (index < 0 || index >= slides.length || index === current) return
    setPrevIndex(current)
    setCurrent(index)
  }, [current, slides.length])

  const next = useCallback(() => {
    if (isLast) {
      setExiting(true)
      setTimeout(onComplete, 650)
    } else {
      goTo(current + 1)
    }
  }, [isLast, current, goTo, onComplete])

  const prev = useCallback(() => {
    if (current > 0) goTo(current - 1)
  }, [current, goTo])

  const skip = useCallback(() => {
    setExiting(true)
    setTimeout(onComplete, 650)
  }, [onComplete])

  /* ── Keyboard ── */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        skip()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [next, prev, skip])

  /* ── Reset stagger keys on slide change ── */

  const slideKey = current

  return (
    <div
      ref={containerRef}
      className={`walkthrough${exiting ? ' walkthrough-exit' : ''}`}
    >
      {/* Gradient background layers — one per slide, crossfade */}
      <div className="walkthrough-bg">
        {slides.map((slide, i) => (
          <div
            key={i}
            className={`walkthrough-bg-layer${i === current ? ' active' : ''}`}
            style={{ background: slide.gradient || 'linear-gradient(135deg, #1a1a2e 0%, #0d0d0d 100%)' }}
          />
        ))}
      </div>

      {/* Skip */}
      <button className="walkthrough-skip" onClick={skip}>
        Skip
      </button>

      {/* Version badge */}
      <div className="wk-version">v{version}</div>

      {/* Slides */}
      <div className="walkthrough-slides">
        {slides.map((slide, i) => (
          <SlideView
            key={i}
            slide={slide}
            index={i}
            current={current}
            prevIndex={prevIndex}
            slideKey={slideKey}
          />
        ))}
      </div>

      {/* Bottom controls */}
      <div className="walkthrough-controls">
        <button
          className={`wk-btn-continue${isLast ? ' final' : ''}`}
          onClick={next}
        >
          {isLast ? "Let's Go" : 'Continue'}
        </button>

        <div className="wk-dots">
          {slides.map((_, i) => (
            <button
              key={i}
              className={`wk-dot${i === current ? ' active' : i < current ? ' visited' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}


/* ── Slide renderer ── */

function SlideView({
  slide,
  index,
  current,
  prevIndex,
  slideKey,
}: {
  slide: WalkthroughSlide
  index: number
  current: number
  prevIndex: number
  slideKey: number
}) {
  const isActive = index === current
  const isExiting = index === prevIndex

  let className = 'wk-slide'
  if (isActive) className += ' active'
  else if (isExiting) className += ' exiting'

  return (
    <div className={className}>
      <div className="wk-slide-content">
        {slide.emoji && (
          <div className="wk-emoji" key={`emoji-${slideKey}`}>
            {slide.emoji}
          </div>
        )}

        <h1 className="wk-title" key={`title-${slideKey}`}>
          {slide.title}
        </h1>

        {slide.subtitle && (
          <p className="wk-subtitle" key={`sub-${slideKey}`}>
            {slide.subtitle}
          </p>
        )}

        {slide.bullets && slide.bullets.length > 0 && (
          <ul className="wk-bullets">
            {slide.bullets.map((bullet, bi) => (
              <li
                key={`${slideKey}-b-${bi}`}
                className="wk-bullet"
                style={{ animationDelay: `${380 + bi * 80}ms` }}
              >
                {bullet}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
