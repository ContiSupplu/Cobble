import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import './ShareCardModal.css'

const api = (window as any).electronAPI

/* ══════════════════════════════════════════
   Types
   ══════════════════════════════════════════ */

interface ShareCardModalProps {
  instance: {
    id: string
    name: string
    version: string
    loader: string
    mods: number
    color?: string
    backgroundImage?: string
    memoryMax?: number
  }
  user: {
    uuid: string
    username: string
  } | null
  onClose: () => void
}

interface ManifestMod {
  slug: string
  name: string
  description?: string
  icon_url?: string
  version: string
  projectId: string
  source: string
  category: string
  required: boolean
  fileName: string
}

interface ManifestPack {
  name: string
  fileName: string
}

interface Manifest {
  instance: {
    name: string
    version: string
    loader: string
    loaderVersion: string
    memoryMax: number
  }
  mods: ManifestMod[]
  shaderPacks: ManifestPack[]
  resourcePacks: ManifestPack[]
}

type ModalState = 'loading' | 'editing' | 'publishing' | 'published'

/* ══════════════════════════════════════════
   Category helpers
   ══════════════════════════════════════════ */

const CATEGORY_LABELS: Record<string, string> = {
  performance: 'Performance',
  content: 'Content',
  library: 'Library',
  utility: 'Utility',
  worldgen: 'World Gen',
  decoration: 'Decoration',
  other: 'Other',
}

const CATEGORY_ORDER = ['performance', 'content', 'utility', 'worldgen', 'decoration', 'library', 'other']

function categorizeMods(mods: ManifestMod[]) {
  const groups: Record<string, ManifestMod[]> = {}
  for (const mod of mods) {
    const cat = CATEGORY_ORDER.includes(mod.category) ? mod.category : 'other'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(mod)
  }
  return CATEGORY_ORDER
    .filter(cat => groups[cat]?.length)
    .map(cat => ({ key: cat, label: CATEGORY_LABELS[cat] ?? cat, mods: groups[cat] }))
}

/* ══════════════════════════════════════════
   SVG Icons (inline, no icon lib)
   ══════════════════════════════════════════ */

const Icons = {
  share: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  puzzle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 16V7a2 2 0 00-2-2H6a2 2 0 00-2 2v9m16 0H4m16 0l1.28 2.55a1 1 0 01-.9 1.45H3.62a1 1 0 01-.9-1.45L4 16" />
    </svg>
  ),
  shader: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1 3 1z" />
    </svg>
  ),
  palette: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="2.5" /><path d="M17.5 10.5l-5-5L2 16l6 6 4-4" />
      <path d="M15 17l5 5" /><path d="M20 12l-9.5 9.5" />
    </svg>
  ),
  version: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  loom: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  ),
}

/* ══════════════════════════════════════════
   Mod Icon with fallback
   ══════════════════════════════════════════ */

function ModIcon({ iconUrl, projectId }: { iconUrl?: string; projectId?: string }) {
  const [failed, setFailed] = useState(false)
  const src = iconUrl || (projectId ? `https://cdn.modrinth.com/data/${projectId}/icon.png` : '')

  if (!src || failed) {
    return <div className="share-modal-mod-icon share-modal-mod-icon-fallback">{Icons.puzzle}</div>
  }

  return (
    <img
      className="share-modal-mod-icon"
      src={src}
      alt=""
      onError={() => setFailed(true)}
    />
  )
}

/* ══════════════════════════════════════════
   Component
   ══════════════════════════════════════════ */
