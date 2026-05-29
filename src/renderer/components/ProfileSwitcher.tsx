import { useState, useRef, useEffect, useCallback } from 'react'
import './ProfileSwitcher.css'

interface ProfileSwitcherProps {
  accounts: Array<{ uuid: string; username: string; displayName: string }>
  activeUuid: string | null
  onSwitch: (uuid: string) => void
  onAddAccount: () => void
  onRemoveAccount: (uuid: string) => void
  onEditDisplayName: (uuid: string, newName: string) => void
  incognitoActive?: boolean
}

export default function ProfileSwitcher({
  accounts,
  activeUuid,
  onSwitch,
  onAddAccount,
  onRemoveAccount,
  onEditDisplayName,
  incognitoActive,
}: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [contextUuid, setContextUuid] = useState<string | null>(null)
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmRemoveUuid, setConfirmRemoveUuid] = useState<string | null>(null)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const activeAccount = accounts.find((a) => a.uuid === activeUuid) ?? accounts[0] ?? null

  // Close everything on outside click
  const handleBackdropClick = useCallback(() => {
    setOpen(false)
    setContextUuid(null)
    setEditingUuid(null)
    setConfirmRemoveUuid(null)
  }, [])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingUuid && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingUuid])

  // Close context menu when dropdown closes
  useEffect(() => {
    if (!open) {
      setContextUuid(null)
      setEditingUuid(null)
      setConfirmRemoveUuid(null)
    }
  }, [open])

  const handleToggle = () => {
    setOpen((prev) => !prev)
  }

  const handleSwitch = (uuid: string) => {
    if (uuid !== activeUuid) {
      onSwitch(uuid)
    }
    setOpen(false)
  }

  const handleMoreClick = (e: React.MouseEvent, uuid: string) => {
    e.stopPropagation()
    setContextUuid(contextUuid === uuid ? null : uuid)
    setEditingUuid(null)
    setConfirmRemoveUuid(null)
  }

  const handleEditStart = (uuid: string) => {
    const account = accounts.find((a) => a.uuid === uuid)
    if (!account) return
    setEditValue(account.displayName)
    setEditingUuid(uuid)
    setContextUuid(null)
  }

  const handleEditCommit = (uuid: string) => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== accounts.find((a) => a.uuid === uuid)?.displayName) {
      onEditDisplayName(uuid, trimmed)
    }
    setEditingUuid(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, uuid: string) => {
    if (e.key === 'Enter') {
      handleEditCommit(uuid)
    } else if (e.key === 'Escape') {
      setEditingUuid(null)
    }
  }

  const handleRemoveClick = (uuid: string) => {
    setContextUuid(null)
    setConfirmRemoveUuid(uuid)
  }

  const handleConfirmRemove = (uuid: string) => {
    onRemoveAccount(uuid)
    setConfirmRemoveUuid(null)
  }

  const avatarUrl = (uuid: string) => `https://mc-heads.net/avatar/${uuid}/28`

  return (
    <div className="profile-switcher">
      {open && <div className="profile-switcher-backdrop" onClick={handleBackdropClick} />}

      {/* Collapsed trigger */}
      <button
        className={`profile-switcher-trigger${open ? ' open' : ''}`}
        onClick={handleToggle}
        data-tooltip={activeAccount?.displayName ?? 'Accounts'}
      >
        {activeAccount ? (
          <img
            className="profile-switcher-head"
            src={avatarUrl(activeAccount.uuid)}
            alt={activeAccount.displayName}
          />
        ) : (
          <div className="profile-switcher-head-placeholder">?</div>
        )}
        {incognitoActive && (
          <span className="profile-switcher-incognito">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </span>
        )}
      </button>

      {/* Dropdown */}
      <div
        ref={dropdownRef}
        className={`profile-switcher-dropdown${open ? ' visible' : ''}`}
      >
        <div className="profile-switcher-accounts">
          {accounts.map((account) => {
            const isActive = account.uuid === activeUuid
            const isEditing = editingUuid === account.uuid
            const isConfirming = confirmRemoveUuid === account.uuid
            const showContext = contextUuid === account.uuid

            if (isConfirming) {
              return (
                <div key={account.uuid} className="profile-switcher-confirm">
                  <div className="profile-switcher-confirm-text">
                    Remove <strong>{account.displayName}</strong>?
                  </div>
                  <div className="profile-switcher-confirm-actions">
                    <button
                      className="profile-switcher-confirm-btn cancel"
                      onClick={() => setConfirmRemoveUuid(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="profile-switcher-confirm-btn remove"
                      onClick={() => handleConfirmRemove(account.uuid)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={account.uuid}
                className={`profile-switcher-row${isActive ? ' active' : ''}`}
                onClick={() => !isEditing && handleSwitch(account.uuid)}
              >
                <img
                  className="profile-switcher-row-head"
                  src={avatarUrl(account.uuid)}
                  alt={account.displayName}
                />

                <div className="profile-switcher-row-info">
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      className="profile-switcher-edit-input"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleEditCommit(account.uuid)}
                      onKeyDown={(e) => handleEditKeyDown(e, account.uuid)}
                      onClick={(e) => e.stopPropagation()}
                      spellCheck={false}
                      maxLength={32}
                    />
                  ) : (
                    <>
                      <div className="profile-switcher-row-name">{account.displayName}</div>
                      {account.username !== account.displayName && (
                        <div className="profile-switcher-row-username">{account.username}</div>
                      )}
                    </>
                  )}
                </div>

                {isActive && !isEditing && (
                  <svg className="profile-switcher-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}

                {!isEditing && (
                  <button
                    className="profile-switcher-more"
                    onClick={(e) => handleMoreClick(e, account.uuid)}
                  >
                    ⋯
                  </button>
                )}

                {showContext && (
                  <div className="profile-switcher-context" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="profile-switcher-context-item"
                      onClick={() => handleEditStart(account.uuid)}
                    >
                      <svg className="profile-switcher-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Edit Name
                    </button>
                    <button
                      className="profile-switcher-context-item danger"
                      onClick={() => handleRemoveClick(account.uuid)}
                    >
                      <svg className="profile-switcher-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="profile-switcher-divider" />

        <button className="profile-switcher-add" onClick={onAddAccount}>
          <div className="profile-switcher-add-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <span className="profile-switcher-add-label">Add Account</span>
        </button>
      </div>
    </div>
  )
}
