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
import GameLogsWindow from './components/GameLogsWindow'
import SplashScreen from './components/SplashScreen'
import SetupWizard, { type WizardSettings } from './components/SetupWizard'
import WelcomeWalkthrough, { type WalkthroughSlide } from './components/WelcomeWalkthrough'

/* ── v1.3.0 Walkthrough slides ── */
const CURRENT_VERSION = '1.3.0'

const WALKTHROUGH_SLIDES: WalkthroughSlide[] = [
  {
    emoji: '🎉',
    title: 'Welcome to Loom 1.3.0',
    subtitle: "Here's what's new in this update.",
    gradient: 'linear-gradient(135deg, #2d1b4e 0%, #e0604e 35%, #f4a261 70%, #1a1a2e 100%)',
  },
  {
    emoji: '🔧',
    title: 'Multi-Loader Support',
    bullets: [
      'NeoForge support — install and play NeoForge instances',
      'Quilt loader — full Quilt mod compatibility',
      'Forge stability fixes for older Minecraft versions',
    ],
    gradient: 'linear-gradient(135deg, #0c1b33 0%, #0a4d68 40%, #088395 70%, #0d0d1a 100%)',
  },
  {
    emoji: '📦',
    title: 'Modpack Importing',
    bullets: [
      'Browse and install modpacks directly from Modrinth',
      'Import .mrpack files from your computer',
      'One-click install with automatic dependency resolution',
    ],
    gradient: 'linear-gradient(135deg, #1a0a2e 0%, #5b21b6 35%, #7c3aed 65%, #0d0d1a 100%)',
  },
  {
    emoji: '🚀',
    title: 'Ready to Play',
    subtitle: "That's everything — let's go!",
    gradient: 'linear-gradient(135deg, #052e16 0%, #059669 40%, #34d399 70%, #0d1a0d 100%)',
  },
]

function AppShell() {
  const {
    isAuthenticated,
    incognitoEnabled,
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

  // Profile select on launch — after auth, before main app
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

  // Post-update walkthrough — shown once per version, after profile select
  if (!walkthroughDone) {
    return (
      <WelcomeWalkthrough
        version={CURRENT_VERSION}
        slides={WALKTHROUGH_SLIDES}
        onComplete={handleWalkthroughComplete}
      />
    )
  }

  // Main app — profile screen can be re-opened from sidebar
  return (
    <HashRouter>
      <div className="app-layout" data-incognito={incognitoEnabled ? 'true' : undefined}>
        <Titlebar onOpenLogs={openLogs} />
        <div className="app-body" style={{ position: 'relative', overflow: 'hidden' }}>
          <Sidebar
            onOpenProfiles={() => setShowProfileScreen(true)}
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
    </HashRouter>
  )
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false)

  if (!splashDone) {
    return <SplashScreen onComplete={() => setSplashDone(true)} />
  }

  return (
    <AuthProvider>
      <CustomizationProvider>
        <LoomieProvider>
          <AppShell />
        </LoomieProvider>
      </CustomizationProvider>
    </AuthProvider>
  )
}
