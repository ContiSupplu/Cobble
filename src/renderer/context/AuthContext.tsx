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
  incognitoRegion?: string
  incognitoEnabled?: boolean
}

interface AuthContextType {
  user: User | null
  accounts: AccountInfo[]
  activeUuid: string | null
  isAuthenticated: boolean
  incognitoEnabled: boolean
  incognitoRegion: string
  login: (user: User) => void
  logout: () => void
  switchAccount: (uuid: string) => Promise<void>
  addAccount: () => Promise<void>
  removeAccount: (uuid: string) => void
  updateDisplayName: (uuid: string, name: string) => void
  setIncognitoEnabled: (enabled: boolean) => void
  setIncognitoRegion: (region: string) => void
  refreshAccounts: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  accounts: [],
  activeUuid: null,
  isAuthenticated: false,
  incognitoEnabled: false,
  incognitoRegion: 'us-east',
  login: () => {},
  logout: () => {},
  switchAccount: async () => {},
  addAccount: async () => {},
  removeAccount: () => {},
  updateDisplayName: () => {},
  setIncognitoEnabled: () => {},
  setIncognitoRegion: () => {},
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

  // Derive incognito state from active account
  const activeAccount = accounts.find(a => a.uuid === activeUuid)
  const incognitoEnabled = activeAccount?.incognitoEnabled || false
  const incognitoRegion = activeAccount?.incognitoRegion || 'us-east'

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

  const setIncognitoEnabled = useCallback((enabled: boolean) => {
    if (!api || !activeUuid) return
    api.updateIncognitoPrefs(activeUuid, undefined, enabled)
    setAccounts(prev => prev.map(a => a.uuid === activeUuid ? { ...a, incognitoEnabled: enabled } : a))
  }, [activeUuid])

  const setIncognitoRegion = useCallback((region: string) => {
    if (!api || !activeUuid) return
    api.updateIncognitoPrefs(activeUuid, region, undefined)
    setAccounts(prev => prev.map(a => a.uuid === activeUuid ? { ...a, incognitoRegion: region } : a))
  }, [activeUuid])

  return (
    <AuthContext.Provider value={{
      user,
      accounts,
      activeUuid,
      isAuthenticated: !!user,
      incognitoEnabled,
      incognitoRegion,
      login,
      logout,
      switchAccount,
      addAccount,
      removeAccount,
      updateDisplayName,
      setIncognitoEnabled,
      setIncognitoRegion,
      refreshAccounts,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