export default function ShareCardModal({ instance, user, onClose }: ShareCardModalProps) {
  const [state, setState] = useState<ModalState>('loading')
  const [manifest, setManifest] = useState<Manifest | null>(null)

  // Form state
  const [cardName, setCardName] = useState(instance.name)
  const [description, setDescription] = useState('')
  const [includeMods, setIncludeMods] = useState(true)
  const [includeShaders, setIncludeShaders] = useState(true)
  const [includeResourcePacks, setIncludeResourcePacks] = useState(true)
  const [includeVersion, setIncludeVersion] = useState(true)
  const [excludedMods, setExcludedMods] = useState<Set<string>>(new Set())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Published state
  const [publishedUrl, setPublishedUrl] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [toastIsError, setToastIsError] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load manifest on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await api?.cardsGenerateManifest?.(instance.id)
        if (!cancelled && m) {
          setManifest(m)
          // Auto-expand first category
          const cats = categorizeMods(m.mods)
          if (cats.length > 0) {
            setExpandedCategories(new Set([cats[0].key]))
          }
          setState('editing')
        }
      } catch {
        if (!cancelled) setState('editing')
      }
    })()
    return () => { cancelled = true }
  }, [instance.id])

  // Toast helper
  const showToast = useCallback((msg: string, isError = false) => {
    setToastMessage(msg)
    setToastIsError(isError)
    setToastVisible(true)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2500)
  }, [])

  // Cleanup toast timer
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  // Categorized mods
  const modCategories = useMemo(
    () => manifest ? categorizeMods(manifest.mods) : [],
    [manifest]
  )

  // Active mod count
  const activeModCount = useMemo(() => {
    if (!manifest || !includeMods) return 0
    return manifest.mods.filter(m => !excludedMods.has(m.slug)).length
  }, [manifest, includeMods, excludedMods])

  // Toggle mod
  const toggleMod = useCallback((slug: string) => {
    setExcludedMods(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }, [])

  // Toggle category expand
  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  // Select/deselect all in category
  const selectAllInCategory = useCallback((mods: ManifestMod[]) => {
    setExcludedMods(prev => {
      const next = new Set(prev)
      for (const m of mods) next.delete(m.slug)
      return next
    })
  }, [])

  const deselectAllInCategory = useCallback((mods: ManifestMod[]) => {
    setExcludedMods(prev => {
      const next = new Set(prev)
      for (const m of mods) next.add(m.slug)
      return next
    })
  }, [])

  // Publish handler
  const handlePublish = useCallback(async () => {
    if (!manifest) return
    setState('publishing')
    try {
      const options = {
        cardName: cardName.trim() || instance.name,
        description: description.trim(),
        includeMods,
        includeShaders,
        includeResourcePacks,
        includeVersion,
        excludedMods: Array.from(excludedMods),
      }
      const result = await api?.cardsPublish?.(manifest, options)
      if (result?.url) {
        setPublishedUrl(result.url)
        // Auto-copy to clipboard
        try { await api?.writeClipboard?.(result.url) } catch {}
        setState('published')
      } else {
        showToast('Failed to create card', true)
        setState('editing')
      }
    } catch (err) {
      console.error('Publish failed:', err)
      showToast('Something went wrong', true)
      setState('editing')
    }
  }, [manifest, cardName, description, includeMods, includeShaders, includeResourcePacks, includeVersion, excludedMods, instance.name, showToast])

  // Copy to clipboard
  const copyUrl = useCallback(async () => {
    try {
      await api?.writeClipboard?.(publishedUrl)
      showToast('Link copied to clipboard!')
    } catch {
      showToast('Failed to copy link', true)
    }
  }, [publishedUrl, showToast])

  // Open in browser
  const openInBrowser = useCallback(() => {
    api?.openExternal?.(publishedUrl)
  }, [publishedUrl])

  // Share on Discord (copy with markdown formatting)
  const shareOnDiscord = useCallback(async () => {
    const msg = `Check out my Loom Card: **${cardName}**\n${publishedUrl}`
    try {
      await api?.writeClipboard?.(msg)
      showToast('Discord message copied!')
    } catch {
      showToast('Failed to copy', true)
    }
  }, [publishedUrl, cardName, showToast])

  // ESC to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  /* ── Card Preview renderer ── */
  const renderCardPreview = () => (
    <div className="share-modal-card">
      {/* Banner */}
      <div className="share-modal-card-banner">
        <div className="share-modal-card-banner-bg" style={instance.color ? { background: instance.color } : undefined}>
          {instance.backgroundImage && (
            <img src={instance.backgroundImage} alt="" />
          )}
        </div>
        <div className="share-modal-card-banner-overlay" />
      </div>

      {/* Content */}
      <div className="share-modal-card-content">
        {/* Author */}
        {user && (
          <div className="share-modal-card-author">
            <img
              className="share-modal-card-avatar"
              src={`https://mc-heads.net/avatar/${user.uuid}/24`}
              alt={user.username}
            />
            <span className="share-modal-card-username">{user.username}</span>
          </div>
        )}

        {/* Name */}
        <div className="share-modal-card-name">
          {cardName || instance.name}
        </div>

        {/* Description */}
        {description && (
          <div className="share-modal-card-desc">{description}</div>
        )}

        {/* Badges */}
        <div className="share-modal-card-badges">
          {includeVersion && (
            <span className="share-modal-card-badge">
              {Icons.version}
              {manifest?.instance.version ?? instance.version}
            </span>
          )}
          {includeVersion && (
            <span className="share-modal-card-badge">
              {manifest?.instance.loader ?? instance.loader}
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="share-modal-card-stats">
          {includeMods && (
            <div className="share-modal-card-stat">
              {Icons.puzzle}
              <span className="share-modal-card-stat-value">{activeModCount}</span>
              mods
            </div>
          )}
          {includeShaders && manifest && manifest.shaderPacks.length > 0 && (
            <div className="share-modal-card-stat">
              {Icons.shader}
              <span className="share-modal-card-stat-value">{manifest.shaderPacks.length}</span>
              shaders
            </div>
          )}
          {includeResourcePacks && manifest && manifest.resourcePacks.length > 0 && (
            <div className="share-modal-card-stat">
              {Icons.palette}
              <span className="share-modal-card-stat-value">{manifest.resourcePacks.length}</span>
              packs
            </div>
          )}
        </div>
      </div>

    </div>
  )

  /* ── Render ── */
  return (
    <div className="share-modal-backdrop" onClick={onClose}>
      <div className="share-modal-box" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="share-modal-header">
          <div className="share-modal-header-left">
            {Icons.share}
            <div>
              <div className="share-modal-title">Share this setup</div>
              <div className="share-modal-subtitle">Create a card others can browse</div>
            </div>
          </div>
          <button className="share-modal-close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        {/* Loading State */}
        {state === 'loading' && (
          <div className="share-modal-loading">
            <div className="share-modal-spinner" />
            <div className="share-modal-loading-text">Generating manifest…</div>
          </div>
        )}

        {/* Editing State */}
        {(state === 'editing' || state === 'publishing' || state === 'published') && manifest && (
          <>
            <div className="share-modal-body">
              {/* Left: Preview */}
              <div className="share-modal-preview-col">
                {renderCardPreview()}
              </div>

              {/* Right: Controls */}
              <div className="share-modal-controls-col">
                <div className="share-modal-controls-scroll">
                  {/* Card Name */}
                  <div className="share-modal-section">
                    <div className="share-modal-section-title">Card Details</div>
                    <input
                      className="share-modal-input"
                      type="text"
                      placeholder="Card name…"
                      value={cardName}
                      onChange={e => setCardName(e.target.value)}
                      maxLength={64}
                      spellCheck={false}
                    />
                    <textarea
                      className="share-modal-textarea"
                      placeholder="Description (optional)…"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      maxLength={200}
                      rows={2}
                    />
                  </div>

                  {/* Sharing Toggles */}
                  <div className="share-modal-section">
                    <div className="share-modal-section-title">Include in Card</div>

                    {/* Mods toggle */}
                    <div className="share-modal-toggle-row">
                      <div className="share-modal-toggle-info">
                        <div className="share-modal-toggle-icon">{Icons.puzzle}</div>
                        <span className="share-modal-toggle-label">
                          Mods
                          <span className="share-modal-toggle-count"> · {manifest.mods.length}</span>
                        </span>
                      </div>
                      <button
                        className={`share-modal-toggle${includeMods ? ' on' : ''}`}
                        onClick={() => setIncludeMods(!includeMods)}
                      >
                        <div className="share-modal-toggle-knob" />
                      </button>
                    </div>

                    {/* Shader packs toggle */}
                    <div className="share-modal-toggle-row">
                      <div className="share-modal-toggle-info">
                        <div className="share-modal-toggle-icon">{Icons.shader}</div>
                        <span className="share-modal-toggle-label">
                          Shader Packs
                          <span className="share-modal-toggle-count"> · {manifest.shaderPacks.length}</span>
                        </span>
                      </div>
                      <button
                        className={`share-modal-toggle${includeShaders ? ' on' : ''}`}
                        onClick={() => setIncludeShaders(!includeShaders)}
                      >
                        <div className="share-modal-toggle-knob" />
                      </button>
                    </div>

                    {/* Resource packs toggle */}
                    <div className="share-modal-toggle-row">
                      <div className="share-modal-toggle-info">
                        <div className="share-modal-toggle-icon">{Icons.palette}</div>
                        <span className="share-modal-toggle-label">
                          Resource Packs
                          <span className="share-modal-toggle-count"> · {manifest.resourcePacks.length}</span>
                        </span>
                      </div>
                      <button
                        className={`share-modal-toggle${includeResourcePacks ? ' on' : ''}`}
                        onClick={() => setIncludeResourcePacks(!includeResourcePacks)}
                      >
                        <div className="share-modal-toggle-knob" />
                      </button>
                    </div>

                    {/* Version info toggle */}
                    <div className="share-modal-toggle-row">
                      <div className="share-modal-toggle-info">
                        <div className="share-modal-toggle-icon">{Icons.version}</div>
                        <span className="share-modal-toggle-label">Version Info</span>
                      </div>
                      <button
                        className={`share-modal-toggle${includeVersion ? ' on' : ''}`}
                        onClick={() => setIncludeVersion(!includeVersion)}
                      >
                        <div className="share-modal-toggle-knob" />
                      </button>
                    </div>
                  </div>

                  {/* Mod List (per-category) */}
                  {includeMods && modCategories.length > 0 && (
                    <div className="share-modal-section">
                      <div className="share-modal-section-title">Mod Selection</div>
                      {modCategories.map(cat => {
                        const isExpanded = expandedCategories.has(cat.key)
                        const includedCount = cat.mods.filter(m => !excludedMods.has(m.slug)).length
                        return (
                          <div key={cat.key} className="share-modal-mod-category">
                            <div className="share-modal-mod-category-header" onClick={() => toggleCategory(cat.key)}>
                              <svg
                                className={`share-modal-mod-category-chevron${isExpanded ? ' expanded' : ''}`}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                              <span className="share-modal-mod-category-name">{cat.label}</span>
                              <span className="share-modal-mod-category-count">
                                {includedCount}/{cat.mods.length}
                              </span>
                              <div className="share-modal-mod-category-actions" onClick={e => e.stopPropagation()}>
                                <button
                                  className="share-modal-mod-category-btn"
                                  onClick={() => selectAllInCategory(cat.mods)}
                                >
                                  All
                                </button>
                                <button
                                  className="share-modal-mod-category-btn"
                                  onClick={() => deselectAllInCategory(cat.mods)}
                                >
                                  None
                                </button>
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="share-modal-mod-list">
                              {cat.mods.map(mod => {
                                  const included = !excludedMods.has(mod.slug)
                                  return (
                                    <div
                                      key={mod.slug}
                                      className={`share-modal-mod-item${included ? '' : ' excluded'}`}
                                      onClick={() => toggleMod(mod.slug)}
                                    >
                                      <button className={`share-modal-checkbox${included ? ' checked' : ''}`}>
                                        {Icons.check}
                                      </button>
                                      <ModIcon iconUrl={mod.icon_url} projectId={mod.projectId} />
                                      <div className="share-modal-mod-info">
                                        <span className="share-modal-mod-name">{mod.name}</span>
                                        {mod.description && (
                                          <span className="share-modal-mod-desc">{mod.description}</span>
                                        )}
                                      </div>
                                      {mod.source && (
                                        <span className="share-modal-mod-source">{mod.source}</span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Shader pack names */}
                  {includeShaders && manifest.shaderPacks.length > 0 && (
                    <div className="share-modal-section">
                      <div className="share-modal-section-title">Shader Packs</div>
                      {manifest.shaderPacks.map(sp => (
                        <div key={sp.fileName} className="share-modal-toggle-row" style={{ padding: '6px 12px' }}>
                          <div className="share-modal-toggle-info">
                            <div className="share-modal-toggle-icon">{Icons.shader}</div>
                            <span className="share-modal-toggle-label">{sp.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Resource pack names */}
                  {includeResourcePacks && manifest.resourcePacks.length > 0 && (
                    <div className="share-modal-section">
                      <div className="share-modal-section-title">Resource Packs</div>
                      {manifest.resourcePacks.map(rp => (
                        <div key={rp.fileName} className="share-modal-toggle-row" style={{ padding: '6px 12px' }}>
                          <div className="share-modal-toggle-info">
                            <div className="share-modal-toggle-icon">{Icons.palette}</div>
                            <span className="share-modal-toggle-label">{rp.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="share-modal-footer">
              {state === 'published' && publishedUrl ? (
                <>
                  <button className="share-modal-btn-secondary" onClick={onClose}>
                    Done
                  </button>
                  <button
                    className="share-modal-url-inline"
                    onClick={copyUrl}
                    title="Click to copy"
                  >
                    {Icons.copy}
                    <span className="share-modal-url-inline-text">{publishedUrl}</span>
                  </button>
                </>
              ) : (
                <>
                  <button className="share-modal-btn-secondary" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    className="share-modal-btn-primary"
                    onClick={handlePublish}
                    disabled={state === 'publishing' || !cardName.trim()}
                  >
                    {state === 'publishing' ? 'Creating…' : 'Create Card'}
                  </button>
                </>
              )}
            </div>

            {/* Publishing overlay */}
            {state === 'publishing' && (
              <div className="share-modal-publishing">
                <div className="share-modal-spinner" />
                <div className="share-modal-publishing-text">Creating your card…</div>
              </div>
            )}
          </>
        )}

        {/* Toast */}
        <div className={`share-modal-toast${toastVisible ? ' visible' : ''}${toastIsError ? ' error' : ''}`}>
          {toastIsError ? Icons.warning : Icons.check}
          {toastMessage}
        </div>
      </div>
    </div>
  )
}
