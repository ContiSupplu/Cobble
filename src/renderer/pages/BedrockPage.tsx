import { useState, useEffect, useRef, useCallback } from 'react'
import './BedrockPage.css'

const api = (window as any).electronAPI

const BEDROCK_SITES = [
  { id: 'mcpedl', label: 'MCPEDL', url: 'https://mcpedl.com/category/mods/' },
  { id: 'curseforge', label: 'CurseForge', url: 'https://www.curseforge.com/minecraft-bedrock' },
  { id: 'modbay', label: 'ModBay', url: 'https://modbay.org/' },
  { id: 'planetmc', label: 'Planet MC', url: 'https://www.planetminecraft.com/data-packs/?platform=bedrock' },
]

/* ── SVG Icon components ── */
const I = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function IconCube(props: any) {
  return <svg {...I} {...props}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
}
function IconGlobe(props: any) {
  return <svg {...I} {...props}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
}
function IconPalette(props: any) {
  return <svg {...I} {...props}><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="11.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.65 1.5-1.38 0-.35-.14-.65-.36-.88-.23-.23-.36-.56-.36-.88 0-.73.57-1.38 1.5-1.38H16c3.3 0 6-2.7 6-6 0-5.18-4.5-9.48-10-9.48z"/></svg>
}
function IconGear(props: any) {
  return <svg {...I} {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
}
function IconFolder(props: any) {
  return <svg {...I} {...props}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
}
function IconMap(props: any) {
  return <svg {...I} {...props}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
}
function IconMaximize(props: any) {
  return <svg {...I} {...props}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
}
function IconMinimize(props: any) {
  return <svg {...I} {...props}><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
}
function IconChevron(props: any) {
  return <svg {...I} {...props}><polyline points="9 18 15 12 9 6"/></svg>
}
function IconBack(props: any) {
  return <svg {...I} {...props}><polyline points="15 18 9 12 15 6"/></svg>
}

export default function BedrockPage() {
  const [view, setView] = useState<'home' | 'browser'>('home')
  const [activeSite, setActiveSite] = useState(BEDROCK_SITES[0])
  const [bedrockInfo, setBedrockInfo] = useState<any>(null)
  const [worlds, setWorlds] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const webviewRef = useRef<any>(null)

  useEffect(() => { loadBedrockData() }, [])

  async function loadBedrockData() {
    setLoading(true)
    try {
      const info = await api.bedrockDetect()
      setBedrockInfo(info)
      if (info.installed) {
        const w = await api.bedrockWorlds()
        setWorlds(w)
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleLaunch() {
    setLaunching(true)
    await api.bedrockLaunch()
    setTimeout(() => setLaunching(false), 3000)
  }

  const openSite = useCallback((site: typeof BEDROCK_SITES[0]) => {
    setActiveSite(site)
    setView('browser')
  }, [])

  // ── Browser view ──
  if (view === 'browser') {
    return (
      <div className={`bedrock-page${fullscreen ? ' fullscreen' : ''}`}>
        <div className="bedrock-browser-bar">
          <button className="bedrock-back-btn" onClick={() => { setView('home'); setFullscreen(false) }}>
            <IconBack width={16} height={16} />
          </button>
          <div className="bedrock-browser-tabs">
            {BEDROCK_SITES.map(site => (
              <button
                key={site.id}
                className={`bedrock-browser-tab${activeSite.id === site.id ? ' active' : ''}`}
                onClick={() => setActiveSite(site)}
              >
                {site.label}
              </button>
            ))}
          </div>
          <button className="bedrock-fullscreen-btn" onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {fullscreen ? <IconMinimize width={14} height={14} /> : <IconMaximize width={14} height={14} />}
          </button>
        </div>
        <div className="bedrock-browser-content">
          <webview
            key={activeSite.id}
            ref={webviewRef}
            src={activeSite.url}
            className="bedrock-webview"
            /* @ts-ignore */
            allowpopups="true"
          />
        </div>
      </div>
    )
  }

  // ── Home view ──
  return (
    <div className="bedrock-page">
      <div className="bedrock-home">
        <div className="bedrock-header">
          <h1 className="bedrock-title">Bedrock Edition</h1>
        </div>

        {loading ? (
          <div className="bedrock-status-card">
            <div className="bedrock-spinner" />
            <span>Detecting Bedrock Edition…</span>
          </div>
        ) : !bedrockInfo?.installed ? (
          <div className="bedrock-status-card">
            <IconCube width={32} height={32} style={{ opacity: 0.3 }} />
            <span className="bedrock-status-msg">Bedrock Edition is not installed</span>
            <button
              className="bedrock-glass-btn"
              onClick={() => api.openExternal('ms-windows-store://pdp/?productid=9NBLGGH2JHXJ')}
            >
              Get from Microsoft Store
            </button>
          </div>
        ) : (
          <>
            {/* Hero card */}
            <div className="bedrock-hero">
              <div className="bedrock-hero-left">
                <div className="bedrock-hero-icon">
                  <IconCube width={24} height={24} />
                </div>
                <div className="bedrock-hero-info">
                  <div className="bedrock-hero-name">Minecraft Bedrock</div>
                  <div className="bedrock-hero-meta">v{bedrockInfo.version} · Windows</div>
                </div>
              </div>
              <div className="bedrock-hero-right">
                <button className="bedrock-fav-btn" onClick={() => api.bedrockOpenFolder('root')} title="Open folder">
                  <IconFolder width={16} height={16} />
                </button>
                <button
                  className={`bedrock-play${launching ? ' launching' : ''}`}
                  onClick={handleLaunch}
                  disabled={launching}
                >
                  {launching ? 'Launching…' : 'Play'}
                </button>
              </div>
            </div>

            {/* Worlds */}
            {worlds.length > 0 && (
              <div className="bedrock-section">
                <div className="bedrock-section-head">
                  <span className="bedrock-section-label">Worlds</span>
                  <button className="bedrock-refresh" onClick={loadBedrockData}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                  </button>
                </div>
                <div className="bedrock-worlds">
                  {worlds.map((w: any) => (
                    <div key={w.id} className="bedrock-world">
                      <div className="bedrock-world-icon">
                        {w.icon ? <img src={w.icon} alt={w.name} /> : <IconGlobe width={20} height={20} />}
                      </div>
                      <div className="bedrock-world-text">
                        <div className="bedrock-world-name">{w.name}</div>
                        <div className="bedrock-world-meta">{w.sizeMB} MB · {new Date(w.lastPlayed).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Folders */}
            <div className="bedrock-section">
              <span className="bedrock-section-label">Folders</span>
              <div className="bedrock-folders">
                <button className="bedrock-folder" onClick={() => api.bedrockOpenFolder('worlds')}>
                  <IconMap width={16} height={16} />
                  <span>Worlds</span>
                </button>
                <button className="bedrock-folder" onClick={() => api.bedrockOpenFolder('resource_packs')}>
                  <IconPalette width={16} height={16} />
                  <span>Resources</span>
                </button>
                <button className="bedrock-folder" onClick={() => api.bedrockOpenFolder('behavior_packs')}>
                  <IconGear width={16} height={16} />
                  <span>Behaviors</span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* Browse Add-Ons */}
        <div className="bedrock-section">
          <span className="bedrock-section-label">Browse Add-Ons</span>
          <div className="bedrock-sites">
            {BEDROCK_SITES.map(site => (
              <button key={site.id} className="bedrock-site-card" onClick={() => openSite(site)}>
                <span className="bedrock-site-name">{site.label}</span>
                <IconChevron width={14} height={14} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
