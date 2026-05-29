import { useState, useRef, useEffect, useCallback } from 'react'
import './ProfileScreen.css'

const api = (window as any).electronAPI

interface Account {
  uuid: string
  username: string
  displayName: string
}

interface ProfileScreenProps {
  accounts: Account[]
  activeUuid: string | null
  onSelect: (uuid: string) => void
  onAddAccount: () => void
  onRemoveAccount: (uuid: string) => void
  onEditDisplayName: (uuid: string, newName: string) => void
  onClose: () => void
}

export default function ProfileScreen({
  accounts,
  activeUuid,
  onSelect,
  onAddAccount,
  onRemoveAccount,
  onEditDisplayName,
  onClose,
}: ProfileScreenProps) {
  const [managing, setManaging] = useState(false)
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [exiting, setExiting] = useState(false)
  const editRef = useRef<HTMLInputElement>(null)

  // Resolved skin URLs from Mojang session server (always fresh)
  const [skinUrls, setSkinUrls] = useState<Record<string, string>>({})

  // Resolve skins directly from Mojang on mount
  const resolveSkins = useCallback(async () => {
    if (!api?.resolveSkinUrl) return
    const urls: Record<string, string> = {}
    for (const account of accounts) {
      try {
        const url = await api.resolveSkinUrl(account.uuid)
        if (url) urls[account.uuid] = url
      } catch { /* ignore */ }
    }
    setSkinUrls(urls)
  }, [accounts])

  useEffect(() => {
    resolveSkins()
  }, [resolveSkins])

  useEffect(() => {
    if (editingUuid && editRef.current) {
      editRef.current.focus()
      editRef.current.select()
    }
  }, [editingUuid])

  const handleClose = () => {
    setExiting(true)
    setTimeout(onClose, 300)
  }

  const handleSelect = (uuid: string) => {
    if (managing) return
    setExiting(true)
    setTimeout(() => onSelect(uuid), 300)
  }

  const handleEditStart = (uuid: string) => {
    const account = accounts.find(a => a.uuid === uuid)
    if (!account) return
    setEditValue(account.displayName)
    setEditingUuid(uuid)
    setConfirmRemove(null)
  }

  const handleEditCommit = () => {
    if (!editingUuid) return
    const trimmed = editValue.trim()
    const account = accounts.find(a => a.uuid === editingUuid)
    if (trimmed && account && trimmed !== account.displayName) {
      onEditDisplayName(editingUuid, trimmed)
    }
    setEditingUuid(null)
  }

  const handleEditKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleEditCommit()
    if (e.key === 'Escape') setEditingUuid(null)
  }

  const handleRemove = (uuid: string) => {
    onRemoveAccount(uuid)
    setConfirmRemove(null)
    setManaging(accounts.length > 2) // stay managing if still multiple
  }

  // Use resolved Mojang skin URLs (always fresh), fallback to mc-heads.net
  const skinUrl = (uuid: string, _size: number) => {
    if (skinUrls[uuid]) return skinUrls[uuid]
    return `https://mc-heads.net/avatar/${uuid}/120`
  }

  return (
    <div className={`profile-screen${exiting ? ' profile-screen--exit' : ''}`}>
      <div className="profile-screen-inner">
        <h1 className="profile-screen-title">
          {managing ? 'Manage Profiles' : "Who's playing?"}
        </h1>

        <div className="profile-screen-grid">
          {accounts.map((account, i) => {
            const isEditing = editingUuid === account.uuid
            const isConfirming = confirmRemove === account.uuid

            return (
              <div
                key={account.uuid}
                className={`profile-card${account.uuid === activeUuid ? ' profile-card--active' : ''}`}
                style={{ animationDelay: `${i * 80}ms` }}
                onClick={() => !managing && !isEditing && handleSelect(account.uuid)}
              >
                <div className="profile-card-avatar-wrap">
                  <img
                    className="profile-card-avatar"
                    src={skinUrl(account.uuid, 120)}
                    alt={account.displayName}
                    draggable={false}
                  />
                  {managing && !isEditing && !isConfirming && (
                    <div className="profile-card-manage-overlay">
                      <button
                        className="profile-card-edit-overlay"
                        onClick={(e) => { e.stopPropagation(); handleEditStart(account.uuid) }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      {accounts.length > 1 && (
                        <button
                          className="profile-card-delete-overlay"
                          onClick={(e) => { e.stopPropagation(); setConfirmRemove(account.uuid) }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isConfirming ? (
                  <div className="profile-card-confirm">
                    <span className="profile-card-confirm-text">Remove?</span>
                    <div className="profile-card-confirm-actions">
                      <button className="profile-card-confirm-btn" onClick={(e) => { e.stopPropagation(); setConfirmRemove(null) }}>
                        Cancel
                      </button>
                      <button className="profile-card-confirm-btn profile-card-confirm-btn--danger" onClick={(e) => { e.stopPropagation(); handleRemove(account.uuid) }}>
                        Remove
                      </button>
                    </div>
                  </div>
                ) : isEditing ? (
                  <div className="profile-card-edit" onClick={e => e.stopPropagation()}>
                    <input
                      ref={editRef}
                      className="profile-card-edit-input"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={handleEditCommit}
                      onKeyDown={handleEditKey}
                      maxLength={24}
                      spellCheck={false}
                    />
                  </div>
                ) : (
                  <span className="profile-card-name">{account.displayName}</span>
                )}
              </div>
            )
          })}

          {/* Add Account card */}
          <div
            className="profile-card profile-card--add"
            style={{ animationDelay: `${accounts.length * 80}ms` }}
            onClick={() => onAddAccount()}
          >
            <div className="profile-card-avatar-wrap profile-card-add-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <span className="profile-card-name">Add Account</span>
          </div>
        </div>

        {/* Bottom actions */}
        <div className="profile-screen-actions">
          {accounts.length > 0 && (
            <button
              className="profile-screen-manage"
              onClick={() => {
                setManaging(!managing)
                setEditingUuid(null)
                setConfirmRemove(null)
              }}
            >
              {managing ? 'Done' : 'Manage Profiles'}
            </button>
          )}
        </div>
      </div>

      {/* Close — if there's an active account, let them back out */}
      {activeUuid && (
        <button className="profile-screen-close" onClick={handleClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  )
}
