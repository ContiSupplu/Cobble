import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './ChangingRoomPage.css'

const api = (window as any).electronAPI

export default function ChangingRoomPage() {
  const { user } = useAuth()
  const [bodyUrl, setBodyUrl] = useState<string | null>(null)
  const [variant, setVariant] = useState<'classic' | 'slim'>('classic')
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const loadSkin = useCallback(async () => {
    if (!user?.uuid || !api) return
    const [body, current] = await Promise.all([
      api.resolveBodyUrl(user.uuid, 256),
      api.getCurrentSkin(),
    ])
    if (body) setBodyUrl(body)
    if (current?.variant) setVariant(current.variant.toLowerCase() as 'classic' | 'slim')
  }, [user?.uuid])

  useEffect(() => { loadSkin() }, [loadSkin])

  const handleUpload = async () => {
    if (!api) return
    const filePath = await api.pickSkinFile()
    if (!filePath) return
    setUploading(true)
    setStatus(null)
    const result = await api.uploadSkin(filePath, variant)
    if (result.success) {
      setStatus({ type: 'success', msg: 'Skin changed' })
      setTimeout(() => loadSkin(), 1500)
    } else {
      setStatus({ type: 'error', msg: result.error || 'Upload failed' })
    }
    setUploading(false)
  }

  if (!user) {
    return (
      <div className="changing-room page-enter">
        <h1 className="changing-room-title">Changing Room</h1>
        <p className="changing-room-empty">Sign in to manage your skin</p>
      </div>
    )
  }

  return (
    <div className="changing-room page-enter">
      <h1 className="changing-room-title">Changing Room</h1>

      <div className="changing-room-content">
        <div className="changing-room-preview">
          {bodyUrl ? (
            <img src={bodyUrl} alt="Current skin" draggable={false} />
          ) : (
            <div className="changing-room-placeholder">Loading...</div>
          )}
        </div>

        <div className="changing-room-controls">
          <div className="changing-room-variant-row">
            <button
              className={`changing-room-variant-btn ${variant === 'classic' ? 'active' : ''}`}
              onClick={() => setVariant('classic')}
            >Classic</button>
            <button
              className={`changing-room-variant-btn ${variant === 'slim' ? 'active' : ''}`}
              onClick={() => setVariant('slim')}
            >Slim</button>
          </div>

          <button
            className="changing-room-upload-btn"
            onClick={handleUpload}
            disabled={uploading}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {uploading ? 'Uploading...' : 'Upload Skin'}
          </button>

          {status && (
            <div className={`changing-room-status changing-room-status--${status.type}`}>
              {status.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
