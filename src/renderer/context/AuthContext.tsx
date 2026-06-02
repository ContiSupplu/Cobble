import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

interface User {
  username: string
  uuid: string
  displayName: string
}

interface AccountInfo {
  uuid: string
  username: string
  displayName: string
  privacyRegion?: string
  privacyEnabled?: boolean
}

interface AuthContextType {
  user: User | null
  accounts: AccountInfo[]
  activeUuid: string | null
  isAuthenticated: boolean
  privacyEnabled: boolean
  privacyRegion: string
  login: (user: User) => void
  logout: () => void
  switchAccount: (uuid: string) => Promise<void>
  addAccount: () => Promise<void>
  removeAccount: (uuid: string) => void
  updateDisplayName: (uuid: string, name: string) => void
  setPrivacyEnabled: (enabled: boolean) => void
  setPrivacyRegion: (region: string) => void
  refreshAccounts: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  accounts: [],
  activeUuid: null,
  isAuthenticated: false,
  privacyEnabled: false,
  privacyRegion: 'us-east',
  login: () => {},
  logout: () => {},
  switchAccount: async () => {},
  addAccount: async () => {},
  removeAccount: () => {},
  updateDisplayName: () => {},
  setPrivacyEnabled: () => {},
  setPrivacyRegion: () => {},
  refreshAccounts: async () => {},
})

const api = (window as any).electronAPI

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('auth_user')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [activeUuid, setActiveUuid] = useState<string | null>(null)

  // Derive privacy mode state from active account
  const activeAccount = accounts.find(a => a.uuid === activeUuid)
  const privacyEnabled = activeAccount?.privacyEnabled || false
  const privacyRegion = activeAccount?.privacyRegion || 'us-east'

  // Load accounts from main process
  const refreshAccounts = useCallback(async () => {
    if (!api) return
    try {
      const accts = await api.getAccounts()
      setAccounts(accts || [])
      const uuid = await api.getActiveUuid()
      setActiveUuid(uuid)
    } catch (err) {
      console.error('Failed to load accounts:', err)
    }
  }, [])

  // Initial load
  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  useEffect(() => {
    if (user) {
      localStorage.setItem('auth_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('auth_user')
    }
  }, [user])

  const login = useCallback((u: User) => {
    setUser(u)
    setActiveUuid(u.uuid)
    refreshAccounts()
  }, [refreshAccounts])

  const logout = useCallback(() => {
    setUser(null)
    setAccounts([])
    setActiveUuid(null)
    api?.logout()
  }, [])

  const switchAccount = useCallback(async (uuid: string) => {
    if (!api) return
    const result = await api.switchAccount(uuid)
    if (result) {
      setUser({ username: result.username, uuid: result.uuid, displayName: result.displayName })
      setActiveUuid(uuid)
      await refreshAccounts()
    }
  }, [refreshAccounts])

  const addAccount = useCallback(async () => {
    if (!api) return
    const result = await api.login()
    if (result && !result.error) {
      setUser({ username: result.username, uuid: result.uuid, displayName: result.displayName || result.username })
      await refreshAccounts()
    }
  }, [refreshAccounts])

  const removeAccount = useCallback((uuid: string) => {
    if (!api) return
    api.removeAccount(uuid)
    setAccounts(prev => prev.filter(a => a.uuid !== uuid))
    if (activeUuid === uuid) {
      const remaining = accounts.filter(a => a.uuid !== uuid)
      if (remaining.length > 0) {
        switchAccount(remaining[0].uuid)
      } else {
        setUser(null)
        setActiveUuid(null)
      }
    }
  }, [activeUuid, accounts, switchAccount])

  const updateDisplayName = useCallback((uuid: string, name: string) => {
    if (!api) return
    api.updateDisplayName(uuid, name)
    setAccounts(prev => prev.map(a => a.uuid === uuid ? { ...a, displayName: name } : a))
    if (user && user.uuid === uuid) {
      setUser(prev => prev ? { ...prev, displayName: name } : null)
    }
  }, [user])

  const setPrivacyEnabled = useCallback((enabled: boolean) => {
    if (!api || !activeUuid) return
    api.updatePrivacyPrefs(activeUuid, undefined, enabled)
    setAccounts(prev => prev.map(a => a.uuid === activeUuid ? { ...a, privacyEnabled: enabled } : a))
  }, [activeUuid])

  const setPrivacyRegion = useCallback((region: string) => {
    if (!api || !activeUuid) return
    api.updatePrivacyPrefs(activeUuid, region, undefined)
    setAccounts(prev => prev.map(a => a.uuid === activeUuid ? { ...a, privacyRegion: region } : a))
  }, [activeUuid])

  return (
    <AuthContext.Provider value={{
      user,
      accounts,
      activeUuid,
      isAuthenticated: !!user,
      privacyEnabled,
      privacyRegion,
      login,
      logout,
      switchAccount,
      addAccount,
      removeAccount,
      updateDisplayName,
      setPrivacyEnabled,
      setPrivacyRegion,
      refreshAccounts,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
