import { useState, useEffect, useCallback } from 'react'
import './ModsPage.css'

interface ModrinthResult {
  slug: string
  title: string
  description: string
  downloads: number
  icon_url: string | null
  project_id: string
}

interface InstalledMod {
  id: string
  name: string
  description: string
  version: string
  icon_url?: string
  slug?: string
  fileName?: string
  isDependency?: boolean
}

interface ProjectDetail {
  slug: string
  title: string
  description: string
  body: string
  icon_url: string | null
  downloads: number
  followers: number
  categories: string[]
  game_versions: string[]
  loaders: string[]
  license?: { id: string; name: string }
  source_url?: string
  wiki_url?: string
  donation_urls?: { url: string }[]
  project_type: string
}

const api = (window as any).electronAPI

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function ModsPage() {
  const [instances, setInstances] = useState<any[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'installed' | 'discover' | 'resourcepacks'>('installed')
  const [search, setSearch] = useState('')
  const [discoverResults, setDiscoverResults] = useState<ModrinthResult[]>([])
  const [loading, setLoading] = useState(false)
  const [installed, setInstalled] = useState<InstalledMod[]>([])
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [installError, setInstallError] = useState('')
  const [installedRPs, setInstalledRPs] = useState<Set<string>>(new Set())
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [modsDragOver, setModsDragOver] = useState(false)
  const [modsDropStatus, setModsDropStatus] = useState<string | null>(null)

  // In-app detail view
  const [detailProject, setDetailProject] = useState<ProjectDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [versionStatus, setVersionStatus] = useState<Record<string, { available: boolean; version?: string }>>({})

  const selectedInstance = instances.find((i: any) => i.id === selectedInstanceId)
  const gameVersion = selectedInstance?.version || '1.21.5'
  const loader = selectedInstance?.loader || 'Fabric'

  useEffect(() => {
    api?.getInstances().then((data: any[]) => {
      if (data && data.length > 0) {
        setInstances(data)
        setSelectedInstanceId(data[0].id)
      }
    })
  }, [])

  useEffect(() => {
    if (!selectedInstanceId) return
    api?.getInstalledMods(selectedInstanceId).then((mods: InstalledMod[]) => {
      setInstalled(mods || [])
    })
  }, [selectedInstanceId])

  const searchAPI = useCallback(async (query: string) => {
    setLoading(true)
    try {
      const fn = activeTab === 'resourcepacks' ? api?.searchResourcePacks : api?.searchMods
      const result = await fn?.(query, 0)
      if (result?.hits) {
        setDiscoverResults(result.hits)

        // Resource packs are version-agnostic — skip compatibility checks
        if (activeTab === 'resourcepacks') {
          const rpChecks: Record<string, { available: boolean }> = {}
          for (const mod of result.hits) {
            rpChecks[mod.slug] = { available: true }
          }
          setVersionStatus(prev => ({ ...prev, ...rpChecks }))
        } else {
          // Check version compatibility for mods
          const checks: Record<string, { available: boolean; version?: string }> = {}
          const batch = result.hits.slice(0, 20)
          await Promise.all(batch.map(async (mod: ModrinthResult) => {
            try {
              const r = await api?.checkModVersion(mod.slug, gameVersion, loader)
              checks[mod.slug] = r?.available
                ? { available: true, version: r.versionNumber }
                : { available: false }
            } catch {
              checks[mod.slug] = { available: false }
            }
          }))
          setVersionStatus(prev => ({ ...prev, ...checks }))
        }
      }
    } catch {
      setDiscoverResults([])
    }
    setLoading(false)
  }, [activeTab, gameVersion, loader])

  useEffect(() => {
    if (activeTab === 'discover' || activeTab === 'resourcepacks') {
      setVersionStatus({})
      setDiscoverResults([])
      searchAPI(search)
    }
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'installed') return
    if (searchTimeout) clearTimeout(searchTimeout)
    const timeout = setTimeout(() => searchAPI(search), 400)
    setSearchTimeout(timeout)
    return () => clearTimeout(timeout)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredInstalled = installed.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.description.toLowerCase().includes(search.toLowerCase())
  )

  const isInstalled = (slug: string) => installed.some((m) => m.id === slug) || installedRPs.has(slug)

  const handleInstall = async (mod: ModrinthResult) => {
    console.log('[ModsPage] handleInstall called', { slug: mod.slug, activeTab, selectedInstanceId })
    if (!selectedInstanceId) {
      console.warn('[ModsPage] No instance selected, aborting install')
      return
    }
    if (isInstalled(mod.slug)) {
      console.warn('[ModsPage] Already installed:', mod.slug)
      return
    }
    setInstalling((prev) => new Set(prev).add(mod.slug))
    setInstallError('')

    const modData = {
      id: mod.slug,
      name: mod.title,
      description: mod.description,
      icon_url: mod.icon_url,
      slug: mod.slug,
    }

    try {
      let result: any
      if (activeTab === 'resourcepacks') {
        console.log('[ModsPage] Installing resource pack:', mod.slug, 'for instance:', selectedInstanceId)
        result = await api?.installResourcePack(selectedInstanceId, modData, gameVersion)
        console.log('[ModsPage] Resource pack install result:', result)
        if (result?.success) {
          setInstalledRPs((prev) => new Set(prev).add(mod.slug))
        } else if (result?.error) {
          setInstallError(`Failed to install ${mod.title}: ${result.error}`)
        }
      } else {
        result = await api?.installMod(selectedInstanceId, modData, gameVersion, loader)
        if (result?.error) {
          setInstallError(`Failed to install ${mod.title}: ${result.error}`)
        } else if (result?.mods) {
          setInstalled(result.mods)
        }
      }
    } catch (err: any) {
      console.error('[ModsPage] Install error:', err)
      setInstallError(`Failed to install ${mod.title}: ${err.message || 'Unknown error'}`)
    }

    setInstalling((prev) => {
      const next = new Set(prev)
      next.delete(mod.slug)
      return next
    })
  }

  const handleRemove = async (id: string) => {
    if (!selectedInstanceId) return
    const mods = await api?.uninstallMod(selectedInstanceId, id)
    if (mods) setInstalled(mods)
  }

  // ── Drag-and-drop handlers for mods ──
  const handleModsDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setModsDragOver(true)
  }, [])

  const handleModsDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { clientX, clientY } = e
    if (clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom) {
      setModsDragOver(false)
    }
  }, [])

  const handleModsDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setModsDragOver(false)

    if (!selectedInstanceId) return

    const droppedFiles = e.dataTransfer.files
    if (!droppedFiles || droppedFiles.length === 0) return

    const filePaths: string[] = []
    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i]
      const filePath = (file as any).path as string
      if (!filePath) continue
      if (!filePath.toLowerCase().endsWith('.jar')) continue
      filePaths.push(filePath)
    }

    if (filePaths.length === 0) {
      setModsDropStatus('Only .jar files are accepted')
      setTimeout(() => setModsDropStatus(null), 3000)
      return
    }

    try {
      const result = await api?.copyFilesToInstance(selectedInstanceId, 'mods', filePaths)
      if (result?.copied > 0) {
        setModsDropStatus(`Added ${result.copied} mod${result.copied !== 1 ? 's' : ''}`)
        // Refresh installed mods list
        const mods = await api?.getInstalledMods(selectedInstanceId)
        if (mods) setInstalled(mods)
      }
      if (result?.errors?.length > 0) {
        setModsDropStatus(`${result.errors.length} file${result.errors.length !== 1 ? 's' : ''} failed`)
      }
    } catch (err: any) {
      setModsDropStatus(`Error: ${err.message}`)
    }

    setTimeout(() => setModsDropStatus(null), 3000)
  }, [selectedInstanceId])

  const openDetail = async (slug: string) => {
    setDetailLoading(true)
    const project = await api?.getProject(slug)
    setDetailProject(project)
    setDetailLoading(false)
  }

  const closeDetail = () => setDetailProject(null)

  // --- Detail View ---
  if (detailProject) {
    return (
      <div className="mods page-enter">
        <button className="mods-back" onClick={closeDetail}>Back</button>
        <div className="mods-detail">
          <div className="mods-detail-header">
            {detailProject.icon_url && (
              <img className="mods-detail-icon" src={detailProject.icon_url} alt="" />
            )}
            <div className="mods-detail-meta">
              <h2 className="mods-detail-title">{detailProject.title}</h2>
              <p className="mods-detail-desc">{detailProject.description}</p>
              <div className="mods-detail-tags">
                {detailProject.categories?.map(c => (
                  <span key={c} className="mods-detail-tag">{c}</span>
                ))}
              </div>
              <div className="mods-detail-stats">
                <span>{formatDownloads(detailProject.downloads)} downloads</span>
                <span>{formatDownloads(detailProject.followers)} followers</span>
                {detailProject.license && <span>{detailProject.license.name}</span>}
              </div>
            </div>
          </div>
          <div className="mods-detail-actions">
            {isInstalled(detailProject.slug) ? (
              <button className="mods-detail-remove" onClick={() => handleRemove(detailProject.slug)}>
                Remove
              </button>
            ) : !detailProject.game_versions?.includes(gameVersion) ? (
              <button className="mods-detail-unavailable" disabled>
                Unavailable for {gameVersion}
              </button>
            ) : (
              <button
                className="mods-detail-install"
                onClick={() => handleInstall({
                  slug: detailProject.slug,
                  title: detailProject.title,
                  description: detailProject.description,
                  downloads: detailProject.downloads,
                  icon_url: detailProject.icon_url,
                  project_id: detailProject.slug,
                })}
                disabled={installing.has(detailProject.slug)}
              >
                {installing.has(detailProject.slug) ? 'Installing...' : `Install for ${gameVersion}`}
              </button>
            )}
          </div>
          <div className="mods-detail-info">
            <h3>Supported Versions</h3>
            <div className="mods-detail-versions">
              {detailProject.game_versions?.slice(-15).reverse().map(v => (
                <span
                  key={v}
                  className={`mods-detail-version${v === gameVersion ? ' current' : ''}`}
                >
                  {v}
                </span>
              ))}
            </div>
            {detailProject.loaders?.length > 0 && (
              <>
                <h3>Loaders</h3>
                <div className="mods-detail-versions">
                  {detailProject.loaders.map(l => (
                    <span key={l} className="mods-detail-version">{l}</span>
                  ))}
                </div>
              </>
            )}
            {detailProject.source_url && (
              <p className="mods-detail-link">
                <a onClick={() => api?.openExternal(detailProject.source_url!)}>View Source Code</a>
              </p>
            )}
          </div>
          <div className="mods-detail-body" dangerouslySetInnerHTML={{
            __html: detailProject.body
              ?.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:8px 0">')
              ?.replace(/\n/g, '<br>') || ''
          }} />
        </div>
      </div>
    )
  }

  // --- List View ---
  return (
    <div className="mods page-enter">
      <div className="mods-header">
        <h1 className="mods-title">Browse</h1>
        {instances.length > 0 && (
          <select
            className="mods-instance-select"
            value={selectedInstanceId || ''}
            onChange={(e) => setSelectedInstanceId(e.target.value)}
          >
            {instances.map((inst: any) => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.version} / {inst.loader})
              </option>
            ))}
          </select>
        )}
      </div>

      {!selectedInstance && (
        <div className="mods-empty">Create an instance first to manage mods and resource packs.</div>
      )}

      {selectedInstance && (
        <>
          <input
            className="mods-search"
            type="text"
            placeholder={
              activeTab === 'installed' ? 'Search installed...' :
              activeTab === 'resourcepacks' ? 'Search resource packs...' :
              'Search mods...'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="mods-tabs">
            <button
              className={`mods-tab${activeTab === 'installed' ? ' active' : ''}`}
              onClick={() => setActiveTab('installed')}
            >
              Installed ({installed.length})
            </button>
            <button
              className={`mods-tab${activeTab === 'discover' ? ' active' : ''}`}
              onClick={() => setActiveTab('discover')}
            >
              Discover Mods
            </button>
            <button
              className={`mods-tab${activeTab === 'resourcepacks' ? ' active' : ''}`}
              onClick={() => setActiveTab('resourcepacks')}
            >
              Resource Packs
            </button>
          </div>

          {installError && (
            <div className="mods-install-error" onClick={() => setInstallError('')}>
              {installError}
            </div>
          )}

          {modsDropStatus && (
            <div className="mods-drop-status">{modsDropStatus}</div>
          )}

          <div
            className={`mods-list${activeTab === 'installed' && modsDragOver ? ' mods-drag-over' : ''}`}
            onDragOver={activeTab === 'installed' ? handleModsDragOver : undefined}
            onDragLeave={activeTab === 'installed' ? handleModsDragLeave : undefined}
            onDrop={activeTab === 'installed' ? handleModsDrop : undefined}
          >
            {activeTab === 'installed' && modsDragOver && (
              <div className="mods-drop-overlay">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Drop .jar files to add mods</span>
              </div>
            )}
            {activeTab === 'installed' ? (
              filteredInstalled.length > 0 ? (
                filteredInstalled.map((mod) => (
                  <div className="mods-item" key={mod.id}>
                    {mod.icon_url && (
                      <img className="mods-item-icon" src={mod.icon_url} alt="" />
                    )}
                    <div
                      className="mods-item-info mods-item-clickable"
                      onClick={() => mod.slug && openDetail(mod.slug)}
                    >
                      <span className="mods-item-name">
                        {mod.name}
                        {mod.isDependency && <span className="mods-item-dep-badge">dep</span>}
                      </span>
                      <span className="mods-item-desc">{mod.description}</span>
                    </div>
                    <div className="mods-item-actions">
                      <span className="mods-item-version">{mod.version}</span>
                      <button className="mods-item-remove" onClick={() => handleRemove(mod.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="mods-empty">
                  {search ? 'No mods match your search' : 'No mods installed. Drag .jar files here or head to Discover.'}
                </div>
              )
            ) : loading ? (
              <div className="mods-empty">Searching Modrinth...</div>
            ) : discoverResults.length ? (
              discoverResults.map((mod) => {
                const vs = versionStatus[mod.slug]
                const unavailable = vs && !vs.available

                return (
                  <div className={`mods-item${unavailable ? ' mods-item-unavailable' : ''}`} key={mod.slug}>
                    {mod.icon_url && (
                      <img className="mods-item-icon" src={mod.icon_url} alt="" />
                    )}
                    <div
                      className="mods-item-info mods-item-clickable"
                      onClick={() => openDetail(mod.slug)}
                    >
                      <span className="mods-item-name">{mod.title}</span>
                      <span className="mods-item-desc">{mod.description}</span>
                    </div>
                    <div className="mods-item-actions">
                      <span className="mods-item-downloads">{formatDownloads(mod.downloads)}</span>
                      {isInstalled(mod.slug) ? (
                        <span className="mods-item-installed-badge">Installed</span>
                      ) : unavailable ? (
                        <span className="mods-item-unavailable-badge">Unavailable</span>
                      ) : (
                        <button
                          className="mods-item-install"
                          onClick={(e) => { e.stopPropagation(); handleInstall(mod) }}
                          disabled={installing.has(mod.slug)}
                        >
                          {installing.has(mod.slug) ? 'Installing...' : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="mods-empty">No results found</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
