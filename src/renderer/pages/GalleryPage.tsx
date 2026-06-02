import { useState, useEffect, useCallback, useRef } from 'react'
import './GalleryPage.css'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface GalleryItem {
  id: string
  filename: string
  path: string
  type: 'recording' | 'screenshot' | 'replay'
  duration: number | null
  size: number
  createdAt: number
  thumbnailPath: string | null
}

type FilterTab = 'all' | 'recordings' | 'screenshots' | 'replays'
type SortOrder = 'newest' | 'oldest'

interface ContextMenuState {
  x: number
  y: number
  item: GalleryItem
}

interface TextOverlay {
  text: string
  position: 'top' | 'center' | 'bottom'
}

const api = (window as any).electronAPI

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ─── Context Menu ──────────────────────────────────────────────────────────────

interface ContextMenuProps {
  menu: ContextMenuState
  onClose: () => void
  onShareDiscord: (item: GalleryItem) => void
  onUploadYouTube: (item: GalleryItem) => void
  onDelete: (item: GalleryItem) => void
  onOpenExplorer: (item: GalleryItem) => void
}

function ContextMenu({ menu, onClose, onShareDiscord, onUploadYouTube, onDelete, onOpenExplorer }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="gallery-ctx-menu"
      style={{ top: menu.y, left: menu.x }}
    >
      <button className="gallery-ctx-item" onClick={() => { onShareDiscord(menu.item); onClose() }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515M3.677 4.37a19.736 19.736 0 014.885-1.515M8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419s.956-2.419 2.157-2.419M15.995 15.33c-1.183 0-2.157-1.085-2.157-2.419s.956-2.419 2.157-2.419" />
        </svg>
        Share to Discord
      </button>
      {menu.item.type !== 'screenshot' && (
        <button className="gallery-ctx-item" onClick={() => { onUploadYouTube(menu.item); onClose() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29 29 0 001 12a29 29 0 00.46 5.58 2.78 2.78 0 001.94 2c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 001.94-2A29 29 0 0023 12a29 29 0 00-.46-5.58z" />
            <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" />
          </svg>
          Upload to YouTube
        </button>
      )}
      <button className="gallery-ctx-item" onClick={() => { onOpenExplorer(menu.item); onClose() }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        Open in Explorer
      </button>
      <div className="gallery-ctx-divider" />
      <button className="gallery-ctx-item danger" onClick={() => { onDelete(menu.item); onClose() }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
        Delete
      </button>
    </div>
  )
}

// ─── Video Player Modal ────────────────────────────────────────────────────────

interface PlayerModalProps {
  item: GalleryItem
  onClose: () => void
}

function PlayerModal({ item, onClose }: PlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [canPlay, setCanPlay] = useState<boolean | null>(null)

  // Use custom media:// protocol that bypasses CSP
  const mediaUrl = `media://${item.path.replace(/\\/g, '/')}`

  const openExternal = () => {
    if (api?.shellOpenPath) api.shellOpenPath(item.path)
    else if (api?.openExternal) api.openExternal(`file://${item.path.replace(/\\/g, '/')}`)
  }

  return (
    <div className="gallery-player-overlay" onClick={onClose}>
      <div className="gallery-player-box" onClick={(e) => e.stopPropagation()}>
        <button className="gallery-player-close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="gallery-player-title">{item.filename}</div>
        {item.type === 'screenshot' ? (
          <img
            className="gallery-player-image"
            src={`file://${item.path.replace(/\\/g, '/')}`}
            alt={item.filename}
          />
        ) : (
          <>
            {canPlay !== false && (
              <video
                ref={videoRef}
                className="gallery-player-video"
                src={mediaUrl}
                controls
                autoPlay
                onCanPlay={() => setCanPlay(true)}
                onError={() => setCanPlay(false)}
                style={canPlay === null ? { minHeight: 200 } : undefined}
              />
            )}
            {canPlay === false && (
              <div className="gallery-player-fallback">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" style={{ marginBottom: 16 }}>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <p style={{ color: '#888', marginBottom: 16, fontSize: 13 }}>
                  This codec isn't supported in-app
                </p>
                <button className="gallery-open-external-btn" onClick={openExternal}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Open in Media Player
                </button>
              </div>
            )}
          </>
        )}
        <div className="gallery-player-meta">
          <span>{formatDate(item.createdAt)}</span>
          <span>{formatSize(item.size)}</span>
          {item.duration !== null && <span>{formatDuration(item.duration)}</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Editor Panel ──────────────────────────────────────────────────────────────

interface EditorPanelProps {
  item: GalleryItem
  onClose: () => void
  onRefresh: () => void
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4]

function EditorPanel({ item, onClose, onRefresh }: EditorPanelProps) {
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(item.duration || 10)
  const [speed, setSpeed] = useState(1)
  const [textOverlay, setTextOverlay] = useState<TextOverlay>({ text: '', position: 'bottom' })
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState('')

  const handleTrim = async () => {
    setExporting(true)
    setExportStatus('Trimming...')
    try {
      const output = item.path.replace(/(\.[^.]+)$/, '_trimmed$1')
      await api?.editorTrim(item.path, output, trimStart, trimEnd)
      setExportStatus('Trim complete!')
      onRefresh()
    } catch (err: any) {
      setExportStatus(`Error: ${err.message || 'Trim failed'}`)
    }
    setExporting(false)
  }

  const handleSpeed = async () => {
    setExporting(true)
    setExportStatus('Changing speed...')
    try {
      const output = item.path.replace(/(\.[^.]+)$/, `_${speed}x$1`)
      await api?.editorChangeSpeed(item.path, output, speed)
      setExportStatus('Speed change complete!')
      onRefresh()
    } catch (err: any) {
      setExportStatus(`Error: ${err.message || 'Speed change failed'}`)
    }
    setExporting(false)
  }

  const handleTextOverlay = async () => {
    if (!textOverlay.text.trim()) return
    setExporting(true)
    setExportStatus('Adding text overlay...')
    try {
      const output = item.path.replace(/(\.[^.]+)$/, '_text$1')
      const posY = textOverlay.position === 'top' ? 50 : textOverlay.position === 'center' ? 0 : -50
      await api?.editorTextOverlay(item.path, output, textOverlay.text, {
        x: 0, y: posY, fontSize: 48, color: '#ffffff'
      })
      setExportStatus('Text overlay complete!')
      onRefresh()
    } catch (err: any) {
      setExportStatus(`Error: ${err.message || 'Text overlay failed'}`)
    }
    setExporting(false)
  }

  return (
    <div className="gallery-editor-backdrop" onClick={onClose}>
      <div className="gallery-editor" onClick={(e) => e.stopPropagation()}>
        <div className="gallery-editor-header">
          <h3 className="gallery-editor-title">Edit</h3>
          <span className="gallery-editor-filename">{item.filename}</span>
          <button className="gallery-editor-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Trim */}
        <div className="gallery-editor-section">
          <div className="gallery-editor-label">Trim</div>
          <div className="gallery-editor-trim">
            <div className="gallery-editor-trim-row">
              <span className="gallery-editor-trim-label">Start</span>
              <input
                type="range"
                min={0}
                max={item.duration || 10}
                step={0.1}
                value={trimStart}
                onChange={(e) => setTrimStart(parseFloat(e.target.value))}
                className="gallery-editor-slider"
              />
              <span className="gallery-editor-trim-val">{formatDuration(trimStart)}</span>
            </div>
            <div className="gallery-editor-trim-row">
              <span className="gallery-editor-trim-label">End</span>
              <input
                type="range"
                min={0}
                max={item.duration || 10}
                step={0.1}
                value={trimEnd}
                onChange={(e) => setTrimEnd(parseFloat(e.target.value))}
                className="gallery-editor-slider"
              />
              <span className="gallery-editor-trim-val">{formatDuration(trimEnd)}</span>
            </div>
            <button className="gallery-editor-btn" onClick={handleTrim} disabled={exporting}>
              Export Trim
            </button>
          </div>
        </div>

        {/* Speed */}
        <div className="gallery-editor-section">
          <div className="gallery-editor-label">Speed</div>
          <div className="gallery-editor-speed">
            <div className="gallery-editor-speed-chips">
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  className={`gallery-editor-speed-chip${speed === s ? ' active' : ''}`}
                  onClick={() => setSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
            <button className="gallery-editor-btn" onClick={handleSpeed} disabled={exporting}>
              Export at {speed}x
            </button>
          </div>
        </div>

        {/* Text Overlay */}
        <div className="gallery-editor-section">
          <div className="gallery-editor-label">Text Overlay</div>
          <div className="gallery-editor-text">
            <input
              type="text"
              className="gallery-editor-input"
              placeholder="Enter text..."
              value={textOverlay.text}
              onChange={(e) => setTextOverlay({ ...textOverlay, text: e.target.value })}
            />
            <div className="gallery-editor-pos-chips">
              {(['top', 'center', 'bottom'] as const).map((pos) => (
                <button
                  key={pos}
                  className={`gallery-editor-pos-chip${textOverlay.position === pos ? ' active' : ''}`}
                  onClick={() => setTextOverlay({ ...textOverlay, position: pos })}
                >
                  {pos.charAt(0).toUpperCase() + pos.slice(1)}
                </button>
              ))}
            </div>
            <button
              className="gallery-editor-btn"
              onClick={handleTextOverlay}
              disabled={exporting || !textOverlay.text.trim()}
            >
              Add Text
            </button>
          </div>
        </div>

        {exportStatus && (
          <div className={`gallery-editor-status${exportStatus.startsWith('Error') ? ' error' : ''}`}>
            {exportStatus}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Delete Confirm Modal ──────────────────────────────────────────────────────

interface DeleteConfirmProps {
  item: GalleryItem
  onCancel: () => void
  onConfirm: () => void
}

function DeleteConfirmModal({ item, onCancel, onConfirm }: DeleteConfirmProps) {
  return (
    <div className="gallery-delete-overlay" onClick={onCancel}>
      <div className="gallery-delete-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="gallery-delete-title">Delete {item.filename}?</h3>
        <p className="gallery-delete-desc">
          This file will be permanently removed from your computer.
        </p>
        <div className="gallery-delete-actions">
          <button className="gallery-delete-cancel" onClick={onCancel}>Cancel</button>
          <button className="gallery-delete-confirm" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Gallery Page ─────────────────────────────────────────────────────────

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [sort, setSort] = useState<SortOrder>('newest')
  const [playerItem, setPlayerItem] = useState<GalleryItem | null>(null)
  const [editorItem, setEditorItem] = useState<GalleryItem | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GalleryItem | null>(null)
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set())
  const [mergeMode, setMergeMode] = useState(false)
  const [merging, setMerging] = useState(false)

  // ── Load items ──

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api?.galleryGetItems()
      if (data) setItems(data)
    } catch {
      setItems([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  // ── Filter & sort ──

  const filtered = items
    .filter((item) => {
      if (filter === 'all') return true
      if (filter === 'recordings') return item.type === 'recording'
      if (filter === 'screenshots') return item.type === 'screenshot'
      if (filter === 'replays') return item.type === 'replay'
      return true
    })
    .sort((a, b) => {
      return sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
    })

  // ── Actions ──

  const handleContextMenu = useCallback((e: React.MouseEvent, item: GalleryItem) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const handleShareDiscord = useCallback(async (item: GalleryItem) => {
    try {
      await api?.socialShareToDiscord('', {
        filePath: item.path,
        title: item.filename,
        description: `Recorded with Loom • ${formatDate(item.createdAt)}`
      })
    } catch { /* user can configure webhook */ }
  }, [])

  const handleUploadYouTube = useCallback(async (item: GalleryItem) => {
    try {
      await api?.socialUploadToYouTube('', {
        filePath: item.path,
        title: item.filename,
        description: `Recorded with Loom Minecraft Launcher`,
        privacy: 'unlisted'
      })
    } catch { /* user needs to set up token */ }
  }, [])

  const handleDelete = useCallback(async (item: GalleryItem) => {
    setDeleteTarget(item)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      // Use shell to move to trash via the main process
      await api?.deleteFile?.(deleteTarget.path)
    } catch { /* ignore */ }
    setDeleteTarget(null)
    loadItems()
  }, [deleteTarget, loadItems])

  const handleOpenExplorer = useCallback(async (item: GalleryItem) => {
    try {
      await api?.showItemInFolder?.(item.path)
    } catch { /* ignore */ }
  }, [])

  const handleItemClick = useCallback((item: GalleryItem) => {
    if (mergeMode) {
      setSelectedForMerge((prev) => {
        const next = new Set(prev)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      return
    }
    setPlayerItem(item)
  }, [mergeMode])

  const handleMerge = useCallback(async () => {
    if (selectedForMerge.size < 2) return
    setMerging(true)
    try {
      const inputs = items
        .filter((i) => selectedForMerge.has(i.id))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((i) => i.path)
      const output = inputs[0].replace(/(\.[^.]+)$/, '_merged$1')
      await api?.editorConcatenate(inputs, output)
    } catch { /* ignore */ }
    setMerging(false)
    setMergeMode(false)
    setSelectedForMerge(new Set())
    loadItems()
  }, [selectedForMerge, items, loadItems])

  // ── Counts ──

  const counts = {
    all: items.length,
    recordings: items.filter((i) => i.type === 'recording').length,
    screenshots: items.filter((i) => i.type === 'screenshot').length,
    replays: items.filter((i) => i.type === 'replay').length,
  }

  // ── Render ──

  return (
    <div className="gallery page-enter">
      <div className="gallery-header">
        <h1 className="gallery-title">Content</h1>
        <div className="gallery-header-actions">
          <button
            className={`gallery-merge-toggle${mergeMode ? ' active' : ''}`}
            onClick={() => {
              setMergeMode(!mergeMode)
              setSelectedForMerge(new Set())
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
            {mergeMode ? 'Cancel' : 'Merge'}
          </button>
          <select
            className="gallery-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOrder)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="gallery-tabs">
        {(['all', 'recordings', 'screenshots', 'replays'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            className={`gallery-tab${filter === tab ? ' active' : ''}`}
            onClick={() => setFilter(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            <span className="gallery-tab-count">{counts[tab]}</span>
          </button>
        ))}
      </div>

      {/* Merge Bar */}
      {mergeMode && (
        <div className="gallery-merge-bar">
          <span className="gallery-merge-info">
            {selectedForMerge.size} item{selectedForMerge.size !== 1 ? 's' : ''} selected
          </span>
          <button
            className="gallery-merge-btn"
            disabled={selectedForMerge.size < 2 || merging}
            onClick={handleMerge}
          >
            {merging ? 'Merging...' : 'Merge Selected'}
          </button>
        </div>
      )}

      {/* Grid / Empty State */}
      {loading ? (
        <div className="gallery-empty">
          <div className="gallery-empty-spinner" />
          <span>Loading gallery...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="gallery-empty">
          <svg className="gallery-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span className="gallery-empty-text">No recordings yet.</span>
          <span className="gallery-empty-sub">Use the Dynamic Island to start recording.</span>
        </div>
      ) : (
        <div className="gallery-grid">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`gallery-card${mergeMode && selectedForMerge.has(item.id) ? ' selected' : ''}`}
              onClick={() => handleItemClick(item)}
              onContextMenu={(e) => handleContextMenu(e, item)}
            >
              {/* Thumbnail */}
              <div className="gallery-card-thumb">
                {item.thumbnailPath ? (
                  <img
                    src={`file://${item.thumbnailPath.replace(/\\/g, '/')}`}
                    alt={item.filename}
                    className="gallery-card-img"
                  />
                ) : (
                  <div className="gallery-card-placeholder">
                    {item.type === 'screenshot' ? (
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    ) : (
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    )}
                  </div>
                )}

                {/* Duration badge */}
                {item.duration !== null && (
                  <span className="gallery-card-duration">{formatDuration(item.duration)}</span>
                )}

                {/* Type badge */}
                <span className={`gallery-card-type gallery-card-type-${item.type}`}>
                  {item.type}
                </span>

                {/* Merge checkbox */}
                {mergeMode && (
                  <div className={`gallery-card-check${selectedForMerge.has(item.id) ? ' checked' : ''}`}>
                    {selectedForMerge.has(item.id) && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="gallery-card-info">
                <span className="gallery-card-name" title={item.filename}>{item.filename}</span>
                <div className="gallery-card-meta">
                  <span>{formatDate(item.createdAt)}</span>
                  <span className="gallery-card-dot">·</span>
                  <span>{formatSize(item.size)}</span>
                </div>
              </div>

              {/* Edit button */}
              {!mergeMode && item.type !== 'screenshot' && (
                <button
                  className="gallery-card-edit"
                  title="Edit"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditorItem(item)
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onShareDiscord={handleShareDiscord}
          onUploadYouTube={handleUploadYouTube}
          onDelete={handleDelete}
          onOpenExplorer={handleOpenExplorer}
        />
      )}

      {/* Video Player Modal */}
      {playerItem && (
        <PlayerModal
          item={playerItem}
          onClose={() => setPlayerItem(null)}
        />
      )}

      {/* Editor Panel */}
      {editorItem && (
        <EditorPanel
          item={editorItem}
          onClose={() => setEditorItem(null)}
          onRefresh={loadItems}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <DeleteConfirmModal
          item={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}
