import { useState, useEffect, useCallback } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/globals.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CustomizationProvider } from './context/CustomizationContext'
import { LoomieProvider } from './context/LoomieContext'
import Titlebar from './components/Titlebar'
import Sidebar from './components/Sidebar'
import ProfileScreen from './components/ProfileScreen'
import LoginPage from './pages/LoginPage'
import LibraryPage from './pages/LibraryPage'
import ModsPage from './pages/ModsPage'
import PlayerLookupPage from './pages/PlayerLookupPage'
import SettingsPage from './pages/SettingsPage'
import AccountPage from './pages/AccountPage'
import GeminiPage from './pages/GeminiPage'
import ChangingRoomPage from './pages/ChangingRoomPage'
import BedrockPage from './pages/BedrockPage'
import GalleryPage from './pages/GalleryPage'
import QuickServersPage from './pages/QuickServersPage'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'
import GameLogsWindow from './components/GameLogsWindow'
import SplashScreen from './components/SplashScreen'
import SetupWizard, { type WizardSettings } from './components/SetupWizard'
import WelcomeWalkthrough, { type WalkthroughSlide } from './components/WelcomeWalkthrough'
import P2PPanel from './components/P2PPanel'

/* ── Versioning — codenames + simplified display ── */
const CURRENT_VERSION = '1.6.0'

// Minecraft-themed codenames for each minor release
const VERSION_CODENAMES: Record<string, string> = {
  '1.0': 'Cobblestone',
  '1.1': 'Iron',
  '1.2': 'Gold',
  '1.3': 'Redstone',
  '1.4': 'Diamond',
  '1.5': 'Obsidian',
  '1.6': 'Netherite',
  // Future: 'Amethyst', 'Beacon', 'Ender'
}

// "1.3.0" → "1.3", "1.3.1" → "1.3.1"
function displayVersion(v: string): string {
  return v.endsWith('.0') ? v.slice(0, -2) : v
}

function getCodename(v: string): string | undefined {
  const minor = v.split('.').slice(0, 2).join('.')
  return VERSION_CODENAMES[minor]
}

const DISPLAY_VER = displayVersion(CURRENT_VERSION)
const CODENAME = getCodename(CURRENT_VERSION)

const WALKTHROUGH_SLIDES: WalkthroughSlide[] = [
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z"/></svg>,
    title: `Loom ${DISPLAY_VER} \u2014 "${CODENAME}"`,
    subtitle: 'Forged in the Nether. Built for speed.',
    gradient: 'linear-gradient(135deg, #0c0c1a 0%, #4a1520 20%, #b91c1c 50%, #f97316 75%, #0c0c1a 100%)',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M8 12h8M12 8v8"/></svg>,
    title: 'Quick Servers',
    subtitle: 'Your own Minecraft server is coming to Loom.',
    bullets: [
      'One-click server hosting, managed entirely from the launcher',
      'Full file manager, plugin browser, and player controls',
      'Bedrock crossplay support built in',
    ],
    gradient: 'linear-gradient(135deg, #020617 0%, #1e3a5f 30%, #3b82f6 55%, #06b6d4 80%, #020617 100%)',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
    title: 'Cache & Skip',
    bullets: [
      'Caches baked models and textures after your first launch',
      'Repeat launches load from cache instead of recomputing',
      'Toggle on or off in Settings under Advanced',
    ],
    gradient: 'linear-gradient(135deg, #0c0c1a 0%, #064e3b 30%, #10b981 55%, #059669 75%, #0c0c1a 100%)',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
    title: 'Under the Hood',
    bullets: [
      'New Advanced settings section with granular performance controls',
      'Improved mod auto-installer for Fabric instances',
      'Stability improvements and bug fixes across the board',
    ],
    gradient: 'linear-gradient(135deg, #1a0a2e 0%, #7c3aed 35%, #a855f7 60%, #0d0d1a 100%)',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    title: 'Stronger Than Diamond.',
    subtitle: 'Loom Netherite. The toughest update yet.',
    gradient: 'linear-gradient(135deg, #0c0c0c 0%, #78350f 25%, #d97706 50%, #b91c1c 75%, #0c0c0c 100%)',
  },
]

