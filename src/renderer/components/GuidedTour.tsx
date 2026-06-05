import { useState, useEffect, useCallback, useRef } from 'react';
import './GuidedTour.css';

/* ──────────────────────────────────────────────────
   Tour Step Definitions
   ────────────────────────────────────────────────── */

interface TourStep {
  selector: string;
  page: string;
  title: string;
  description: string;
  padding: number;
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: '.sidebar',
    page: '/',
    title: 'Your Toolkit',
    description:
      'Everything in Loom lives here. Each icon opens a different tool — library, mods, skins, AI, and more.',
    padding: 4,
  },
  {
    selector: '.di-pill',
    page: '/',
    title: 'The Dynamic Island',
    description:
      'This pill tracks your game — launch progress, crashes, now playing, and more. Click to expand it.',
    padding: 6,
  },
  {
    selector: '.library-hero',
    page: '/',
    title: 'Your Library',
    description:
      'Create instances with any mod loader. Click the pencil icon to customize colors, memory, and backgrounds.',
    padding: 10,
  },
  {
    selector: '.spotify-widget',
    page: '/',
    title: 'Your Music, Here',
    description:
      'Connect Spotify in Settings to control your music, see lyrics, and hear it in-game.',
    padding: 8,
  },
  {
    selector: 'a[href="#/changing-room"]',
    page: '/changing-room',
    title: 'The Changing Room',
    description:
      'Browse and apply Minecraft skins without leaving the launcher.',
    padding: 6,
  },
  {
    selector: 'a[href="#/gemini"]',
    page: '/gemini',
    title: 'Meet Loomie',
    description:
      'Your AI companion knows every recipe, mob stat, and trick. Ask anything — or tell it to install mods.',
    padding: 6,
  },
  {
    selector: 'a[href="#/browse"]',
    page: '/browse',
    title: 'Mods & Resources',
    description:
      'Search thousands of mods and resource packs from Modrinth. Drag-and-drop .jar files to install manually.',
    padding: 6,
  },
  {
    selector: 'a[href="#/gallery"]',
    page: '/gallery',
    title: 'Your Content',
    description:
      'Screenshots and recordings show up here. Trim, merge, adjust speed, and share.',
    padding: 6,
  },
  {
    selector: 'a[href="#/bedrock"]',
    page: '/bedrock',
    title: 'Bedrock Edition',
    description:
      'Launch Bedrock, browse add-ons from MCPEDL and CurseForge — all in one place.',
    padding: 6,
  },
  {
    selector: 'a[href="#/settings"]',
    page: '/settings',
    title: 'Make It Yours',
    description:
      'Themes, performance, keybinds, connected apps — everything is configurable.',
    padding: 6,
  },
];

/* ──────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────── */

/** Get the current hash route without the leading '#' */
function currentRoute(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/';
}

