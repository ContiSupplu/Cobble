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
import GameLogsWindow from './components/GameLogsWindow'
import SplashScreen from './components/SplashScreen'
import SetupWizard, { type WizardSettings } from './components/SetupWizard'
import WelcomeWalkthrough, { type WalkthroughSlide } from './components/WelcomeWalkthrough'

/* ── Versioning — codenames + simplified display ── */
const CURRENT_VERSION = '1.5.0'

// Minecraft-themed codenames for each minor release
const VERSION_CODENAMES: Record<string, string> = {
  '1.0': 'Cobblestone',
  '1.1': 'Iron',
  '1.2': 'Gold',
  '1.3': 'Redstone',
  '1.4': 'Diamond',
  '1.5': 'Obsidian',
  // Future: 'Netherite', 'Amethyst', 'Beacon', 'Ender'
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
    title: `Loom ${DISPLAY_VER} — "${CODENAME}"`,
    subtitle: 'The biggest update yet. A whole new edition joins the family.',
    gradient: 'linear-gradient(135deg, #0c0c1a 0%, #1a0533 20%, #7c3aed 50%, #c026d3 75%, #0c0c1a 100%)',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
    title: 'Bedrock Edition',
    subtitle: 'Introducing Bedrock support — a new member of the Loom family.',
    bullets: [
      'Detect, launch, and manage Minecraft Bedrock from Loom',
      'Browse your worlds, resource packs, and behavior packs',
      'Dedicated sidebar tab — Bedrock gets its own home',
    ],
    gradient: 'linear-gradient(135deg, #020617 0%, #064e3b 30%, #10b981 55%, #059669 75%, #020617 100%)',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    title: 'Built-In Add-On Browser',
    bullets: [
      'Browse MCPEDL, CurseForge, ModBay, and Planet Minecraft right inside Loom',
      'Download add-ons with one click — auto-installed into Bedrock',
      'Fullscreen mode for a seamless browsing experience',
    ],
    gradient: 'linear-gradient(135deg, #0c0c1a 0%, #1e3a5f 30%, #3b82f6 55%, #6366f1 80%, #0c0c1a 100%)',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    title: 'Smart Downloads',
    bullets: [
      '.mcaddon, .mcpack, and .mcworld files downloaded automatically',
      'No save dialogs — Loom handles everything behind the scenes',
      'Addons are sent to Minecraft\'s importer instantly',
    ],
    gradient: 'linear-gradient(135deg, #1a0a2e 0%, #7c3aed 35%, #a855f7 60%, #0d0d1a 100%)',
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
    title: 'Two Editions. One Launcher.',
    subtitle: 'Java and Bedrock, together at last. Welcome to the new Loom.',
    gradient: 'linear-gradient(135deg, #0c0c0c 0%, #b45309 25%, #f59e0b 50%, #10b981 75%, #0c0c0c 100%)',
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
        version={DISPLAY_VER}
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
              <Route path="/bedrock" element={<BedrockPage />} />
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
