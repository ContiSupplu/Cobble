import { useState, useEffect, useCallback } from 'react'
import './SyncSettings.css'

const api = (window as any).electronAPI

interface SyncableItem {
  id: string
  type: 'file' | 'directory'
  relativePath: string
  label: string
  category: 'settings' | 'worlds' | 'resources'
  versionSensitive: boolean
}

interface SyncGroup {
  id: string
  name: string
  items: string[]
  instanceIds: string[]
  conflictStrategy: 'newest' | 'manual'
  createdAt: number
}

interface SyncGroupStats {
  files: number
  totalSize: number
  instances: number
}

interface SyncSettingsProps {
  instances: { id: string; name: string }[]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const ITEM_ICONS: Record<string, JSX.Element> = {
  options: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  servers: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  ),
  saves: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  config: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  ),
  resourcepacks: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="2.5" /><path d="M17.5 10.5l-5-5L2 16l6 6 4-4" /><path d="M15 17l5 5" /><path d="M20 12l-9.5 9.5" />
    </svg>
  ),
  shaderpacks: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" /><path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1 3 1z" /><path d="M18 16l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z" />
    </svg>
  ),
}

const CATEGORY_ORDER: Array<{ key: string; label: string }> = [
  { key: 'settings', label: 'Settings' },
  { key: 'worlds', label: 'Worlds' },
  { key: 'resources', label: 'Resources' },
]

