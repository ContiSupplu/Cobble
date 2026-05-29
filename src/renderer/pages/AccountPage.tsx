import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useProxiedImage } from '../hooks/useProxiedImage'
import './AccountPage.css'

const api = (window as any).electronAPI

interface Friend {
  uuid: string
  username: string
  addedAt: number
  note?: string
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return '1 month ago'
  return `${months} months ago`
}

function FriendAvatar({ uuid, username }: { uuid: string; username: string }) {
  const [skinUrl, setSkinUrl] = useState<string | null>(null)
  const fallback = useProxiedImage(`https://mc-heads.net/avatar/${uuid}/64`)

  useEffect(() => {
    if (!api?.resolveSkinUrl) return
    api.resolveSkinUrl(uuid, 64).then((url: string | null) => {
      if (url) setSkinUrl(url)
    })
  }, [uuid])

  const src = skinUrl || fallback
  return (
    <div className="friend-avatar">
      {src ? <img src={src} alt={username} /> : <div className="friend-avatar-placeholder" />}
    </div>
  )
}

export default function AccountPage() {
  const { user, logout } = useAuth()
  const [friends, setFriends] = useState<Friend[]>([])
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteValue, setNoteValue] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const headFallback = useProxiedImage(user ? `https://mc-heads.net/avatar/${user.uuid}/80` : null)
  const [headResolved, setHeadResolved] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.uuid || !api?.resolveSkinUrl) return
    api.resolveSkinUrl(user.uuid, 80).then((url: string | null) => {
      if (url) setHeadResolved(url)
    })
  }, [user?.uuid])

  const headSrc = headResolved || headFallback

  const loadFriends = useCallback(async () => {
    if (!api?.getFriends) return
    const list = await api.getFriends()
    setFriends(list || [])
  }, [])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  if (!user) return null

  const handleAddFriend = async () => {
    const username = addInput.trim()
    if (!username) return
    setAddError('')
    setAddLoading(true)
    try {
      const result = await api.addFriend(username)
      if (result?.error) {
        setAddError(result.error)
      } else {
        setAddInput('')
        setAddError('')
        setShowAddForm(false)
        await loadFriends()
      }
    } catch {
      setAddError('Failed to add friend')
    } finally {
      setAddLoading(false)
    }
  }

  const handleRemoveFriend = async (uuid: string) => {
    await api.removeFriend(uuid)
    setConfirmRemove(null)
    await loadFriends()
  }

  const handleSaveNote = async (uuid: string) => {
    await api.updateFriendNote(uuid, noteValue)
    setEditingNote(null)
    await loadFriends()
  }

  const startEditNote = (friend: Friend) => {
    setEditingNote(friend.uuid)
    setNoteValue(friend.note || '')
  }

  return (
    <div className="account page-enter">
      <div className="account-profile">
        <div className="account-head">
          {headSrc && <img src={headSrc} alt={user.username} />}
        </div>
        <div className="account-info">
          <h1 className="account-username">{user.username}</h1>
          <div className="account-uuid">{user.uuid}</div>
        </div>
        <button className="account-logout" onClick={logout}>Sign out</button>
      </div>

      <div className="account-sections">
        {/* ── Friends Section ── */}
        <div className="account-section">
          <div className="account-section-header">
            <h2 className="account-section-title">Friends</h2>
            <button
              className="account-section-action"
              onClick={() => { setShowAddForm(!showAddForm); setAddError(''); setAddInput('') }}
            >
              {showAddForm ? 'Cancel' : 'Add Friend'}
            </button>
          </div>

          {/* Add Friend Form */}
          {showAddForm && (
            <div className="friend-add-form">
              <div className="friend-add-input-row">
                <input
                  type="text"
                  className="friend-add-input"
                  placeholder="Minecraft username..."
                  value={addInput}
                  onChange={e => { setAddInput(e.target.value); setAddError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddFriend() }}
                  disabled={addLoading}
                  autoFocus
                />
                <button
                  className="friend-add-btn"
                  onClick={handleAddFriend}
                  disabled={addLoading || !addInput.trim()}
                >
                  {addLoading ? (
                    <span className="friend-add-spinner" />
                  ) : (
                    'Add'
                  )}
                </button>
              </div>
              {addError && <div className="friend-add-error">{addError}</div>}
            </div>
          )}

          {/* Friend List */}
          {friends.length > 0 ? (
            <div className="friend-list">
              {friends.map(friend => (
                <div className="friend-card" key={friend.uuid}>
                  <FriendAvatar uuid={friend.uuid} username={friend.username} />
                  <div className="friend-details">
                    <div className="friend-name">{friend.username}</div>
                    <div className="friend-meta">Added {timeAgo(friend.addedAt)}</div>

                    {/* Note display / edit */}
                    {editingNote === friend.uuid ? (
                      <div className="friend-note-edit">
                        <input
                          type="text"
                          className="friend-note-input"
                          value={noteValue}
                          onChange={e => setNoteValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveNote(friend.uuid); if (e.key === 'Escape') setEditingNote(null) }}
                          placeholder="Add a note..."
                          autoFocus
                          maxLength={100}
                        />
                        <button className="friend-note-save" onClick={() => handleSaveNote(friend.uuid)}>Save</button>
                        <button className="friend-note-cancel" onClick={() => setEditingNote(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="friend-note" onClick={() => startEditNote(friend)}>
                        {friend.note || 'Click to add a note...'}
                      </div>
                    )}
                  </div>

                  {/* Remove */}
                  <div className="friend-actions">
                    {confirmRemove === friend.uuid ? (
                      <div className="friend-confirm-remove">
                        <span className="friend-confirm-text">Remove?</span>
                        <button className="friend-confirm-yes" onClick={() => handleRemoveFriend(friend.uuid)}>Yes</button>
                        <button className="friend-confirm-no" onClick={() => setConfirmRemove(null)}>No</button>
                      </div>
                    ) : (
                      <button className="friend-remove-btn" onClick={() => setConfirmRemove(friend.uuid)} title="Remove friend">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : !showAddForm ? (
            <div className="account-empty">
              <p className="account-empty-text">No friends added yet</p>
              <p className="account-empty-hint">Add a friend by their Minecraft username to keep track of your group.</p>
            </div>
          ) : null}
        </div>

        {/* ── Messages Section ── */}
        <div className="account-section">
          <div className="account-section-header">
            <h2 className="account-section-title">Messages</h2>
          </div>
          <div className="account-empty">
            <p className="account-empty-text">No messages</p>
            <p className="account-empty-hint">Messages from your friends will appear here.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
