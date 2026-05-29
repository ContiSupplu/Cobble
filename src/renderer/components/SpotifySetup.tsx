import { useState, useEffect } from 'react'

interface SpotifySetupProps {
  onClose: () => void
  onConnected: () => void
}

/**
 * Reusable Spotify setup overlay — shows the Client ID / Redirect URI wizard
 * then triggers OAuth login. Used by both SpotifyWidget and SettingsPage.
 */
export default function SpotifySetup({ onClose, onConnected }: SpotifySetupProps) {
  const api = (window as any).electronAPI

  const [clientId, setClientId] = useState('')
  const [redirectUri, setRedirectUri] = useState('https://127.0.0.1:18492/callback')
  const [configSaved, setConfigSaved] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api?.getSpotifyConfig().then((cfg: any) => {
      if (cfg?.clientId) {
        setClientId(cfg.clientId)
        setConfigSaved(true)
      }
      if (cfg?.redirectUri) setRedirectUri(cfg.redirectUri)
    })
  }, [])

  const handleSaveAndConnect = async () => {
    if (!clientId.trim()) return
    // Save config if changed
    await api?.setSpotifyConfig({ clientId: clientId.trim(), redirectUri: redirectUri.trim() })
    setConfigSaved(true)
    setSetupError('')
    setConnecting(true)
    try {
      const result = await api?.spotifyLogin()
      if (result?.connected) {
        onConnected()
      } else if (result?.error) {
        setSetupError(result.error)
      }
    } catch { /* ignore */ }
    setConnecting(false)
  }

  return (
    <div className="spotify-setup-overlay" onClick={onClose}>
      <div className="spotify-setup" onClick={(e) => e.stopPropagation()}>
        <div className="spotify-setup-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#1db954">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          <h2>Connect Spotify</h2>
          <button className="spotify-setup-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="spotify-setup-body">
          <div className="spotify-setup-steps">
            <div className="spotify-setup-step">
              <div className="spotify-setup-step-num">1</div>
              <div>
                <strong>Create a Spotify Developer App</strong>
                <p>Go to <span className="spotify-setup-link">developer.spotify.com/dashboard</span> and sign in. Click "Create App".</p>
              </div>
            </div>

            <div className="spotify-setup-step">
              <div className="spotify-setup-step-num">2</div>
              <div>
                <strong>Fill in App Details</strong>
                <p>Set the App name. Under "Redirect URIs", add the following (click to copy):</p>
                <code
                  className={`spotify-setup-code spotify-setup-copyable${copied ? ' spotify-setup-copied' : ''}`}
                  onClick={() => {
                    navigator.clipboard.writeText('https://127.0.0.1:18492/callback')
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                >
                  {copied ? 'Copied to clipboard' : 'https://127.0.0.1:18492/callback'}
                </code>
                <p className="spotify-setup-note">If it says "This redirect URI is not secure" -- that is normal. Click "Add" anyway.</p>
                <p>Check "Web API" under APIs used, then click "Save".</p>
              </div>
            </div>

            <div className="spotify-setup-step">
              <div className="spotify-setup-step-num">3</div>
              <div>
                <strong>Copy your Client ID</strong>
                <p>Find the "Client ID" and paste it below.</p>
              </div>
            </div>
          </div>

          {setupError && (
            <div className="spotify-setup-error">{setupError}</div>
          )}

          <div className="spotify-setup-fields">
            <label className="spotify-setup-label">
              Client ID
              <input
                className="spotify-setup-input"
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Paste your Spotify Client ID here"
                spellCheck={false}
              />
            </label>
            <label className="spotify-setup-label">
              Redirect URI
              <input
                className="spotify-setup-input"
                type="text"
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                spellCheck={false}
              />
            </label>
          </div>

          <button
            className="spotify-setup-submit"
            onClick={handleSaveAndConnect}
            disabled={!clientId.trim() || connecting}
          >
            {connecting ? 'Connecting...' : configSaved ? 'Connect' : 'Save and Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