function AppShell({ quickLaunched = false }: { quickLaunched?: boolean }) {
  const {
    isAuthenticated,
    privacyEnabled,
    user,
    accounts,
    activeUuid,
    switchAccount,
    addAccount,
    removeAccount,
    updateDisplayName,
  } = useAuth()

  const [logsOpen, setLogsOpen] = useState(false)

  // First-launch wizard
  const [setupDone, setSetupDone] = useState(() => localStorage.getItem('loom_setup_done') === 'true')

  // Profile screen — shown on every launch after auth
  const [profileDone, setProfileDone] = useState(false)

  // Post-update walkthrough
  const [walkthroughDone, setWalkthroughDone] = useState(() => {
    const seen = localStorage.getItem('loom_last_seen_version')
    return seen === CURRENT_VERSION
  })

  const handleWalkthroughComplete = useCallback(() => {
    localStorage.setItem('loom_last_seen_version', CURRENT_VERSION)
    setWalkthroughDone(true)
  }, [])
  const [showProfileScreen, setShowProfileScreen] = useState(false)
  const [showP2P, setShowP2P] = useState(false)

  // Always start on the home screen when app launches
  useEffect(() => {
    if (isAuthenticated) window.location.hash = '#/'
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openLogs = useCallback(() => setLogsOpen(true), [])
  const closeLogs = useCallback(() => setLogsOpen(false), [])

  const handleWizardComplete = useCallback((settings: WizardSettings) => {
    localStorage.setItem('loom_setup_done', 'true')
    // Apply settings via electron API if available
    const api = (window as any).electronAPI
    if (api?.applyWizardSettings) {
      api.applyWizardSettings(settings)
    }
    // Also save to localStorage as fallback
    localStorage.setItem('loom_ram', String(settings.ram))
    localStorage.setItem('loom_dynamic_island', String(settings.dynamicIsland))
    localStorage.setItem('loom_close_on_launch', String(settings.closeOnLaunch))
    localStorage.setItem('loom_discord_rpc', String(settings.discordRPC))
    setSetupDone(true)
  }, [])

  // ── Quick Launch mode ──
  // Triggered from the splash screen's Quick Launch button
  const [quickLaunchAttempted, setQuickLaunchAttempted] = useState(false)

  useEffect(() => {
    if (quickLaunched && isAuthenticated && setupDone && !quickLaunchAttempted) {
      setQuickLaunchAttempted(true)
      // Skip profile screen — use last active account
      setProfileDone(true)
      // Only skip walkthrough if it was already seen
      const alreadySeen = localStorage.getItem('loom_last_seen_version') === CURRENT_VERSION
      if (alreadySeen) {
        setWalkthroughDone(true)
      }

      // Auto-launch: try last played, then favorite, then first instance
      const api = (window as any).electronAPI
      const lastInstance = localStorage.getItem('loom_last_played_instance')

      const tryLaunch = async () => {
        if (!api?.launch) {
          console.log('[QuickLaunch] launch API not available')
          return
        }

        // Try last played instance first
        if (lastInstance) {
          console.log('[QuickLaunch] Launching last played instance:', lastInstance)
          try {
            await api.launch(lastInstance)
            return
          } catch (e: any) {
            console.log('[QuickLaunch] Last played launch failed:', e.message)
          }
        }

        // Fallback: try favorite or first instance
        try {
          const instances = await api.getInstances?.()
          if (instances && instances.length > 0) {
            const favorite = instances.find((i: any) => i.favorite)
            const target = favorite || instances[0]
            console.log('[QuickLaunch] Fallback launching:', target.name)
            localStorage.setItem('loom_last_played_instance', target.id)
            await api.launch(target.id)
          } else {
            console.log('[QuickLaunch] No instances to launch')
          }
        } catch (e: any) {
          console.log('[QuickLaunch] Fallback launch failed:', e.message)
        }
      }

      setTimeout(tryLaunch, 500)
    }
  }, [quickLaunched, isAuthenticated, setupDone, quickLaunchAttempted])

  // Login page — not authenticated yet
  if (!isAuthenticated) {
    return (
      <div>
        <LoginPage />
      </div>
    )
  }

  // First-launch setup wizard
  if (!setupDone) {
    return <SetupWizard onComplete={handleWizardComplete} />
  }

  // Profile select on launch — after auth, before main app (skipped in Quick Launch)
  if (!profileDone) {
    return (
      <div>
        <ProfileScreen
          accounts={accounts.map(a => ({ uuid: a.uuid, username: a.username, displayName: a.displayName }))}
          activeUuid={activeUuid}
          onSelect={(uuid) => {
            switchAccount(uuid)
            setProfileDone(true)
          }}
          onAddAccount={addAccount}
          onRemoveAccount={removeAccount}
          onEditDisplayName={updateDisplayName}
          onClose={() => setProfileDone(true)}
        />
      </div>
    )
  }

  // Post-update walkthrough — shown once per version, after profile select (skipped in Quick Launch)
  if (!walkthroughDone) {
    return (
      <WelcomeWalkthrough
        version={DISPLAY_VER}
        slides={WALKTHROUGH_SLIDES}
        onComplete={handleWalkthroughComplete}
      />
    )
  }

  // Main app — profile screen can be re-opened from sidebar
  return (
    <HashRouter>
      <div className="app-layout" data-privacy={privacyEnabled ? 'true' : undefined}>
        <Titlebar onOpenLogs={openLogs} />
        <div className="app-body" style={{ position: 'relative', overflow: 'hidden' }}>
          <Sidebar
            onOpenProfiles={() => setShowProfileScreen(true)}
            onOpenP2P={() => setShowP2P(true)}
          />
          <main className="app-content">
            <Routes>
              <Route path="/" element={<LibraryPage />} />
              <Route path="/browse" element={<ModsPage />} />
              <Route path="/players" element={<PlayerLookupPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/gemini" element={<GeminiPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/changing-room" element={<ChangingRoomPage />} />
              <Route path="/bedrock" element={<BedrockPage />} />
              <Route path="/gallery" element={<GalleryPage />} />
              <Route path="/servers" element={<QuickServersPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <GameLogsWindow externalOpen={logsOpen} onClose={closeLogs} />
        </div>
      </div>

      {/* Profile screen overlay — re-openable from sidebar */}
      {showProfileScreen && (
        <ProfileScreen
          accounts={accounts.map(a => ({ uuid: a.uuid, username: a.username, displayName: a.displayName }))}
          activeUuid={activeUuid}
          onSelect={(uuid) => {
            switchAccount(uuid)
            setShowProfileScreen(false)
          }}
          onAddAccount={addAccount}
          onRemoveAccount={removeAccount}
          onEditDisplayName={updateDisplayName}
          onClose={() => setShowProfileScreen(false)}
        />
      )}

      {/* P2P Multiplayer overlay */}
      {showP2P && (
        <P2PPanel onClose={() => setShowP2P(false)} />
      )}
    </HashRouter>
  )
}

export default function App() {
  const quickLaunchEnabled = localStorage.getItem('loom_quick_launch') === 'true'
  const [splashDone, setSplashDone] = useState(false) // Splash always plays
  const [quickLaunched, setQuickLaunched] = useState(false)

  const handleQuickLaunch = useCallback(() => {
    setQuickLaunched(true)
    setSplashDone(true)
    // The actual instance launch happens in AppShell via quickLaunched prop
  }, [])

  if (!splashDone) {
    return (
      <SplashScreen
        onComplete={() => setSplashDone(true)}
        quickLaunchEnabled={quickLaunchEnabled}
        onQuickLaunch={handleQuickLaunch}
      />
    )
  }

  return (
    <AuthProvider>
      <CustomizationProvider>
        <LoomieProvider>
          <AppShell quickLaunched={quickLaunched} />
        </LoomieProvider>
      </CustomizationProvider>
    </AuthProvider>
  )
}
