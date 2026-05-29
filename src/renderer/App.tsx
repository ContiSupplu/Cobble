import { useState, useEffect, useCallback } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/globals.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CustomizationProvider } from './context/CustomizationContext'
import { PebbleProvider } from './context/PebbleContext'
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
  const [setupDone, setSetupDone] = useState(() => localStorage.getItem('cobble_setup_done') === 'true')

  // Profile screen — shown on every launch after auth
  const [profileDone, setProfileDone] = useState(false)
  const [showProfileScreen, setShowProfileScreen] = useState(false)

  // Always start on the home screen when app launches
  useEffect(() => {
    if (isAuthenticated) window.location.hash = '#/'
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openLogs = useCallback(() => setLogsOpen(true), [])
  const closeLogs = useCallback(() => setLogsOpen(false), [])

  const handleWizardComplete = useCallback((settings: WizardSettings) => {
    localStorage.setItem('cobble_setup_done', 'true')
    // Apply settings via electron API if available
    const api = (window as any).electronAPI
    if (api?.applyWizardSettings) {
      api.applyWizardSettings(settings)
    }
    // Also save to localStorage as fallback
    localStorage.setItem('cobble_ram', String(settings.ram))
    localStorage.setItem('cobble_dynamic_island', String(settings.dynamicIsland))
    localStorage.setItem('cobble_close_on_launch', String(settings.closeOnLaunch))
    localStorage.setItem('cobble_discord_rpc', String(settings.discordRPC))
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
        <PebbleProvider>
          <AppShell />
        </PebbleProvider>
      </CustomizationProvider>
    </AuthProvider>
  )
}