export default function SyncSettings({ instances }: SyncSettingsProps) {
  const [groups, setGroups] = useState<SyncGroup[]>([])
  const [syncableItems, setSyncableItems] = useState<SyncableItem[]>([])
  const [groupStats, setGroupStats] = useState<Record<string, SyncGroupStats>>({})
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newItems, setNewItems] = useState<string[]>([])
  const [newInstances, setNewInstances] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [config, items] = await Promise.all([
        api?.syncGetConfig?.(),
        api?.syncGetSyncableItems?.(),
      ])
      const loadedGroups: SyncGroup[] = config?.groups ?? []
      setGroups(loadedGroups)
      setSyncableItems(items ?? [])

      // Load stats for each group
      const stats: Record<string, SyncGroupStats> = {}
      await Promise.all(
        loadedGroups.map(async (g: SyncGroup) => {
          try {
            stats[g.id] = await api?.syncGetGroupStats?.(g.id)
          } catch {
            stats[g.id] = { files: 0, totalSize: 0, instances: 0 }
          }
        })
      )
      setGroupStats(stats)
    } catch {
      // API not available yet
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleCreate = async () => {
    if (!newName.trim() || newItems.length === 0 || newInstances.length === 0) return
    setCreating(true)
    try {
      await api?.syncCreateGroup?.(newName.trim(), newItems, newInstances)
      setNewName('')
      setNewItems([])
      setNewInstances([])
      setShowCreate(false)
      await loadData()
    } catch { /* ignore */ }
    setCreating(false)
  }

  const handleDelete = async (groupId: string) => {
    try {
      await api?.syncDeleteGroup?.(groupId)
      await loadData()
    } catch { /* ignore */ }
  }

  const toggleInstance = async (groupId: string, instanceId: string, isInGroup: boolean) => {
    try {
      if (isInGroup) {
        await api?.syncRemoveInstance?.(groupId, instanceId)
      } else {
        await api?.syncAddInstance?.(groupId, instanceId)
      }
      await loadData()
    } catch { /* ignore */ }
  }

  const toggleNewItem = (id: string) => {
    setNewItems(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  const toggleNewInstance = (id: string) => {
    setNewInstances(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  const groupedItems = CATEGORY_ORDER.map(cat => ({
    ...cat,
    items: syncableItems.filter(i => i.category === cat.key),
  })).filter(cat => cat.items.length > 0)

  if (loading) {
    return (
      <div className="sync-panel settings-section">
        <div className="settings-label">File Sync</div>
        <div className="sync-header">
          <div className="sync-header-icon sync-header-icon--spinning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </div>
          <div>
            <div className="sync-title">File Sync</div>
            <div className="sync-desc">Loading sync configuration...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sync-panel settings-section">
      <div className="settings-label">File Sync</div>
      {/* ── Header ── */}
      <div className="sync-header">
        <div className="sync-header-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </div>
        <div>
          <div className="sync-title">File Sync</div>
          <div className="sync-desc">Sync settings, worlds, and resources across your instances</div>
        </div>
      </div>

      {/* ── Groups ── */}
      {groups.length === 0 && !showCreate ? (
        <div className="sync-empty">
          <div className="sync-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </div>
          <div className="sync-empty-text">No sync groups yet. Create one to keep files in sync across instances.</div>
        </div>
      ) : (
        <div className="sync-groups">
          {groups.map((group) => {
            const stats = groupStats[group.id]
            return (
              <div key={group.id} className="sync-group-card">
                {/* Group Header */}
                <div className="sync-group-header">
                  <div className="sync-group-name">{group.name}</div>
                  <button
                    className="sync-group-delete"
                    onClick={() => handleDelete(group.id)}
                    title="Delete sync group"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>

                {/* Synced Items */}
                <div className="sync-group-items">
                  {syncableItems.map(item => (
                    <div
                      key={item.id}
                      className={`sync-item${group.items.includes(item.id) ? ' sync-item--active' : ''}`}
                    >
                      <span className="sync-item-icon">{ITEM_ICONS[item.id]}</span>
                      <span className="sync-item-label">{item.label}</span>
                      {item.versionSensitive && (
                        <span className="sync-item-badge" title="Version sensitive">⚠</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Instances */}
                <div className="sync-group-instances">
                  {instances.map(inst => {
                    const isInGroup = group.instanceIds.includes(inst.id)
                    return (
                      <button
                        key={inst.id}
                        className={`sync-instance-chip${isInGroup ? ' active' : ''}`}
                        onClick={() => toggleInstance(group.id, inst.id, isInGroup)}
                        title={isInGroup ? `Remove ${inst.name}` : `Add ${inst.name}`}
                      >
                        <span className="sync-instance-avatar">{inst.name.charAt(0).toUpperCase()}</span>
                        <span className="sync-instance-name">{inst.name}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Stats */}
                {stats && (
                  <div className="sync-group-stats">
                    <div className="sync-stat">
                      <span className="sync-stat-value">{stats.files}</span>
                      <span className="sync-stat-label">files synced</span>
                    </div>
                    <div className="sync-stat">
                      <span className="sync-stat-value">{formatBytes(stats.totalSize)}</span>
                      <span className="sync-stat-label">total size</span>
                    </div>
                    <div className="sync-stat">
                      <span className="sync-stat-value">{stats.instances}</span>
                      <span className="sync-stat-label">instances</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Create Form ── */}
      {showCreate ? (
        <div className="sync-create-form">
          <div className="sync-form-field">
            <label className="sync-form-label">Group Name</label>
            <input
              className="sync-form-input"
              type="text"
              placeholder="e.g. My SMP Settings"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="sync-form-field">
            <label className="sync-form-label">Items to Sync</label>
            {groupedItems.map(cat => (
              <div key={cat.key}>
                <div className="sync-form-category">{cat.label}</div>
                <div className="sync-form-items">
                  {cat.items.map(item => (
                    <button
                      key={item.id}
                      className={`sync-form-item${newItems.includes(item.id) ? ' checked' : ''}`}
                      onClick={() => toggleNewItem(item.id)}
                    >
                      <span className="sync-form-item-icon">{ITEM_ICONS[item.id]}</span>
                      <span className="sync-form-item-label">{item.label}</span>
                      <span className="sync-form-item-check">
                        {newItems.includes(item.id) && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="sync-form-field">
            <label className="sync-form-label">Instances</label>
            <div className="sync-form-instances">
              {instances.map(inst => (
                <button
                  key={inst.id}
                  className={`sync-form-instance${newInstances.includes(inst.id) ? ' selected' : ''}`}
                  onClick={() => toggleNewInstance(inst.id)}
                >
                  <span className="sync-form-instance-avatar">{inst.name.charAt(0).toUpperCase()}</span>
                  <span>{inst.name}</span>
                </button>
              ))}
              {instances.length === 0 && (
                <div className="sync-empty-text" style={{ fontSize: 11 }}>No instances found</div>
              )}
            </div>
          </div>

          <div className="sync-form-actions">
            <button
              className="sync-form-btn"
              onClick={() => { setShowCreate(false); setNewName(''); setNewItems([]); setNewInstances([]) }}
            >
              Cancel
            </button>
            <button
              className="sync-form-btn primary"
              onClick={handleCreate}
              disabled={creating || !newName.trim() || newItems.length === 0 || newInstances.length === 0}
            >
              {creating ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </div>
      ) : (
        <button className="sync-create-btn" onClick={() => setShowCreate(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Sync Group
        </button>
      )}
    </div>
  )
}
