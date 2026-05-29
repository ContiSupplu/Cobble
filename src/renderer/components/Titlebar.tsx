import DynamicIsland from './DynamicIsland'
import { useAuth } from '../context/AuthContext'
import '../styles/titlebar.css'

interface TitlebarProps {
  onOpenLogs?: () => void
}

export default function Titlebar({ onOpenLogs }: TitlebarProps) {
  const { incognitoEnabled } = useAuth()
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
          {incognitoEnabled && (
            <span className="titlebar-incognito-badge" title="Incognito Mode Active">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              Incognito
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
