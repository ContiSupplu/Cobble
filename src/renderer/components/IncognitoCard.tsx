import { useState } from 'react'
import './IncognitoCard.css'

interface IncognitoCardProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  selectedRegion: string
  onRegionChange: (region: string) => void
  disabled?: boolean
  disabledReason?: string
}

const REGIONS = [
  { id: 'us-east', name: 'US East' },
  { id: 'us-west', name: 'US West' },
  { id: 'uk', name: 'United Kingdom' },
  { id: 'australia', name: 'Australia' },
]

export default function IncognitoCard({
  enabled,
  onToggle,
  selectedRegion,
  onRegionChange,
  disabled = false,
  disabledReason = 'Incognito requires Fabric or Forge',
}: IncognitoCardProps) {
  const [regionOpen, setRegionOpen] = useState(false)
  const activeRegion = REGIONS.find(r => r.id === selectedRegion)

  return (
    <div
      className={`incognito${disabled ? ' incognito--disabled' : ''}`}
      title={disabled ? disabledReason : undefined}
    >
      {/* Main row */}
      <div className="incognito-row">
        <div className="incognito-left">
          <svg className={`incognito-shield${enabled ? ' on' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
          <div>
            <div className="incognito-label">Incognito</div>
            {enabled && (
              <button
                className="incognito-region-trigger"
                onClick={() => setRegionOpen(!regionOpen)}
              >
                {activeRegion?.name ?? 'Select region'}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <label className="incognito-switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onToggle(e.target.checked)}
          />
          <span className="incognito-switch-track" />
        </label>
      </div>

      {/* Region dropdown */}
      {enabled && regionOpen && (
        <>
          <div className="incognito-backdrop" onClick={() => setRegionOpen(false)} />
          <div className="incognito-dropdown">
            {REGIONS.map(region => (
              <button
                key={region.id}
                className={`incognito-option${region.id === selectedRegion ? ' selected' : ''}`}
                onClick={() => { onRegionChange(region.id); setRegionOpen(false) }}
              >
                {region.name}
                {region.id === selectedRegion && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Disclaimer — only when enabled */}
      {enabled && (
        <div className="incognito-fine">
          Using incognito to bypass server bans may lead to permanent bans. Loom is not responsible for your actions.
        </div>
      )}
    </div>
  )
}
