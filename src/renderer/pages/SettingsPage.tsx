import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCustomization } from '../context/CustomizationContext'
import { useTheme } from '../context/ThemeContext'
import SpotifySetup from '../components/SpotifySetup'
import SyncSettings from '../components/SyncSettings'
import ModStoreStats from '../components/ModStoreStats'
import '../components/SyncSettings.css'
import './SettingsPage.css'

const accentPresets = [
  { name: 'Amber', color: '#d4915a' },
  { name: 'Rose', color: '#c97070' },
  { name: 'Emerald', color: '#5a9e6f' },
  { name: 'Sky', color: '#5a8ec9' },
  { name: 'Violet', color: '#8b6fc0' },
  { name: 'Slate', color: '#8a8a8a' },
]

/** Collapsible tutorial dropdown */
function TutorialDropdown({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`settings-tutorial${open ? ' open' : ''}`}>
      <button className="settings-tutorial-toggle" onClick={() => setOpen(!open)}>
        <svg className="settings-tutorial-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {title}
      </button>
      {open && <div className="settings-tutorial-body">{children}</div>}
    </div>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const { settings, update, reset } = useCustomization()
  const { activeTheme, theme: currentTheme, setTheme, themes } = useTheme()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const api = (window as any).electronAPI
  const navigate = useNavigate()

  // ── Instances list (for sync/vault components) ──
  const [instances, setInstances] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    api?.getInstances?.().then((list: any[]) => {
      setInstances(list.map((i: any) => ({ id: i.id, name: i.name })))
    })
  }, [])

  // ── Quick Launch state ──
  const [quickLaunch, setQuickLaunch] = useState(() => localStorage.getItem('loom_quick_launch') === 'true')

  // ── Spotify connection state ──
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [spotifyChecking, setSpotifyChecking] = useState(true)
  const [spotifyDisconnecting, setSpotifyDisconnecting] = useState(false)
  const [showSpotifySetup, setShowSpotifySetup] = useState(false)

  // ── Update state ──
  const [appVersion, setAppVersion] = useState('...')
  const [updateStatus, setUpdateStatus] = useState<string>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updatePercent, setUpdatePercent] = useState(0)

  useEffect(() => {
    checkSpotify()
    checkDiscord()
    // Load version
    api?.getAppVersion?.().then((v: string) => setAppVersion(v || '1.0.0'))
    // Listen for update events
    const unsub = api?.onUpdateStatus?.((data: any) => {
      setUpdateStatus(data.status)
      if (data.version) setUpdateVersion(data.version)
      if (data.percent !== undefined) setUpdatePercent(data.percent)
    })
    return () => unsub?.()
  }, [])

  const checkSpotify = async () => {
    setSpotifyChecking(true)
    try {
      const status = await api?.getSpotifyStatus?.()
      setSpotifyConnected(status?.connected === true)
    } catch {
      setSpotifyConnected(false)
    }
    setSpotifyChecking(false)
  }

  const disconnectSpotify = async () => {
    setSpotifyDisconnecting(true)
    await api?.spotifyLogout?.()
    setSpotifyConnected(false)
    setSpotifyDisconnecting(false)
  }

  const connectSpotify = () => {
    setShowSpotifySetup(true)
  }

  // ── Discord state ──
  const [discordConnected, setDiscordConnected] = useState(false)
  const [discordChecking, setDiscordChecking] = useState(true)
  const [discordAppId, setDiscordAppId] = useState('')
  const [discordError, setDiscordError] = useState('')
  const [discordConnecting, setDiscordConnecting] = useState(false)

  const checkDiscord = async () => {
    setDiscordChecking(true)
    try {
      const [status, config] = await Promise.all([
        api?.getDiscordStatus?.(),
        api?.getDiscordConfig?.(),
      ])
      setDiscordConnected(status?.connected === true)
      if (config?.appId) setDiscordAppId(config.appId)
    } catch {
      setDiscordConnected(false)
    }
    setDiscordChecking(false)
  }

  const connectDiscord = async () => {
    if (!discordAppId.trim()) return
    setDiscordConnecting(true)
    setDiscordError('')
    try {
      const result = await api?.discordConnect?.(discordAppId.trim())
      if (result?.connected) {
        setDiscordConnected(true)
      } else {
        setDiscordError(result?.error || 'Failed to connect')
      }
    } catch {
      setDiscordError('Failed to connect to Discord')
    }
    setDiscordConnecting(false)
  }

  const disconnectDiscordRPC = async () => {
    await api?.discordDisconnect?.()
    setDiscordConnected(false)
  }

  // ── Gemini API key ──
  const [geminiKeyVisible, setGeminiKeyVisible] = useState(false)
  const [geminiKeyInput, setGeminiKeyInput] = useState(settings.geminiApiKey || '')
  const geminiSaved = settings.geminiApiKey === geminiKeyInput && !!geminiKeyInput

  const saveGeminiKey = () => {
    update('geminiApiKey', geminiKeyInput.trim() || null)
  }

  const clearGeminiKey = () => {
    setGeminiKeyInput('')
    update('geminiApiKey', null)
  }

  // ── Background ──
  const handleBgSelect = () => fileInputRef.current?.click()

  const handleBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => update('homeBackground', reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const clearBg = () => update('homeBackground', null)

  // ── Advanced Performance ──
  const [perfModpack, setPerfModpack] = useState(true)
  const [perfJvmFlags, setPerfJvmFlags] = useState(true)
  const [perfHighPriority, setPerfHighPriority] = useState(true)
  const [perfGameSettings, setPerfGameSettings] = useState(true)
  const [perfDefenderExclusion, setPerfDefenderExclusion] = useState(false)
  const [perfPowerPlan, setPerfPowerPlan] = useState(false)
  const [perfNetwork, setPerfNetwork] = useState(false)
  const [perfIris, setPerfIris] = useState(false)
  const [perfCacheAndSkip, setPerfCacheAndSkip] = useState(true)

  useEffect(() => {
    api?.storeGet('perf_modpack').then((v: any) => setPerfModpack(v ?? true))
    api?.storeGet('perf_jvm_flags').then((v: any) => setPerfJvmFlags(v ?? true))
    api?.storeGet('perf_high_priority').then((v: any) => setPerfHighPriority(v ?? true))
    api?.storeGet('perf_game_settings').then((v: any) => setPerfGameSettings(v ?? true))
    api?.storeGet('perf_defender_exclusion').then((v: any) => setPerfDefenderExclusion(v ?? false))
    api?.storeGet('perf_power_plan').then((v: any) => setPerfPowerPlan(v ?? false))
    api?.storeGet('perf_network').then((v: any) => setPerfNetwork(v ?? false))
    api?.storeGet('perf_iris_shaders').then((v: any) => setPerfIris(v ?? false))
    api?.storeGet('perf_cache_and_skip').then((v: any) => setPerfCacheAndSkip(v ?? true))
  }, [])

  const togglePerf = (key: string, current: boolean, setter: (v: boolean) => void) => {
    const next = !current
    setter(next)
    api?.storeSet(key, next)
  }

  return (
    <div className="settings page-enter">
      <h1 className="settings-title">Settings</h1>

      {/* ── Appearance ── */}
      <div className="settings-section">
        <div className="settings-label">Appearance</div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Theme</div>
            <div className="settings-row-desc">Choose how Loom looks</div>
          </div>
          <div className="settings-themes">
            {themes.map((t) => (
              <button
                key={t.id}
                className={`settings-theme-card${activeTheme === t.id ? ' active' : ''}`}
                onClick={() => setTheme(t.id)}
              >
                <div className="settings-theme-preview">
                  <div className="stp-sidebar" style={{ background: t.preview.sidebar }} />
                  <div className="stp-content" style={{ background: t.preview.bg }}>
                    <div className="stp-accent" style={{ background: t.preview.accent }} />
                  </div>
                </div>
                <span className="settings-theme-name">{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        {!currentTheme.lockedAccent && (
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Accent Color</div>
            <div className="settings-row-desc">Choose a color for buttons and highlights</div>
          </div>
          <div className="settings-colors">
            {accentPresets.map((p) => (
              <button
                key={p.color}
                className={`settings-swatch${settings.accentColor === p.color ? ' active' : ''}`}
                style={{ background: p.color }}
                onClick={() => update('accentColor', p.color)}
                title={p.name}
              />
            ))}
          </div>
        </div>
        )}

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Home Background</div>
            <div className="settings-row-desc">Set a custom image for your home screen</div>
          </div>
          <div className="settings-bg-actions">
            {settings.homeBackground && (
              <button className="settings-btn-sm" onClick={clearBg}>Remove</button>
            )}
            <button className="settings-btn-sm settings-btn-accent" onClick={handleBgSelect}>
              {settings.homeBackground ? 'Change' : 'Choose Image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleBgFile}
              style={{ display: 'none' }}
            />
          </div>
        </div>


        <div className="settings-row">
          <div>
            <div className="settings-row-title">Show Greeting</div>
            <div className="settings-row-desc">Display "Welcome back" on the home screen</div>
          </div>
          <button
            className={`settings-toggle${settings.showGreeting ? ' on' : ''}`}
            onClick={() => update('showGreeting', !settings.showGreeting)}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>

        <div className="settings-row last">
          <div>
            <div className="settings-row-title">Quick Launch</div>
            <div className="settings-row-desc">Show a Quick Launch button on the splash screen to jump straight into your last played instance</div>
          </div>
          <button
            className={`settings-toggle${quickLaunch ? ' on' : ''}`}
            onClick={() => {
              const next = !quickLaunch
              setQuickLaunch(next)
              localStorage.setItem('loom_quick_launch', String(next))
            }}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>
      </div>

      {/* ── Connected Apps ── */}
      <div className="settings-section">
        <div className="settings-label">Connected Apps</div>

        <div className="settings-apps-grid">
          {/* ── Spotify ── */}
          <div className="settings-app-card">
            <div className="settings-app-header">
              <div className="settings-app-icon settings-app-icon-spotify">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
              </div>
              <div className="settings-app-info">
                <div className="settings-app-name">Spotify</div>
                <div className="settings-app-status">
                  {spotifyChecking ? (
                    <span className="settings-app-checking">Checking...</span>
                  ) : spotifyConnected ? (
                    <span className="settings-app-connected">
                      <span className="settings-app-dot connected" />
                      Connected
                    </span>
                  ) : (
                    <span className="settings-app-disconnected">Not connected</span>
                  )}
                </div>
              </div>
            </div>
            <div className="settings-app-desc">
              Control your music from the Dynamic Island while you play
            </div>

            <TutorialDropdown title="How to set up Spotify">
              <ol className="settings-tutorial-steps">
                <li>Go to the <strong>Spotify Developer Dashboard</strong> at <em>developer.spotify.com</em></li>
                <li>Click <strong>"Create App"</strong> and name it anything (e.g. "Loom")</li>
                <li>Set the <strong>Redirect URI</strong> to: <code>http://localhost:8888/callback</code></li>
                <li>Copy your <strong>Client ID</strong> and paste it into the Spotify widget setup</li>
                <li>Click <strong>"Connect"</strong> below and sign into your Spotify account</li>
              </ol>
            </TutorialDropdown>

            <div className="settings-app-actions">
              {spotifyConnected ? (
                <>
                  <button
                    className="settings-app-btn danger"
                    onClick={disconnectSpotify}
                    disabled={spotifyDisconnecting}
                  >
                    {spotifyDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                  <button className="settings-app-btn" onClick={connectSpotify}>
                    Switch Account
                  </button>
                </>
              ) : (
                <button className="settings-app-btn accent" onClick={connectSpotify}>
                  Connect
                </button>
              )}
            </div>
          </div>

          {/* ── Gemini AI ── */}
          <div className="settings-app-card">
            <div className="settings-app-header">
              <div className="settings-app-icon settings-app-icon-gemini">
                <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
                  <path d="M14 0C14 7.732 7.732 14 0 14c7.732 0 14 6.268 14 14 0-7.732 6.268-14 14-14-7.732 0-14-6.268-14-14z" fill="url(#gem-g)" />
                  <defs>
                    <linearGradient id="gem-g" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#4285F4" />
                      <stop offset="0.33" stopColor="#9B72CB" />
                      <stop offset="0.66" stopColor="#D96570" />
                      <stop offset="1" stopColor="#D96570" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="settings-app-info">
                <div className="settings-app-name">Gemini AI</div>
                <div className="settings-app-status">
                  {settings.geminiApiKey ? (
                    <span className="settings-app-connected">
                      <span className="settings-app-dot connected" />
                      API key set
                    </span>
                  ) : (
                    <span className="settings-app-disconnected">No API key</span>
                  )}
                </div>
              </div>
            </div>
            <div className="settings-app-desc">
              AI assistant for crafting help, crash analysis, and mod recommendations
            </div>

            <TutorialDropdown title="How to get a free API key">
              <ol className="settings-tutorial-steps">
                <li>Go to <strong>Google AI Studio</strong> at <em>aistudio.google.com</em></li>
                <li>Sign in with your Google account</li>
                <li>Click <strong>"Get API Key"</strong> in the top-left menu</li>
                <li>Click <strong>"Create API key"</strong> and select any project</li>
                <li>Copy the key and paste it below — it's completely free!</li>
              </ol>
            </TutorialDropdown>

            <div className="settings-app-key-row">
              <div className="settings-app-key-input-wrap">
                <input
                  type={geminiKeyVisible ? 'text' : 'password'}
                  className="settings-app-key-input"
                  placeholder="Paste your Gemini API key"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveGeminiKey()}
                />
                <button
                  className="settings-app-key-toggle"
                  onClick={() => setGeminiKeyVisible(!geminiKeyVisible)}
                  title={geminiKeyVisible ? 'Hide' : 'Show'}
                >
                  {geminiKeyVisible ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {settings.geminiApiKey ? (
                <button className="settings-app-btn danger" onClick={clearGeminiKey}>
                  Remove
                </button>
              ) : (
                <button
                  className={`settings-app-btn${geminiKeyInput.trim() ? ' accent' : ''}`}
                  onClick={saveGeminiKey}
                  disabled={!geminiKeyInput.trim()}
                >
                  Save
                </button>
              )}
            </div>
          </div>

          {/* ── Discord Rich Presence ── */}
          <div className="settings-app-card">
            <div className="settings-app-header">
              <div className="settings-app-icon settings-app-icon-discord">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
              </div>
              <div className="settings-app-info">
                <div className="settings-app-name">Discord Rich Presence</div>
                <div className="settings-app-status">
                  {discordChecking ? (
                    <span className="settings-app-checking">Checking...</span>
                  ) : discordConnected ? (
                    <span className="settings-app-connected">
                      <span className="settings-app-dot connected" />
                      Connected
                    </span>
                  ) : (
                    <span className="settings-app-disconnected">Not connected</span>
                  )}
                </div>
              </div>
            </div>
            <div className="settings-app-desc">
              Show "Playing Minecraft" on your Discord profile with instance name and elapsed time
            </div>

            <TutorialDropdown title="How to set up Discord Rich Presence">
              <ol className="settings-tutorial-steps">
                <li>Go to the <strong>Discord Developer Portal</strong> at <em>discord.com/developers/applications</em></li>
                <li>Click <strong>"New Application"</strong> and name it (e.g. "Loom" or "Minecraft")</li>
                <li>Under <strong>Rich Presence → Art Assets</strong>, upload a logo (optional)</li>
                <li>Copy the <strong>Application ID</strong> from the General Information page</li>
                <li>Paste it below and click <strong>Connect</strong> — Discord must be running!</li>
              </ol>
            </TutorialDropdown>

            {discordError && (
              <div className="settings-app-error">{discordError}</div>
            )}

            <div className="settings-app-key-row">
              <div className="settings-app-key-input-wrap">
                <input
                  type="text"
                  className="settings-app-key-input"
                  placeholder="Discord Application ID"
                  value={discordAppId}
                  onChange={(e) => setDiscordAppId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && connectDiscord()}
                />
              </div>
              {discordConnected ? (
                <button className="settings-app-btn danger" onClick={disconnectDiscordRPC}>
                  Disconnect
                </button>
              ) : (
                <button
                  className={`settings-app-btn${discordAppId.trim() ? ' accent' : ''}`}
                  onClick={connectDiscord}
                  disabled={!discordAppId.trim() || discordConnecting}
                >
                  {discordConnecting ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── File Sync ── */}
      <SyncSettings instances={instances} />

      {/* ── Mod Vault ── */}
      <ModStoreStats instances={instances} />

      {/* ── About ── */}
      <div className="settings-section">
        <div className="settings-label">About</div>
        <div className="settings-row">
          <div className="settings-row-title">Version</div>
          <div className="settings-row-val">{appVersion}</div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Updates</div>
            <div className="settings-row-desc">
              {updateStatus === 'idle' && 'Click to check for updates'}
              {updateStatus === 'checking' && 'Checking...'}
              {updateStatus === 'up-to-date' && "You're on the latest version"}
              {updateStatus === 'available' && `Version ${updateVersion} available`}
              {updateStatus === 'downloading' && `Downloading update... ${updatePercent}%`}
              {updateStatus === 'ready' && `Version ${updateVersion} ready to install`}
              {updateStatus === 'error' && 'Update check failed'}
            </div>
          </div>
          {updateStatus === 'ready' ? (
            <button className="settings-btn-sm settings-btn-accent" onClick={() => api?.installUpdate?.()}>Restart & Update</button>
          ) : (
            <button className="settings-btn-sm" onClick={() => { setUpdateStatus('checking'); api?.checkForUpdates?.() }} disabled={updateStatus === 'checking' || updateStatus === 'downloading'}>Check</button>
          )}
        </div>
        <div className="settings-row">
          <div className="settings-row-title">Signed in as</div>
          <div className="settings-row-val">{user?.username ?? 'Not signed in'}</div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Onboarding</div>
            <div className="settings-row-desc">Replay the first-launch setup and guided tour</div>
          </div>
          <button className="settings-btn-sm settings-btn-accent" onClick={() => {
            localStorage.removeItem('loom_setup_done')
            localStorage.removeItem('loom_tour_done')
            window.location.reload()
          }}>Replay</button>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Update Walkthrough</div>
            <div className="settings-row-desc">Replay the latest update walkthrough</div>
          </div>
          <button className="settings-btn-sm settings-btn-accent" onClick={() => {
            localStorage.removeItem('loom_last_seen_version')
            window.location.reload()
          }}>Replay</button>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Privacy Policy</div>
            <div className="settings-row-desc">See what data Loom stores and how your privacy is protected</div>
          </div>
          <button className="settings-btn-sm settings-btn-accent" onClick={() => navigate('/privacy')}>View</button>
        </div>
        <div className="settings-row last">
          <div className="settings-row-title">Reset Customization</div>
          <button className="settings-btn-sm" onClick={reset}>Reset All</button>
        </div>
      </div>

      {/* ── Advanced ── */}
      <div className="settings-section">
        <div className="settings-label">Advanced</div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Performance Mod Pack</div>
            <div className="settings-row-desc">Auto-install Sodium, Lithium, and other performance mods on new Fabric instances</div>
          </div>
          <button
            className={`settings-toggle${perfModpack ? ' on' : ''}`}
            onClick={() => togglePerf('perf_modpack', perfModpack, setPerfModpack)}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Optimized JVM Flags</div>
            <div className="settings-row-desc">Use Aikar's G1GC flags and additional optimizations for better FPS</div>
          </div>
          <button
            className={`settings-toggle${perfJvmFlags ? ' on' : ''}`}
            onClick={() => togglePerf('perf_jvm_flags', perfJvmFlags, setPerfJvmFlags)}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">High Process Priority</div>
            <div className="settings-row-desc">Set Minecraft to high CPU priority for better performance</div>
          </div>
          <button
            className={`settings-toggle${perfHighPriority ? ' on' : ''}`}
            onClick={() => togglePerf('perf_high_priority', perfHighPriority, setPerfHighPriority)}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Optimized Game Settings</div>
            <div className="settings-row-desc">Apply performance-optimized video settings on new instances</div>
          </div>
          <button
            className={`settings-toggle${perfGameSettings ? ' on' : ''}`}
            onClick={() => togglePerf('perf_game_settings', perfGameSettings, setPerfGameSettings)}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Windows Defender Exclusion</div>
            <div className="settings-row-desc">Add game folder to Windows Defender exclusions for faster launches (requires admin)</div>
          </div>
          <div className="settings-bg-actions">
            <button className="settings-btn-sm settings-btn-accent" onClick={() => api?.applyDefenderExclusion?.()}>Apply</button>
            <button
              className={`settings-toggle${perfDefenderExclusion ? ' on' : ''}`}
              onClick={() => togglePerf('perf_defender_exclusion', perfDefenderExclusion, setPerfDefenderExclusion)}
            >
              <div className="settings-toggle-dot" />
            </button>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Power Plan Optimization</div>
            <div className="settings-row-desc">Switch to High Performance power plan while Minecraft is running</div>
          </div>
          <button
            className={`settings-toggle${perfPowerPlan ? ' on' : ''}`}
            onClick={() => togglePerf('perf_power_plan', perfPowerPlan, setPerfPowerPlan)}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Network Optimization</div>
            <div className="settings-row-desc">Optimize TCP settings and DNS for lower ping (requires admin, reboot recommended)</div>
          </div>
          <div className="settings-bg-actions">
            <button className="settings-btn-sm settings-btn-accent" onClick={() => api?.applyNetworkOptimization?.()}>Apply</button>
            <button
              className={`settings-toggle${perfNetwork ? ' on' : ''}`}
              onClick={() => togglePerf('perf_network', perfNetwork, setPerfNetwork)}
            >
              <div className="settings-toggle-dot" />
            </button>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-title">Iris Shaders</div>
            <div className="settings-row-desc">Auto-install Iris shader support (2x faster than OptiFine shaders)</div>
          </div>
          <button
            className={`settings-toggle${perfIris ? ' on' : ''}`}
            onClick={() => togglePerf('perf_iris_shaders', perfIris, setPerfIris)}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>

        <div className="settings-row last">
          <div>
            <div className="settings-row-title">Cache & Skip</div>
            <div className="settings-row-desc">Cache baked models and textures to skip recomputation on repeat launches (saves 2-5s)</div>
          </div>
          <button
            className={`settings-toggle${perfCacheAndSkip ? ' on' : ''}`}
            onClick={() => togglePerf('perf_cache_and_skip', perfCacheAndSkip, setPerfCacheAndSkip)}
          >
            <div className="settings-toggle-dot" />
          </button>
        </div>
      </div>

      {/* Spotify Setup Wizard */}
      {showSpotifySetup && (
        <SpotifySetup
          onClose={() => setShowSpotifySetup(false)}
          onConnected={() => {
            setSpotifyConnected(true)
            setShowSpotifySetup(false)
          }}
        />
      )}
    </div>
  )
}
