import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import './LoginPage.css'

declare global {
  interface Window {
    electronAPI?: {
      lookupPlayer: (username: string) => Promise<{ name: string; id: string } | null>
      login: () => Promise<{ username?: string; uuid?: string; error?: string } | null>
      [key: string]: unknown
    }
  }
}

export default function LoginPage() {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleMicrosoftLogin = async () => {
    setLoading(true)
    setError('')

    try {
      const result = await window.electronAPI?.login()
      if (!result) {
        setError('Authentication failed. Try again.')
        setLoading(false)
        return
      }
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
      if (result.username && result.uuid) {
        login({ username: result.username, uuid: result.uuid })
      } else {
        setError('Could not get account info.')
        setLoading(false)
      }
    } catch {
      setError('Something went wrong. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="login">
      <video
        className="login-video"
        src="./login-bg.mp4"
        autoPlay
        loop
        muted
        playsInline
      />
      <div className="login-overlay" />

      <div className="login-card">
        <div className="login-brand">Loom</div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-desc">Sign in with your Microsoft account to access your Minecraft profile.</p>

        {error && <div className="login-error">{error}</div>}

        <button
          className="login-btn login-btn-ms"
          onClick={handleMicrosoftLogin}
          disabled={loading}
        >
          <svg className="login-ms-icon" width="20" height="20" viewBox="0 0 23 23">
            <rect x="1" y="1" width="10" height="10" fill="#f25022" />
            <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
            <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
            <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
          </svg>
          {loading ? 'Signing in...' : 'Sign in with Microsoft'}
        </button>
      </div>

      <div className="login-credit">Credit: Roburrito DX</div>
    </div>
  )
}