/** Compute tooltip placement around the cutout rect */
function computeTooltipPos(
  rect: { x: number; y: number; w: number; h: number },
  tooltipWidth: number,
  tooltipHeight: number,
): { x: number; y: number } {
  const gap = 16;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const pad = 16; // viewport edge padding

  // Try right
  const rightX = rect.x + rect.w + gap;
  const rightY = rect.y + rect.h / 2 - tooltipHeight / 2;
  if (rightX + tooltipWidth + pad <= viewW) {
    return {
      x: rightX,
      y: clamp(rightY, pad, viewH - tooltipHeight - pad),
    };
  }

  // Try below
  const belowX = rect.x + rect.w / 2 - tooltipWidth / 2;
  const belowY = rect.y + rect.h + gap;
  if (belowY + tooltipHeight + pad <= viewH) {
    return {
      x: clamp(belowX, pad, viewW - tooltipWidth - pad),
      y: belowY,
    };
  }

  // Try left
  const leftX = rect.x - gap - tooltipWidth;
  const leftY = rect.y + rect.h / 2 - tooltipHeight / 2;
  if (leftX >= pad) {
    return {
      x: leftX,
      y: clamp(leftY, pad, viewH - tooltipHeight - pad),
    };
  }

  // Try above
  const aboveX = rect.x + rect.w / 2 - tooltipWidth / 2;
  const aboveY = rect.y - gap - tooltipHeight;
  if (aboveY >= pad) {
    return {
      x: clamp(aboveX, pad, viewW - tooltipWidth - pad),
      y: aboveY,
    };
  }

  // Fallback: best-effort below
  return {
    x: clamp(belowX, pad, viewW - tooltipWidth - pad),
    y: clamp(belowY, pad, viewH - tooltipHeight - pad),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/* ──────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────── */

export default function GuidedTour({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [transitioning, setTransitioning] = useState(false);
  const [entering, setEntering] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const stepRef = useRef(currentStep);
  stepRef.current = currentStep;

  /* ── Measure & position ────────────────────────── */

  const measureAndPosition = useCallback(
    (stepIndex: number, animate = true) => {
      const step = TOUR_STEPS[stepIndex];
      if (!step) return;

      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) {
        // Element not found — skip forward recursively
        if (stepIndex < TOUR_STEPS.length - 1) {
          const nextIdx = stepIndex + 1;
          const nextStep = TOUR_STEPS[nextIdx];
          setCurrentStep(nextIdx);

          // Handle page navigation if the next step is on a different page
          if (nextStep && currentRoute() !== nextStep.page) {
            window.location.hash = '#' + nextStep.page;
            setTimeout(() => measureAndPosition(nextIdx, animate), 400);
          } else {
            // Small delay to let DOM update after state change
            setTimeout(() => measureAndPosition(nextIdx, animate), 60);
          }
        } else {
          handleExit();
        }
        return;
      }

      const domRect = el.getBoundingClientRect();
      const padding = step.padding ?? 8;
      const newRect = {
        x: domRect.left - padding,
        y: domRect.top - padding,
        w: domRect.width + padding * 2,
        h: domRect.height + padding * 2,
      };

      setTargetRect(newRect);

      // Position tooltip after a frame so the ref has dimensions
      requestAnimationFrame(() => {
        if (tooltipRef.current) {
          const tw = tooltipRef.current.offsetWidth;
          const th = tooltipRef.current.offsetHeight;
          setTooltipPos(computeTooltipPos(newRect, tw, th));
        }
        if (animate) {
          // Show tooltip after cutout has moved
          setTimeout(() => {
            setTooltipVisible(true);
            setTransitioning(false);
          }, 280);
        } else {
          setTooltipVisible(true);
          setTransitioning(false);
        }
      });

      // Observe layout changes
      if (observerRef.current) observerRef.current.disconnect();
      const ro = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        const p = step.padding ?? 8;
        const updated = {
          x: r.left - p,
          y: r.top - p,
          w: r.width + p * 2,
          h: r.height + p * 2,
        };
        setTargetRect(updated);
        if (tooltipRef.current) {
          const tw = tooltipRef.current.offsetWidth;
          const th = tooltipRef.current.offsetHeight;
          setTooltipPos(computeTooltipPos(updated, tw, th));
        }
      });
      ro.observe(el);
      observerRef.current = ro;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ── Navigate to step ──────────────────────────── */

  const goToStep = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= TOUR_STEPS.length) return;

      const nextStep = TOUR_STEPS[nextIndex];
      const needsNav = currentRoute() !== nextStep.page;

      // Hide tooltip first
      setTransitioning(true);
      setTooltipVisible(false);

      const afterNav = () => {
        setCurrentStep(nextIndex);
        measureAndPosition(nextIndex, true);
      };

      if (needsNav) {
        window.location.hash = '#' + nextStep.page;
        setTimeout(afterNav, 400);
      } else {
        setTimeout(afterNav, 180); // allow tooltip to fade out
      }
    },
    [measureAndPosition],
  );

  /* ── Exit animation ────────────────────────────── */

  const handleExit = useCallback(() => {
    setTooltipVisible(false);
    setExiting(true);
    setTimeout(() => {
      onComplete();
    }, 420);
  }, [onComplete]);

  /* ── Navigation handlers ───────────────────────── */

  const handleNext = useCallback(() => {
    if (transitioning || exiting) return;
    if (currentStep >= TOUR_STEPS.length - 1) {
      handleExit();
    } else {
      goToStep(currentStep + 1);
    }
  }, [currentStep, transitioning, exiting, goToStep, handleExit]);

  const handlePrev = useCallback(() => {
    if (transitioning || exiting || currentStep <= 0) return;
    goToStep(currentStep - 1);
  }, [currentStep, transitioning, exiting, goToStep]);

  const handleSkip = useCallback(() => {
    if (exiting) return;
    handleExit();
  }, [exiting, handleExit]);

  /* ── Keyboard support ──────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNext, handlePrev, handleSkip]);

  /* ── Entrance ──────────────────────────────────── */

  useEffect(() => {
    // Initial setup: navigate to first step page if needed
    const firstStep = TOUR_STEPS[0];
    if (currentRoute() !== firstStep.page) {
      window.location.hash = '#' + firstStep.page;
    }

    // Start with a center-screen rect, then spring to target
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setTargetRect({
      x: vw / 2 - 20,
      y: vh / 2 - 20,
      w: 40,
      h: 40,
    });

    const timer = setTimeout(() => {
      setEntering(false);
      measureAndPosition(0, true);
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Cleanup observer on unmount ───────────────── */

  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, []);

  /* ── Render ────────────────────────────────────── */

  const step = TOUR_STEPS[currentStep];
  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  // Cutout rect values (default to center for entrance)
  const cx = targetRect?.x ?? window.innerWidth / 2 - 20;
  const cy = targetRect?.y ?? window.innerHeight / 2 - 20;
  const cw = targetRect?.w ?? 40;
  const ch = targetRect?.h ?? 40;
  const cr = 8;

  // SVG class
  let svgClass = 'guided-tour-svg';
  if (!entering) svgClass += ' guided-tour-svg--visible';
  if (entering) {
    // Fade in after first frame
    requestAnimationFrame(() => {
      const el = document.querySelector('.guided-tour-svg');
      if (el) el.classList.add('guided-tour-svg--visible');
    });
  }
  if (exiting) svgClass = 'guided-tour-svg guided-tour-svg--visible guided-tour-svg--exiting';

  // Tooltip class
  let tooltipClass = 'guided-tour-tooltip';
  if (tooltipVisible && !exiting) tooltipClass += ' guided-tour-tooltip--visible';
  if (transitioning) tooltipClass += ' guided-tour-tooltip--hiding';

  return (
    <>
      {/* ── SVG Overlay with mask cutout ──────────── */}
      <svg
        className={svgClass}
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="guided-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              className={`guided-tour-cutout${exiting ? ' guided-tour-cutout--exiting' : ''}`}
              x={cx}
              y={cy}
              width={cw}
              height={ch}
              rx={cr}
              fill="black"
            />
          </mask>
        </defs>

        {/* Dark overlay with cutout hole */}
        <rect
          width="100%"
          height="100%"
          fill="rgba(16,12,40,0.75)"
          mask="url(#guided-tour-mask)"
        />

        {/* Pulsing yellow ring around cutout */}
        {targetRect && !exiting && (
          <rect
            className="guided-tour-ring guided-tour-cutout"
            x={cx - 2}
            y={cy - 2}
            width={cw + 4}
            height={ch + 4}
            rx={cr + 1}
          />
        )}
      </svg>

      {/* ── Tooltip Card ─────────────────────────── */}
      <div
        className="guided-tour-tooltip-wrapper"
        style={{
          left: tooltipPos.x,
          top: tooltipPos.y,
          visibility: targetRect ? 'visible' : 'hidden',
        }}
      >
        <div ref={tooltipRef} className={tooltipClass}>
          <h3 className="guided-tour-title">{step.title}</h3>
          <p className="guided-tour-desc">{step.description}</p>

          <div className="guided-tour-footer">
            <button
              className="guided-tour-skip"
              onClick={handleSkip}
              type="button"
            >
              Skip Tour
            </button>

            <span className="guided-tour-counter">
              {currentStep + 1} of {TOUR_STEPS.length}
            </span>

            <button
              className={`guided-tour-next${isLastStep ? ' guided-tour-next--finish' : ''}`}
              onClick={handleNext}
              type="button"
            >
              {isLastStep ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
