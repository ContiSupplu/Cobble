import { useNavigate } from 'react-router-dom'
import './PrivacyPolicyPage.css'

// ==== Privacy Policy Section Data ====

interface PolicySection {
  title: string
  icon: React.ReactNode
  items: string[]
  note?: string
}

const SECTIONS_COLLECTED: PolicySection = {
  title: 'What Loom Stores',
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  items: [
    'Microsoft & Minecraft authentication tokens — stored locally, encrypted with OS keychain via safeStorage',
    'Game settings and preferences — stored locally in app config',
    'Spotify, Twitch, and Discord tokens if connected — stored locally, encrypted',
    'Mod lists and instance configurations — stored locally',
  ],
  note: 'All data listed above is stored exclusively on your computer. Nothing is uploaded to any Loom server.',
}

const SECTIONS_NOT_COLLECTED: PolicySection = {
  title: 'What Loom Does NOT Collect',
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ),
  items: [
    'No telemetry or analytics — ever',
    'No usage tracking or behavioral profiling',
    'No personal information sent to our servers',
    'No browsing history from the in-game browser',
    'No gameplay data, screenshots, or recordings',
  ],
}

interface ThirdPartyService {
  name: string
  desc: string
  color: string
}

const THIRD_PARTY_SERVICES: ThirdPartyService[] = [
  { name: 'Modrinth API', desc: 'Mod search, metadata, and downloads', color: '#1bd96a' },
  { name: 'Spotify API', desc: 'Music playback control (if connected)', color: '#1ed760' },
  { name: 'Twitch API', desc: 'Stream data and integration (if connected)', color: '#9146ff' },
  { name: 'Google Gemini API', desc: 'AI chat assistant (if API key provided by user)', color: '#4285f4' },
  { name: 'Microsoft Auth', desc: 'Minecraft account login authentication', color: '#00a4ef' },
]

// ==== Component ====

export default function PrivacyPolicyPage() {
  const navigate = useNavigate()

  return (
    <div className="privacy page-enter">
      {/* Back button */}
      <button className="privacy-back" onClick={() => navigate('/settings')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Settings
      </button>

      <h1 className="privacy-title">Privacy Policy</h1>
      <p className="privacy-subtitle">
        Loom is built with privacy as a core principle. Your data stays on your machine.
      </p>

      {/* ── What Loom Stores ── */}
      <div className="privacy-section">
        <div className="privacy-section-header">
          <div className="privacy-section-icon privacy-icon-shield">
            {SECTIONS_COLLECTED.icon}
          </div>
          <div className="privacy-label">{SECTIONS_COLLECTED.title}</div>
        </div>
        <div className="privacy-card">
          {SECTIONS_COLLECTED.items.map((item, i) => (
            <div key={i} className={`privacy-row${i === SECTIONS_COLLECTED.items.length - 1 ? ' last' : ''}`}>
              <div className="privacy-row-bullet" />
              <div className="privacy-row-text">{item}</div>
            </div>
          ))}
          {SECTIONS_COLLECTED.note && (
            <div className="privacy-note">{SECTIONS_COLLECTED.note}</div>
          )}
        </div>
      </div>

      {/* ── What Loom Does NOT Collect ── */}
      <div className="privacy-section">
        <div className="privacy-section-header">
          <div className="privacy-section-icon privacy-icon-no">
            {SECTIONS_NOT_COLLECTED.icon}
          </div>
          <div className="privacy-label">{SECTIONS_NOT_COLLECTED.title}</div>
        </div>
        <div className="privacy-card">
          {SECTIONS_NOT_COLLECTED.items.map((item, i) => (
            <div key={i} className={`privacy-row${i === SECTIONS_NOT_COLLECTED.items.length - 1 ? ' last' : ''}`}>
              <div className="privacy-row-check">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="privacy-row-text">{item}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Third-Party Services ── */}
      <div className="privacy-section">
        <div className="privacy-section-header">
          <div className="privacy-section-icon privacy-icon-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <div className="privacy-label">Third-Party Services</div>
        </div>
        <p className="privacy-desc">
          Data is sent <em>to</em> these services when you use them — Loom does not collect any of it.
        </p>
        <div className="privacy-services">
          {THIRD_PARTY_SERVICES.map((svc) => (
            <div key={svc.name} className="privacy-service">
              <div className="privacy-service-dot" style={{ background: svc.color, boxShadow: `0 0 8px ${svc.color}44` }} />
              <div className="privacy-service-info">
                <div className="privacy-service-name">{svc.name}</div>
                <div className="privacy-service-desc">{svc.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Data Storage ── */}
      <div className="privacy-section">
        <div className="privacy-section-header">
          <div className="privacy-section-icon privacy-icon-storage">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </div>
          <div className="privacy-label">Data Storage</div>
        </div>
        <div className="privacy-card">
          <div className="privacy-row">
            <div className="privacy-row-bullet" />
            <div className="privacy-row-text">All data stored locally on your computer</div>
          </div>
          <div className="privacy-row">
            <div className="privacy-row-bullet" />
            <div className="privacy-row-text">Auth tokens encrypted with OS-level encryption (Windows DPAPI via Electron safeStorage)</div>
          </div>
          <div className="privacy-row">
            <div className="privacy-row-bullet" />
            <div className="privacy-row-text">No cloud storage, no remote databases</div>
          </div>
          <div className="privacy-row last">
            <div className="privacy-row-bullet" />
            <div className="privacy-row-text">Delete the app folder to remove all data completely</div>
          </div>
        </div>
      </div>

      {/* ── Loom Shield ── */}
      <div className="privacy-section">
        <div className="privacy-section-header">
          <div className="privacy-section-icon privacy-icon-loomshield">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </div>
          <div className="privacy-label">Loom Shield</div>
        </div>
        <div className="privacy-card">
          <div className="privacy-row">
            <div className="privacy-row-bullet" />
            <div className="privacy-row-text">Protects against server-side exploits on the client</div>
          </div>
          <div className="privacy-row">
            <div className="privacy-row-bullet" />
            <div className="privacy-row-text">Does not send any data to external servers</div>
          </div>
          <div className="privacy-row last">
            <div className="privacy-row-bullet" />
            <div className="privacy-row-text">All protection logic runs entirely on your machine</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="privacy-footer">
        <p>Last updated: May 2026</p>
        <p>If you have questions, open an issue on the Loom GitHub repository.</p>
      </div>
    </div>
  )
}
