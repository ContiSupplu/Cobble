import DynamicIsland from './DynamicIsland'
import { useAuth } from '../context/AuthContext'
import '../styles/titlebar.css'

interface TitlebarProps {
  onOpenLogs?: () => void
}

export default function Titlebar({ onOpenLogs }: TitlebarProps) {
  const { privacyEnabled } = useAuth()
  const svgProps = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
  }

  return (
    <>
      <header className="titlebar">
        <div className="titlebar-brand">
          {privacyEnabled && (
            <span className="titlebar-privacy-badge" title="Privacy Mode Active">
              🛡 Privacy Mode
            </span>
          )}
        </div>
        <div className="titlebar-drag" />
        <div className="titlebar-controls">
          <button
            className="titlebar-btn"
            onClick={() => window.electronAPI?.minimizeWindow()}
            aria-label="Minimize"
          >
            <svg {...svgProps}>
              <line x1="4" y1="8" x2="12" y2="8" />
            </svg>
          </button>
          <button
            className="titlebar-btn"
            onClick={() => window.electronAPI?.maximizeWindow()}
            aria-label="Maximize"
          >
            <svg {...svgProps}>
              <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
            </svg>
          </button>
          <button
            className="titlebar-btn titlebar-btn--close"
            onClick={() => window.electronAPI?.closeWindow()}
            aria-label="Close"
          >
            <svg {...svgProps}>
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      </header>
      <DynamicIsland onOpenLogs={onOpenLogs} />
    </>
  )
}
