import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useCustomization } from '../context/CustomizationContext'
import { useProxiedImage } from '../hooks/useProxiedImage'
import SpotifyWidget from '../components/SpotifyWidget'
import PrivacyCard from '../components/PrivacyCard'
import FileExplorer from '../components/FileExplorer'
import defaultInstanceIcon from '../assets/default-instance-icon.png'
import './LibraryPage.css'

interface ChangelogEntry {
  version: string
  date: string
  body: string
  url: string
}

interface Instance {
  id: string
  name: string
  version: string
  loader: string
  mods: number
  created: number
  lastPlayed: number | null
  color?: string
  backgroundImage?: string
  favorite?: boolean
  playtime?: number
  memoryMax?: number
  jvmArgs?: string
  resolution?: { width: number; height: number }
  createdBy?: string
  customIcon?: string
}

const LOADERS = ['Vanilla', 'Fabric', 'Forge', 'NeoForge', 'Quilt']

// ─── Version Picker ────────────────────────────────────────────────────────────

/** Versions with Dynamic Island + Loom HUD support (Fabric only) */
function isDynamicIslandSupported(version: string): boolean {
  return version.startsWith('1.21.1') || version === '1.21'
}

function groupVersionsByMajor(versions: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {}
  for (const v of versions) {
    const parts = v.split('.')
    const major = parts.length >= 2 ? `${parts[0]}.${parts[1]}.x` : v
    if (!groups[major]) groups[major] = []
    groups[major].push(v)
  }
  return groups
}

/** DI badge pill — shown on supported versions */
function DIBadge({ compact }: { compact?: boolean }) {
  return (
    <span className={`library-di-badge${compact ? ' compact' : ''}`}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="4" />
        <path d="M9 6h6" />
      </svg>
      Dynamic Island
    </span>
  )
}

interface VersionPickerProps {
  versions: string[]
  selected: string
  onSelect: (v: string) => void
  loading: boolean
}

