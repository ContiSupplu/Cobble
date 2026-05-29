import { useState, useEffect, useCallback } from 'react'
import './FileExplorer.css'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified: number
  extension: string
}

interface FileExplorerProps {
  instanceId: string
  instanceName: string
  onClose: () => void
}

const FILE_ICONS: Record<string, string> = {
  '.jar': '📦',
  '.json': '📋',
  '.toml': '⚙️',
  '.cfg': '⚙️',
  '.properties': '⚙️',
  '.txt': '📝',
  '.log': '📝',
  '.png': '🖼️',
  '.jpg': '🖼️',
  '.jpeg': '🖼️',
  '.gif': '🖼️',
  '.nbt': '💾',
  '.dat': '💾',
  '.dat_old': '💾',
  '.yml': '📋',
  '.yaml': '📋',
  '.xml': '📋',
  '.zip': '📁',
  '.gz': '📁',
  '.class': '☕',
  '.java': '☕',
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
  if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function FileExplorer({ instanceId, instanceName, onClose }: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dropStatus, setDropStatus] = useState<string | null>(null)

  const api = (window as any).electronAPI

  const loadDir = useCallback(async (path: string) => {
    setLoading(true)
    setSelected(new Set())
    setRenaming(null)
    setConfirmDelete(null)
    try {
      const entries = await api?.listInstanceDir(instanceId, path)
      setFiles(entries || [])
    } catch {
      setFiles([])
    }
    setLoading(false)
  }, [instanceId])

  useEffect(() => { loadDir(currentPath) }, [currentPath, loadDir])

  const navigate = (path: string) => setCurrentPath(path)

  const goUp = () => {
    if (!currentPath) return
    const parts = currentPath.split('/')
    parts.pop()
    setCurrentPath(parts.join('/'))
  }

  const handleDoubleClick = (entry: FileEntry) => {
    if (entry.isDirectory) {
      navigate(entry.path)
    } else {
      api?.openInstanceFile(instanceId, entry.path)
    }
  }

  const handleDelete = async (path: string) => {
    await api?.deleteInstanceFile(instanceId, path)
    setConfirmDelete(null)
    await loadDir(currentPath)
  }

  const handleRename = async (oldPath: string) => {
    if (!renameValue.trim()) { setRenaming(null); return }
    await api?.renameInstanceFile(instanceId, oldPath, renameValue.trim())
    setRenaming(null)
    await loadDir(currentPath)
  }

  const toggleSelect = (path: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected(prev => {
        const next = new Set(prev)
        next.has(path) ? next.delete(path) : next.add(path)
        return next
      })
    } else {
      setSelected(new Set([path]))
    }
  }

  // ── Drag-and-drop handlers ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { clientX, clientY } = e
    if (clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const droppedFiles = e.dataTransfer.files
    if (!droppedFiles || droppedFiles.length === 0) return

    const filePaths: string[] = []
    const isModsDir = currentPath === 'mods' || currentPath.startsWith('mods/')

    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i]
      // Electron exposes .path on File objects in the renderer
      const filePath = (file as any).path as string
      if (!filePath) continue

      // If in the mods folder, only accept .jar files
      if (isModsDir && !filePath.toLowerCase().endsWith('.jar')) {
        continue
      }
      filePaths.push(filePath)
    }

    if (filePaths.length === 0) {
      if (isModsDir) {
        setDropStatus('Only .jar files can be dropped into the mods folder')
      } else {
        setDropStatus('No valid files to drop')
      }
      setTimeout(() => setDropStatus(null), 3000)
      return
    }

    const dest = currentPath || ''

    try {
      const result = await api?.copyFilesToInstance(instanceId, dest, filePaths)
      if (result?.copied > 0) {
        setDropStatus(`Copied ${result.copied} file${result.copied !== 1 ? 's' : ''}`)
        await loadDir(currentPath)
      }
      if (result?.errors?.length > 0) {
        setDropStatus(`${result.errors.length} file${result.errors.length !== 1 ? 's' : ''} failed to copy`)
      }
    } catch (err: any) {
      setDropStatus(`Error: ${err.message}`)
    }

    setTimeout(() => setDropStatus(null), 3000)
  }, [instanceId, currentPath, loadDir])

  // Breadcrumb path segments
  const pathSegments = currentPath ? currentPath.split('/') : []

  const getIcon = (entry: FileEntry): string => {
    if (entry.isDirectory) return '📁'
    return FILE_ICONS[entry.extension] || '📄'
  }

  const isModsDir = currentPath === 'mods' || currentPath.startsWith('mods/')
  const dropHint = isModsDir ? 'Drop .jar files to add mods' : 'Drop files to copy here'

  return (
    <div className="fe-overlay" onClick={onClose}>
      <div className="fe-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="fe-header">
          <div className="fe-header-left">
            <button
              className="fe-nav-btn"
              onClick={goUp}
              disabled={!currentPath}
              title="Go up"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="fe-breadcrumb">
              <button
                className={`fe-breadcrumb-seg${!currentPath ? ' active' : ''}`}
                onClick={() => navigate('')}
              >
                {instanceName}
              </button>
              {pathSegments.map((seg, i) => {
                const segPath = pathSegments.slice(0, i + 1).join('/')
                const isLast = i === pathSegments.length - 1
                return (
                  <span key={segPath}>
                    <span className="fe-breadcrumb-sep">/</span>
                    <button
                      className={`fe-breadcrumb-seg${isLast ? ' active' : ''}`}
                      onClick={() => navigate(segPath)}
                    >
                      {seg}
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
          <button className="fe-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* File list — drop zone */}
        <div
          className={`fe-body${dragOver ? ' fe-drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className="fe-drop-overlay">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>{dropHint}</span>
            </div>
          )}
          {loading ? (
            <div className="fe-loading">
              <div className="fe-loading-dot" />
              <span>Loading...</span>
            </div>
          ) : files.length === 0 ? (
            <div className="fe-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.2, marginBottom: 8 }}>
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              <span>No files yet</span>
              <span className="fe-empty-hint">
                {currentPath
                  ? 'This folder is empty — drag files here to add them'
                  : 'Launch this instance to populate game files, or drag files in'}
              </span>
            </div>
          ) : (
            <div className="fe-list">
              {/* Column headers */}
              <div className="fe-list-header">
                <span className="fe-col-name">Name</span>
                <span className="fe-col-size">Size</span>
                <span className="fe-col-modified">Modified</span>
                <span className="fe-col-actions" />
              </div>

              {files.map((entry) => (
                <div
                  key={entry.path}
                  className={`fe-row${selected.has(entry.path) ? ' selected' : ''}${entry.isDirectory ? ' is-dir' : ''}`}
                  onClick={(e) => toggleSelect(entry.path, e)}
                  onDoubleClick={() => handleDoubleClick(entry)}
                >
                  <div className="fe-col-name">
                    <span className="fe-icon">{getIcon(entry)}</span>
                    {renaming === entry.path ? (
                      <input
                        className="fe-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(entry.path)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        onBlur={() => handleRename(entry.path)}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="fe-filename">{entry.name}</span>
                    )}
                  </div>
                  <span className="fe-col-size">{formatSize(entry.size)}</span>
                  <span className="fe-col-modified">{formatDate(entry.modified)}</span>
                  <div className="fe-col-actions" onClick={(e) => e.stopPropagation()}>
                    {/* Rename */}
                    <button
                      className="fe-action-btn"
                      title="Rename"
                      onClick={() => { setRenaming(entry.path); setRenameValue(entry.name) }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    </button>
                    {/* Delete */}
                    {confirmDelete === entry.path ? (
                      <div className="fe-confirm-delete">
                        <button className="fe-confirm-yes" onClick={() => handleDelete(entry.path)}>Delete</button>
                        <button className="fe-confirm-no" onClick={() => setConfirmDelete(null)}>✕</button>
                      </div>
                    ) : (
                      <button
                        className="fe-action-btn fe-action-delete"
                        title="Delete"
                        onClick={() => setConfirmDelete(entry.path)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    )}
                    {/* Open externally */}
                    <button
                      className="fe-action-btn"
                      title={entry.isDirectory ? 'Open in Explorer' : 'Open with default app'}
                      onClick={() => api?.openInstanceFile(instanceId, entry.path)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="fe-footer">
          <span className="fe-footer-count">
            {files.length} item{files.length !== 1 ? 's' : ''}
            {selected.size > 0 && ` · ${selected.size} selected`}
            {dropStatus && <span className="fe-drop-status"> · {dropStatus}</span>}
          </span>
          <button
            className="fe-footer-btn"
            onClick={() => api?.openInstanceFolder(instanceId)}
            title="Open in Windows Explorer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open in Explorer
          </button>
        </div>
      </div>
    </div>
  )
}
