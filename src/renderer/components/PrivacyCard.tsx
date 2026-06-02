import { useState } from 'react'
import './PrivacyCard.css'

interface PrivacyCardProps {
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

export default function PrivacyCard({
  enabled,
  onToggle,
  selectedRegion,
  onRegionChange,
  disabled = false,
  disabledReason = 'Privacy Mode requires Fabric or Forge',
}: PrivacyCardProps) {
  const [regionOpen, setRegionOpen] = useState(false)
  const activeRegion = REGIONS.find(r => r.id === selectedRegion)

  return (
    <div
      className={`privacy${disabled ? ' privacy--disabled' : ''}`}
      title={disabled ? disabledReason : undefined}
    >
      {/* Main row */}
      <div className="privacy-row">
        <div className="privacy-left">
          <span className={`privacy-shield${enabled ? ' on' : ''}`}>🛡</span>
          <div>
            <div className="privacy-label">Privacy Mode</div>
            {enabled && (
              <button
                className="privacy-region-trigger"
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

        <label className="privacy-switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onToggle(e.target.checked)}
          />
          <span className="privacy-switch-track" />
        </label>
      </div>

      {/* Region dropdown */}
      {enabled && regionOpen && (
        <>
          <div className="privacy-backdrop" onClick={() => setRegionOpen(false)} />
          <div className="privacy-dropdown">
            {REGIONS.map(region => (
              <button
                key={region.id}
                className={`privacy-option${region.id === selectedRegion ? ' selected' : ''}`}
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
        <div className="privacy-fine">
          Privacy Mode routes your connection through a VPN proxy. Others can still see your username. Bypassing server bans may lead to permanent bans.
        </div>
      )}
    </div>
  )
}