function VersionPicker({ versions, selected, onSelect, loading }: VersionPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus search on open
  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const filtered = search
    ? versions.filter((v) => v.toLowerCase().includes(search.toLowerCase()))
    : versions

  const groups = groupVersionsByMajor(filtered)
  const latest = versions[0] ?? null

  // Recommended: DI-supported versions from the full list
  const recommended = versions.filter(isDynamicIslandSupported)

  const handleSelect = (v: string) => {
    onSelect(v)
    setOpen(false)
    setSearch('')
  }

  const selectedIsDI = selected && isDynamicIslandSupported(selected)

  return (
    <div className="library-version-container" ref={containerRef}>
      <button
        type="button"
        className={`library-version-trigger${selectedIsDI ? ' di-supported' : ''}`}
        onClick={() => {
          setOpen(!open)
          setSearch('')
        }}
        disabled={loading}
      >
        <span className="library-version-trigger-label">
          {loading ? 'Loading versions…' : selected || 'Select version'}
          {selectedIsDI && !loading && <DIBadge compact />}
        </span>
        <svg className="library-version-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && !loading && (
        <div className="library-version-picker">
          {/* Search bar */}
          <div className="library-version-search-wrap">
            <svg className="library-version-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              className="library-version-search"
              type="text"
              placeholder="Search versions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {filtered.length === 0 && (
            <div className="library-version-empty">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 6 }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              No versions found
            </div>
          )}

          {/* ── Recommended for Loom section ── */}
          {!search && recommended.length > 0 && (
            <div className="library-version-recommended">
              <div className="library-version-rec-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Recommended for Loom
              </div>
              <div className="library-version-rec-grid">
                {recommended.map((v) => (
                  <button
                    key={`rec-${v}`}
                    type="button"
                    className={`library-version-rec-card${v === selected ? ' selected' : ''}`}
                    onClick={() => handleSelect(v)}
                  >
                    <div className="library-version-rec-top">
                      <span className="library-version-rec-number">{v}</span>
                      {v === latest && <span className="library-version-latest-dot" title="Latest" />}
                    </div>
                    <DIBadge />
                    <div className="library-version-rec-sub">Fabric · Full HUD support</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Divider ── */}
          {!search && recommended.length > 0 && filtered.length > 0 && (
            <div className="library-version-divider">
              <span>All Versions</span>
            </div>
          )}

          {/* ── All version groups ── */}
          {Object.entries(groups).map(([group, versionList]) => (
            <div className="library-version-group" key={group}>
              <div className="library-version-group-label">{group}</div>
              <div className="library-version-grid">
                {versionList.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={
                      'library-version-chip' +
                      (v === selected ? ' selected' : '') +
                      (v === latest ? ' latest' : '') +
                      (isDynamicIslandSupported(v) ? ' di' : '')
                    }
                    onClick={() => handleSelect(v)}
                  >
                    <span>{v}</span>
                    {v === latest && <span className="library-version-badge">latest</span>}
                    {isDynamicIslandSupported(v) && (
                      <span className="library-version-di-dot" title="Dynamic Island supported" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Delete Confirmation Modal ─────────────────────────────────────────────────

interface DeleteConfirmProps {
  instanceName: string
  onCancel: () => void
  onConfirm: () => void
}

function DeleteConfirmModal({ instanceName, onCancel, onConfirm }: DeleteConfirmProps) {
  return (
    <div className="library-delete-confirm" onClick={onCancel}>
      <div className="library-delete-confirm-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="library-delete-confirm-title">Delete {instanceName}?</h3>
        <p className="library-delete-confirm-desc">
          This will remove all mods, resource packs, and game data.
        </p>
        <div className="library-delete-confirm-actions">
          <button className="library-delete-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="library-delete-btn" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Instance Modal ───────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#5F4B32', // Default brown (dirt)
  '#5E8B3D', // Grass green
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#EF4444', // Red
  '#F59E0B', // Amber
  '#10B981', // Emerald
  '#06B6D4', // Cyan
  '#6366F1', // Indigo
  '#F97316', // Orange
  '#1E1E24', // Dark
]



const MEMORY_PRESETS = [1024, 2048, 4096, 8192, 16384] // MB
const MEMORY_LABELS: Record<number, string> = { 1024: '1 GB', 2048: '2 GB', 4096: '4 GB', 8192: '8 GB', 16384: '16 GB' }

interface AccountInfo {
  uuid: string
  username: string
  displayName: string
}

interface EditModalProps {
  instance: Instance
  instanceIconUrl: string | null
  onCancel: () => void
  onSave: (updates: Partial<Instance>) => void
  onDelete: () => void
  onDuplicate: () => void
  onDuplicateToProfile: (targetProfileUuid: string) => void
  onOpenFolder: () => void
  onChangeIcon: () => void
  accounts: AccountInfo[]
  currentUserUuid?: string
}

function EditInstanceModal({ instance, instanceIconUrl, onCancel, onSave, onDelete, onDuplicate, onDuplicateToProfile, onOpenFolder, onChangeIcon, accounts, currentUserUuid }: EditModalProps) {
  const [name, setName] = useState(instance.name)
  const [color, setColor] = useState(instance.color || COLOR_PRESETS[0])
  const [bgImage, setBgImage] = useState(instance.backgroundImage || '')
  const [memoryMax, setMemoryMax] = useState(instance.memoryMax || 4096)
  const [customMemory, setCustomMemory] = useState('')
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showProfilePicker, setShowProfilePicker] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isCustomMemory = !MEMORY_PRESETS.includes(memoryMax)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setBgImage(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const previewStyle: React.CSSProperties = {
    background: bgImage
      ? `url(${bgImage}) center/cover no-repeat`
      : color,
    width: '100%',
    height: 80,
    borderRadius: 14,
    border: '1.5px solid var(--glass-border)',
    marginBottom: 4,
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'flex-end',
    padding: '10px 14px',
  }

  return (
    <div className="library-edit-modal" onClick={onCancel}>
      <div className="library-edit-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="library-edit-title">Edit Instance</h3>

        {/* Preview */}
        <div style={previewStyle}>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 14, textShadow: '0 1px 4px rgba(0,0,0,0.5)', position: 'relative', zIndex: 1 }}>
            {name || instance.name}
          </span>
          {bgImage && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(transparent 40%, rgba(0,0,0,0.5))', pointerEvents: 'none' }} />}
        </div>

        {/* Instance info badge */}
        <div className="library-edit-info">
          <span>{instance.version}</span>
          <span className="library-edit-info-dot">·</span>
          <span>{instance.loader || 'Vanilla'}</span>
          {instance.mods > 0 && <>
            <span className="library-edit-info-dot">·</span>
            <span>{instance.mods} mod{instance.mods !== 1 ? 's' : ''}</span>
          </>}
        </div>

        {/* Name */}
        <div className="library-form-field">
          <label className="library-form-label">Name</label>
          <input
            className="library-form-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {/* Color */}
        <div className="library-form-field">
          <label className="library-form-label">Card Color</label>
          <div className="library-color-grid">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`library-color-chip${color === c && !bgImage ? ' selected' : ''}`}
                style={{ background: c }}
                onClick={() => { setColor(c); setBgImage('') }}
                title={c}
              />
            ))}
            <label className="library-color-custom" title="Custom color">
              <input
                type="color"
                value={color}
                onChange={(e) => { setColor(e.target.value); setBgImage('') }}
                style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}
              />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </label>
          </div>
        </div>

        {/* Background Image */}
        <div className="library-form-field">
          <label className="library-form-label">Background Image</label>
          <div className="library-bg-actions">
            <button
              type="button"
              className="library-bg-upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              {bgImage ? 'Change Image' : 'Upload Image'}
            </button>
            {bgImage && (
              <button
                type="button"
                className="library-bg-remove-btn"
                onClick={() => setBgImage('')}
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageUpload}
          />
        </div>

        {/* Memory */}
        <div className="library-form-field">
          <label className="library-form-label">Memory (RAM)</label>
          <div className="library-memory-grid">
            {MEMORY_PRESETS.map((mb) => (
              <button
                key={mb}
                type="button"
                className={`library-memory-chip${memoryMax === mb ? ' selected' : ''}`}
                onClick={() => { setMemoryMax(mb); setCustomMemory('') }}
              >
                {MEMORY_LABELS[mb]}
              </button>
            ))}
            <div className={`library-memory-custom${isCustomMemory ? ' selected' : ''}`}>
              <input
                type="number"
                placeholder="Custom MB"
                value={isCustomMemory ? memoryMax : customMemory}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0
                  setCustomMemory(e.target.value)
                  if (val >= 512) setMemoryMax(val)
                }}
                className="library-memory-input"
              />
              <span className="library-memory-unit">MB</span>
            </div>
          </div>
        </div>

        {/* JVM Args */}
        <div className="library-form-field">
          <label className="library-form-label">JVM Arguments <span style={{ opacity: 0.4, fontWeight: 400, textTransform: 'none' }}>(advanced)</span></label>
          <input
            className="library-form-input"
            type="text"
            value={jvmArgs}
            onChange={(e) => setJvmArgs(e.target.value)}
            placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
          />
        </div>

        {/* Instance Icon */}
        <div className="library-form-field">
          <label className="library-form-label">Instance Icon</label>
          <div className="library-icon-picker">
            <div className="library-icon-preview">
              <img src={instanceIconUrl || defaultInstanceIcon} alt="Instance icon" />
            </div>
            <div className="library-icon-actions">
              <button type="button" className="library-bg-upload-btn" onClick={onChangeIcon}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                {instance.customIcon ? 'Change Icon' : 'Set Icon'}
              </button>
              {instance.customIcon && (
                <button type="button" className="library-bg-remove-btn" onClick={() => onSave({ customIcon: undefined })}>
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick actions row */}
        <div className="library-edit-quick-actions">
          <button className="library-edit-action-btn" onClick={onOpenFolder}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            Open Folder
          </button>
          <button className="library-edit-action-btn" onClick={onDuplicate}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            Duplicate
          </button>
          {accounts.length > 1 && (
            <button className="library-edit-action-btn" onClick={() => setShowProfilePicker(!showProfilePicker)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
              Copy to Profile
            </button>
          )}
        </div>

        {/* Profile picker list */}
        {showProfilePicker && (
          <div className="library-profile-picker">
            {accounts
              .filter(a => a.uuid !== currentUserUuid)
              .map(account => (
                <button
                  key={account.uuid}
                  className="library-profile-option"
                  onClick={() => {
                    onDuplicateToProfile(account.uuid)
                    setShowProfilePicker(false)
                  }}
                >
                  <div className="library-profile-option-avatar">
                    {account.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="library-profile-option-info">
                    <div className="library-profile-option-name">{account.displayName}</div>
                    <div className="library-profile-option-user">{account.username}</div>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            {accounts.filter(a => a.uuid !== currentUserUuid).length === 0 && (
              <div className="library-profile-empty">No other profiles available</div>
            )}
          </div>
        )}

        {/* Save / Cancel */}
        <div className="library-form-actions">
          <button className="library-form-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="library-form-submit"
            disabled={!name.trim()}
            onClick={() => onSave({
              name: name.trim(),
              color: bgImage ? undefined : color,
              backgroundImage: bgImage || undefined,
              memoryMax,
              jvmArgs: jvmArgs.trim() || undefined,
            })}
          >
            Save
          </button>
        </div>

        {/* Danger zone */}
        <div className="library-edit-danger">
          {confirmDelete ? (
            <div className="library-edit-danger-confirm">
              <span className="library-edit-danger-text">Are you sure? This cannot be undone.</span>
              <div className="library-edit-danger-btns">
                <button className="library-form-cancel" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="library-delete-btn" onClick={onDelete}>Delete</button>
              </div>
            </div>
          ) : (
            <button className="library-edit-delete-btn" onClick={() => setConfirmDelete(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Delete Instance
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Library Page ─────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { user, accounts, privacyEnabled, privacyRegion, setPrivacyEnabled, setPrivacyRegion } = useAuth()
  const { settings } = useCustomization()
  const headUrl = useProxiedImage(user ? `https://mc-heads.net/avatar/${user.uuid}/48` : null)

  const api = window.electronAPI

  const [instances, setInstances] = useState<Instance[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formVersion, setFormVersion] = useState('')
  const [formLoader, setFormLoader] = useState('Vanilla')
  const [creating, setCreating] = useState(false)
  const [launchStatus, setLaunchStatus] = useState<any>(null)

  // Dynamic version list state
  const [formVersions, setFormVersions] = useState<string[]>([])
  const [formVersionsLoading, setFormVersionsLoading] = useState(false)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null)

  // Edit modal state
  const [editTarget, setEditTarget] = useState<Instance | null>(null)

  // File explorer state
  const [fileExplorerTarget, setFileExplorerTarget] = useState<Instance | null>(null)

  // Instance icon URLs resolved from filesystem
  const [instanceIconUrls, setInstanceIconUrls] = useState<Record<string, string>>({})

  // Hidden file input for icon picker
  const iconInputRef = useRef<HTMLInputElement>(null)

  // Trash state
  const [trashedInstances, setTrashedInstances] = useState<(Instance & { deletedAt: number; expiresAt: number })[]>([])
  const [showTrash, setShowTrash] = useState(false)

  // Update status
  const [updateStatus, setUpdateStatus] = useState<string>('')
  const [updateProgress, setUpdateProgress] = useState<number>(0)

  // Changelog
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([])
  const [changelogLoading, setChangelogLoading] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)

  // Modpack import
  const [showModpackBrowser, setShowModpackBrowser] = useState(false)
  const [modpackClosing, setModpackClosing] = useState(false)
  const [modpackSearch, setModpackSearch] = useState('')
  const [modpackResults, setModpackResults] = useState<any[]>([])
  const [modpackSearching, setModpackSearching] = useState(false)
  const [modpackInstalling, setModpackInstalling] = useState<string | null>(null)
  const [modpackProgress, setModpackProgress] = useState<any>(null)
  const modpackFileRef = useRef<HTMLInputElement>(null)

  const closeModpackBrowser = useCallback(() => {
    if (modpackInstalling) return
    setModpackClosing(true)
    setTimeout(() => {
      setShowModpackBrowser(false)
      setModpackClosing(false)
    }, 250)
  }, [modpackInstalling])

  // ── Load Instances ──

  const loadInstances = useCallback(async () => {
    const data = await api?.getInstances()
    if (data) {
      setInstances(data)
      if (!selectedId && data.length > 0) {
        setSelectedId(data[0].id)
      }

      // Resolve custom icon URLs for instances that have them
      const iconUrls: Record<string, string> = {}
      for (const inst of data) {
        if (inst.customIcon) {
          try {
            const instPath = await api?.getInstancePath(inst.id)
            if (instPath) {
              iconUrls[inst.id] = `file://${instPath.replace(/\\/g, '/')}/${inst.customIcon}`
            }
          } catch { /* ignore */ }
        }
      }
      setInstanceIconUrls(iconUrls)
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTrash = useCallback(async () => {
    const data = await api?.getTrashedInstances()
    if (data) setTrashedInstances(data)
  }, [])

  useEffect(() => {
    loadInstances()
    loadTrash()

    // Setup launch status listener
    const cleanupStatus = window.electronAPI?.onLaunchStatus?.((status) => {
      setLaunchStatus(status)
      if (!status.running) {
        loadInstances()
      }
    })

    // Load initial status
    window.electronAPI?.getLaunchStatus?.().then(setLaunchStatus)

    // Refresh when Loomie performs actions (e.g. creates instance, installs mod)
    const handleLoomieAction = () => loadInstances()
    window.addEventListener('loomie-action', handleLoomieAction)

    // Listen for update status
    const cleanupUpdate = window.electronAPI?.onUpdateStatus?.((status: any) => {
      setUpdateStatus(status.status)
      if (status.progress) setUpdateProgress(status.progress)
    })

    // Check current update status
    window.electronAPI?.checkForUpdates?.()

    // Fetch changelog from GitHub
    setChangelogLoading(true)
    fetch('https://api.github.com/repos/ContiSupplu/Cobble/releases?per_page=10') // repo name is Cobble on GitHub
      .then(res => res.json())
      .then((releases: any[]) => {
        if (Array.isArray(releases)) {
          setChangelog(releases.map(r => ({
            version: r.tag_name?.replace(/^v/, '') || r.name,
            date: new Date(r.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            body: r.body || 'No release notes.',
            url: r.html_url
          })))
        }
      })
      .catch(() => {})
      .finally(() => setChangelogLoading(false))

    // Listen for modpack install progress from main process
    const cleanupModpack = api?.onModpackProgress?.((progress: any) => {
      setModpackProgress(progress)
    })

    return () => {
      if (cleanupStatus) cleanupStatus()
      if (cleanupUpdate) cleanupUpdate()
      if (cleanupModpack) cleanupModpack()
      window.removeEventListener('loomie-action', handleLoomieAction)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch versions when form opens or loader changes ──

  useEffect(() => {
    if (!showForm) return
    let cancelled = false
    setFormVersionsLoading(true)
    api?.getVersions(formLoader).then((v) => {
      if (cancelled) return
      const list = v ?? []
      setFormVersions(list)
      if (list.length > 0) {
        setFormVersion((prev) => (list.includes(prev) ? prev : list[0]))
      }
      setFormVersionsLoading(false)
    })
    return () => { cancelled = true }
  }, [showForm, formLoader]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ── (Filter instances by current profile)

  const filteredInstances = instances.filter((inst) => {
    if (!user) return true
    return inst.createdBy === user.uuid
  })

  const selected = filteredInstances.find((i) => i.id === selectedId) ?? filteredInstances[0] ?? null

  // ── Handlers ──

  const handleCreate = async () => {
    const trimmed = formName.trim()
    if (!trimmed || creating) return

    setCreating(true)
    try {
      const newInstance = await api?.createInstance({
        name: trimmed,
        version: formVersion,
        loader: formLoader,
        createdBy: user?.uuid
      })
      if (newInstance) {
        setSelectedId(newInstance.id)
      }
      await loadInstances()
      setShowForm(false)
      setFormName('')
      setFormVersion('')
      setFormLoader('Vanilla')
    } finally {
      setCreating(false)
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setFormName('')
    setFormVersion('')
    setFormLoader('Vanilla')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await api?.deleteInstance(deleteTarget.id)
    setDeleteTarget(null)
    if (selectedId === deleteTarget.id) {
      setSelectedId(null)
    }
    await loadInstances()
  }

  const handleEditSave = async (data: Partial<Instance>) => {
    if (!editTarget) return
    await api?.updateInstance(editTarget.id, data)
    setEditTarget(null)
    await loadInstances()
  }

  // ── Modpack Handlers ──

  const handleModpackFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // Reset input

    try {
      setModpackInstalling(file.name)
      setModpackProgress({ stage: 'Parsing modpack...', progress: 5 })

      const info = await api?.parseModpackFile(file.path)
      if (info?.error) throw new Error(info.error)

      // Create a new instance for this modpack
      const newInstance = await api?.createInstance({
        name: info.name || file.name.replace(/\.(zip|mrpack)$/i, ''),
        version: info.mcVersion,
        loader: info.loader,
        loaderVersion: info.loaderVersion,
        createdBy: user?.uuid
      })

      if (!newInstance) throw new Error('Failed to create instance')

      // Install the modpack into the instance
      setModpackProgress({ stage: 'Installing mods...', progress: 10 })
      const result = await api?.installModpack(file.path, newInstance.id)
      if (result?.error) throw new Error(result.error)

      setModpackProgress({ stage: 'Done!', progress: 100 })
      await loadInstances()
      setSelectedId(newInstance.id)

      setTimeout(() => {
        setModpackInstalling(null)
        setModpackProgress(null)
      }, 1500)
    } catch (err: any) {
      console.error('Modpack import failed:', err)
      setModpackProgress({ stage: `Error: ${err.message}`, progress: 0 })
      setTimeout(() => {
        setModpackInstalling(null)
        setModpackProgress(null)
      }, 3000)
    }
  }

  const handleModpackSearch = async () => {
    if (!modpackSearch.trim()) return
    setModpackSearching(true)
    try {
      const results = await api?.searchModrinthModpacks(modpackSearch.trim())
      setModpackResults(results?.hits || [])
    } catch {
      setModpackResults([])
    } finally {
      setModpackSearching(false)
    }
  }

  const handleModrinthPackInstall = async (pack: any) => {
    try {
      setModpackInstalling(pack.title)
      setModpackProgress({ stage: 'Fetching versions...', progress: 5 })

      // Get the latest version
      const versions = await api?.getModrinthPackVersions(pack.slug || pack.project_id)
      if (!versions || versions.length === 0) throw new Error('No versions found')
      const latest = versions[0]

      // Download the .mrpack
      setModpackProgress({ stage: 'Downloading modpack...', progress: 15 })
      const downloadResult = await api?.downloadModrinthPack(pack.slug || pack.project_id, latest.id)
      if (downloadResult?.error) throw new Error(downloadResult.error)

      // Parse it to get MC version and loader
      const info = await api?.parseModpackFile(downloadResult.filePath)
      if (info?.error) throw new Error(info.error)

      // Create instance
      setModpackProgress({ stage: 'Creating instance...', progress: 25 })
      const newInstance = await api?.createInstance({
        name: pack.title,
        version: info.mcVersion,
        loader: info.loader,
        loaderVersion: info.loaderVersion,
        createdBy: user?.uuid
      })
      if (!newInstance) throw new Error('Failed to create instance')

      // Install
      setModpackProgress({ stage: 'Installing mods...', progress: 30 })
      const result = await api?.installModpack(downloadResult.filePath, newInstance.id)
      if (result?.error) throw new Error(result.error)

      setModpackProgress({ stage: 'Done!', progress: 100 })
      await loadInstances()
      setSelectedId(newInstance.id)
      setShowModpackBrowser(false)

      setTimeout(() => {
        setModpackInstalling(null)
        setModpackProgress(null)
      }, 1500)
    } catch (err: any) {
      console.error('Modpack install failed:', err)
      setModpackProgress({ stage: `Error: ${err.message}`, progress: 0 })
      setTimeout(() => {
        setModpackInstalling(null)
        setModpackProgress(null)
      }, 3000)
    }
  }

  // ── Render ──

  return (
    <div className="library page-enter">
      {/* Custom background image from settings */}
      {settings.homeBackground && (
        <div
          className="library-custom-bg"
          style={{ backgroundImage: `url(${settings.homeBackground})` }}
        />
      )}
      <div className="library-center">
        {/* ── Update Banner ── */}
        {updateStatus === 'ready' && (
          <button
            className="library-update-banner"
            onClick={() => window.electronAPI?.installUpdate?.()}
          >
            <span className="library-update-dot" />
            Restart to Update →
          </button>
        )}
        {updateStatus === 'downloading' && (
          <div className="library-update-banner library-update-downloading">
            <span className="library-update-spinner" />
            Downloading update… {Math.round(updateProgress)}%
          </div>
        )}

        {settings.showGreeting && (
          <h1 className="library-greeting">Welcome back, {user?.username}</h1>
        )}

        {/* ── Hero Section ── */}
        {selected && (
          <div
            className="library-hero"
            style={selected.backgroundImage
              ? { background: `url(${selected.backgroundImage}) center/cover no-repeat`, backdropFilter: 'none' }
              : selected.color
                ? { background: selected.color, backdropFilter: 'none' }
                : undefined
            }
          >
            <div className="library-hero-left">
              <div className="library-hero-icon">
                <img
                  src={instanceIconUrls[selected.id] || defaultInstanceIcon}
                  alt="Instance icon"
                />
              </div>
              <div>
                <div className="library-hero-name">{selected.name}</div>
                <div className="library-hero-meta">
                  {selected.version} &middot; {selected.loader}
                  {selected.mods > 0 ? ` \u00b7 ${selected.mods} mods` : ''}
                </div>
              </div>
            </div>

            <div className="library-play-container">
              <button
                className={`library-hero-fav${selected.favorite ? ' active' : ''}`}
                onClick={async (e) => {
                  e.stopPropagation()
                  await api?.updateInstance(selected.id, { favorite: !selected.favorite })
                  await loadInstances()
                }}
                title={selected.favorite ? 'Remove from favorites' : 'Set as favorite'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={selected.favorite ? '#fbbf24' : 'none'} stroke={selected.favorite ? '#fbbf24' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
              {launchStatus?.running ? (
                <div className="library-launch-action">
                  <div className="library-launch-status">{launchStatus.task || 'Launching...'}</div>
                  <button className="library-launch-kill" onClick={() => window.electronAPI?.killGame?.()}>
                    Stop
                  </button>
                </div>
              ) : (
                <button
                  className="library-play"
                  onClick={() => {
                    if (user) {
                      localStorage.setItem('loom_last_played_instance', selected.id)
                      window.electronAPI?.launch?.(selected.id).catch(() => {})
                    }
                  }}
                  disabled={launchStatus?.running || !user}
                >
                  Play
                </button>
              )}
            </div>
          </div>
        )}

        {!selected && !showForm && (
          <div className="library-empty library-empty-cta" onClick={() => setShowForm(true)}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.3, marginBottom: 12 }}>
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            <div>Don't have an instance?</div>
            <div className="library-empty-link">Create one now →</div>
          </div>
        )}

        <div className="library-spotify">
          <SpotifyWidget />
        </div>

        {/* ── Instance List ── */}
        <div className="library-instances">
          {filteredInstances.map((inst) => (
            <button
              key={inst.id}
              className={`library-inst${inst.id === selectedId ? ' selected' : ''}${inst.favorite ? ' favorite' : ''}`}
              onClick={() => {
                setSelectedId(inst.id)
                // Pre-warm OS page cache — read JARs/mods into RAM before Play
                window.electronAPI?.prewarmInstance?.(inst.id)
              }}
              style={inst.backgroundImage
                ? { background: `url(${inst.backgroundImage}) center/cover no-repeat`, backdropFilter: 'none' }
                : inst.color
                  ? { background: inst.color, backdropFilter: 'none' }
                  : undefined
              }
            >
              <div className="library-inst-icon">
                <img
                  src={instanceIconUrls[inst.id] || defaultInstanceIcon}
                  alt=""
                />
              </div>
              <div className="library-inst-info">
                <div className="library-inst-name">
                  {inst.favorite && (
                    <svg className="library-inst-star-icon" width="10" height="10" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  )}
                  {inst.name}
                </div>
                <div className="library-inst-meta">{inst.version} &middot; {inst.loader}</div>
              </div>
              <div
                className="library-inst-edit"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditTarget(inst)
                }}
                title="Edit instance"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </div>
            </button>
          ))}
          <button
            className="library-inst library-new"
            onClick={() => setShowForm(!showForm)}
            title="New instance"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            className="library-inst library-new"
            onClick={() => setShowModpackBrowser(true)}
            title="Import modpack"
            style={{ fontSize: '11px', gap: '4px' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <input
            ref={modpackFileRef}
            type="file"
            accept=".zip,.mrpack"
            style={{ display: 'none' }}
            onChange={handleModpackFileImport}
          />
        </div>

        {/* ── Trash Section ── */}
        {trashedInstances.length > 0 && (
          <div className="library-trash-section">
            <button
              className="library-trash-toggle"
              onClick={() => setShowTrash(!showTrash)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Trash ({trashedInstances.length})
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginLeft: 'auto' }}>
                <polyline points={showTrash ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
              </svg>
            </button>
            {showTrash && (
              <div className="library-trash-list">
                {trashedInstances.map(inst => {
                  const daysLeft = Math.max(0, Math.ceil((inst.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
                  return (
                    <div key={inst.id} className="library-trash-item">
                      <div className="library-trash-item-info">
                        <div className="library-trash-item-name">{inst.name}</div>
                        <div className="library-trash-item-meta">
                          {inst.version} {inst.loader} -- {daysLeft} days left
                        </div>
                      </div>
                      <div className="library-trash-item-actions">
                        <button
                          className="library-trash-recover"
                          onClick={async () => {
                            await api?.recoverInstance(inst.id)
                            await loadInstances()
                            await loadTrash()
                          }}
                          title="Recover"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                          </svg>
                          Recover
                        </button>
                        <button
                          className="library-trash-delete"
                          onClick={async () => {
                            await api?.permanentlyDeleteInstance(inst.id)
                            await loadTrash()
                          }}
                          title="Delete forever"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Changelog Section ── */}
        <div className="library-changelog-section">
          <button
            className="library-changelog-toggle"
            onClick={() => setShowChangelog(!showChangelog)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Changelog
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginLeft: 'auto' }}>
              <polyline points={showChangelog ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
            </svg>
          </button>
          {showChangelog && (
            <div className="library-changelog-list">
              {changelogLoading && (
                <div className="library-changelog-loading">Loading changelog…</div>
              )}
              {!changelogLoading && changelog.length === 0 && (
                <div className="library-changelog-empty">No releases found</div>
              )}
              {changelog.map((entry) => (
                <div key={entry.version} className="library-changelog-entry">
                  <div className="library-changelog-header">
                    <span className="library-changelog-version">v{entry.version}</span>
                    <span className="library-changelog-date">{entry.date}</span>
                  </div>
                  <div className="library-changelog-body">
                    {entry.body.split('\n').map((line, i) => {
                      const trimmed = line.trim()
                      if (!trimmed) return null

                      // Parse inline markdown: **bold**, *italic*, `code`
                      const parseInline = (text: string) => {
                        const parts: React.ReactNode[] = []
                        let remaining = text
                        let key = 0
                        while (remaining.length > 0) {
                          // Bold: **text**
                          const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
                          // Code: `text`
                          const codeMatch = remaining.match(/`(.+?)`/)

                          // Find the earliest match
                          const matches = [
                            boldMatch ? { type: 'bold', match: boldMatch } : null,
                            codeMatch ? { type: 'code', match: codeMatch } : null,
                          ].filter(Boolean).sort((a, b) => (a!.match.index! - b!.match.index!))

                          if (matches.length === 0) {
                            parts.push(remaining)
                            break
                          }

                          const first = matches[0]!
                          const idx = first.match.index!
                          if (idx > 0) parts.push(remaining.slice(0, idx))

                          if (first.type === 'bold') {
                            parts.push(<strong key={key++}>{first.match[1]}</strong>)
                          } else if (first.type === 'code') {
                            parts.push(<code key={key++} style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '4px', fontSize: '0.9em' }}>{first.match[1]}</code>)
                          }
                          remaining = remaining.slice(idx + first.match[0].length)
                        }
                        return parts
                      }

                      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                        return <div key={i} className="library-changelog-bullet">• {parseInline(trimmed.slice(2))}</div>
                      }
                      if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
                        return <div key={i} className="library-changelog-subheading">{parseInline(trimmed.replace(/^#+\s*/, ''))}</div>
                      }
                      return <div key={i}>{parseInline(trimmed)}</div>
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Privacy Mode Card ── */}
        <PrivacyCard
          enabled={privacyEnabled}
          onToggle={setPrivacyEnabled}
          selectedRegion={privacyRegion}
          onRegionChange={setPrivacyRegion}
          disabled={selected ? selected.loader === 'Vanilla' : false}
          disabledReason="Privacy Mode requires Fabric or Forge"
        />

        {/* ── Create Instance Form ── */}
        {showForm && (
          <div className="library-form">
            <div className="library-form-field">
              <label className="library-form-label">Name</label>
              <input
                className="library-form-input"
                type="text"
                placeholder="My Instance"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>

            <div className="library-form-field">
              <label className="library-form-label">Loader</label>
              <div className="library-form-loaders">
                {LOADERS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={`library-form-loader${formLoader === l ? ' active' : ''}`}
                    onClick={() => setFormLoader(l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="library-form-field">
              <label className="library-form-label">Version</label>
              <VersionPicker
                versions={formVersions}
                selected={formVersion}
                onSelect={setFormVersion}
                loading={formVersionsLoading}
              />
            </div>

            <div className="library-form-actions">
              <button className="library-form-cancel" onClick={handleCancel}>
                Cancel
              </button>
              <button
                className="library-form-submit"
                onClick={handleCreate}
                disabled={!formName.trim() || creating || !formVersion}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit Instance Modal ── */}
      {/* Hidden file input for icon picker */}
      <input
        ref={iconInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file || !editTarget) return
          // For Electron file inputs, the path is available
          const filePath = (file as any).path || file.name
          if (filePath) {
            await api?.setInstanceIcon(editTarget.id, filePath)
            await loadInstances()
            // Re-fetch editTarget with updated data
            const updated = instances.find(i => i.id === editTarget.id)
            if (updated) setEditTarget({ ...updated })
          }
          e.target.value = ''
        }}
      />

      {editTarget && (
        <EditInstanceModal
          instance={editTarget}
          instanceIconUrl={instanceIconUrls[editTarget.id] || null}
          onCancel={() => setEditTarget(null)}
          onSave={handleEditSave}
          onDelete={async () => {
            const id = editTarget.id
            setEditTarget(null)
            await api?.deleteInstance(id)
            if (selectedId === id) setSelectedId(null)
            await loadInstances()
          }}
          onDuplicate={async () => {
            const cloned = await api?.cloneInstance(editTarget.id, `${editTarget.name} (Copy)`)
            if (cloned) {
              setEditTarget(null)
              await loadInstances()
              setSelectedId(cloned.id)
            }
          }}
          onDuplicateToProfile={async (targetProfileUuid: string) => {
            const cloned = await api?.cloneInstance(
              editTarget.id,
              `${editTarget.name} (copy)`,
              targetProfileUuid
            )
            if (cloned) {
              setEditTarget(null)
              await loadInstances()
            }
          }}
          onOpenFolder={() => {
            setFileExplorerTarget(editTarget)
            setEditTarget(null)
          }}
          onChangeIcon={() => {
            iconInputRef.current?.click()
          }}
          accounts={accounts}
          currentUserUuid={user?.uuid}
        />
      )}

      {/* ── File Explorer ── */}
      {fileExplorerTarget && (
        <FileExplorer
          instanceId={fileExplorerTarget.id}
          instanceName={fileExplorerTarget.name}
          onClose={() => setFileExplorerTarget(null)}
        />
      )}

      {/* ── Modpack Progress Overlay ── */}
      {modpackInstalling && modpackProgress && (
        <div className="library-modpack-overlay">
          <div className="library-modpack-progress">
            <div className="library-modpack-progress-title">
              📦 {modpackInstalling}
            </div>
            <div className="library-modpack-progress-bar">
              <div
                className="library-modpack-progress-fill"
                style={{ width: `${modpackProgress.progress || 0}%` }}
              />
            </div>
            <div className="library-modpack-progress-detail">
              {modpackProgress.stage === 'downloading' ? 'Installing mods...' : modpackProgress.stage}
            </div>
            {modpackProgress.detail && (
              <div className="library-modpack-progress-files">
                {modpackProgress.detail}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modpack Browser Modal ── */}
      {showModpackBrowser && (
        <div className={`library-modpack-backdrop${modpackClosing ? ' closing' : ''}`} onClick={closeModpackBrowser}>
          <div className="library-modpack-browser" onClick={(e) => e.stopPropagation()}>
            <div className="library-modpack-header">
              <span className="library-modpack-title">Import Modpack</span>
              <button className="library-modpack-close" onClick={closeModpackBrowser}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="library-modpack-actions">
              <button
                className="library-modpack-file-btn"
                onClick={() => modpackFileRef.current?.click()}
                disabled={!!modpackInstalling}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                Import from File (.zip / .mrpack)
              </button>
            </div>

            <div className="library-modpack-divider">
              <span>or browse Modrinth</span>
            </div>

            <div className="library-modpack-search">
              <input
                type="text"
                placeholder="Search modpacks..."
                value={modpackSearch}
                onChange={(e) => setModpackSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleModpackSearch()}
              />
              <button onClick={handleModpackSearch} disabled={modpackSearching}>
                {modpackSearching ? '...' : 'Search'}
              </button>
            </div>

            <div className="library-modpack-results">
              {modpackResults.length === 0 && !modpackSearching && (
                <div className="library-modpack-empty">
                  Search for modpacks on Modrinth to get started
                </div>
              )}
              {modpackResults.map((pack: any) => (
                <div key={pack.slug || pack.project_id} className="library-modpack-card">
                  {pack.icon_url && (
                    <img src={pack.icon_url} alt="" className="library-modpack-icon" />
                  )}
                  <div className="library-modpack-info">
                    <div className="library-modpack-name">{pack.title}</div>
                    <div className="library-modpack-desc">{pack.description}</div>
                    <div className="library-modpack-meta">
                      {pack.downloads?.toLocaleString()} downloads
                      {pack.categories && ` · ${pack.categories.slice(0, 3).join(', ')}`}
                    </div>
                  </div>
                  <button
                    className="library-modpack-install-btn"
                    onClick={() => handleModrinthPackInstall(pack)}
                    disabled={!!modpackInstalling}
                  >
                    {modpackInstalling === pack.title ? 'Installing...' : 'Install'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
