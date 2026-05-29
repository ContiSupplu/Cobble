import { BrowserWindow, net, app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'

// ============================================================
// Microsoft Authentication for Minecraft — Multi-Account
// Flow: MS OAuth -> Xbox Live -> XSTS -> Minecraft
// ============================================================

const MS_CLIENT_ID = '00000000402b5328'
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf'

export interface MinecraftAccount {
  username: string
  uuid: string
  displayName: string        // customizable, defaults to username
  accessToken: string
  msRefreshToken?: string
  expiresAt: number
  incognitoRegion?: string   // per-profile incognito preference
  incognitoEnabled?: boolean // per-profile incognito toggle
}

interface AccountStore {
  accounts: MinecraftAccount[]
  activeUuid: string | null
}

let accountStore: AccountStore = { accounts: [], activeUuid: null }

// ============================================================
// Persistence — save/load accounts to disk with encryption
// ============================================================

function getAuthPath(): string {
  const dir = join(app.getPath('userData'), 'auth')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'accounts.json')
}

function encryptToken(token: string): string {
  if (!token) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(token).toString('base64')
    }
  } catch { /* fallback to plain */ }
  return token
}

function decryptToken(encrypted: string): string {
  if (!encrypted) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    }
  } catch { /* fallback — might be plain text from before encryption was available */ }
  return encrypted
}

function saveStoreToDisk(): void {
  try {
    // Encrypt sensitive tokens before saving
    const serialized: AccountStore = {
      activeUuid: accountStore.activeUuid,
      accounts: accountStore.accounts.map(a => ({
        ...a,
        accessToken: encryptToken(a.accessToken),
        msRefreshToken: a.msRefreshToken ? encryptToken(a.msRefreshToken) : undefined,
      })),
    }
    writeFileSync(getAuthPath(), JSON.stringify(serialized, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Auth] Failed to save accounts:', err)
  }
}

function loadStoreFromDisk(): AccountStore {
  try {
    const path = getAuthPath()
    if (!existsSync(path)) return { accounts: [], activeUuid: null }
    const raw = JSON.parse(readFileSync(path, 'utf-8'))

    // Migrate from old single-account format
    if (raw.accessToken && raw.username) {
      console.log('[Auth] Migrating from single-account format')
      const account: MinecraftAccount = {
        username: raw.username,
        uuid: raw.uuid,
        displayName: raw.displayName || raw.username,
        accessToken: raw.accessToken,
        msRefreshToken: raw.msRefreshToken,
        expiresAt: raw.expiresAt || 0,
      }
      return { accounts: [account], activeUuid: account.uuid }
    }

    // Decrypt tokens
    if (raw.accounts && Array.isArray(raw.accounts)) {
      return {
        activeUuid: raw.activeUuid || null,
        accounts: raw.accounts.map((a: any) => ({
          ...a,
          displayName: a.displayName || a.username,
          accessToken: decryptToken(a.accessToken || ''),
          msRefreshToken: a.msRefreshToken ? decryptToken(a.msRefreshToken) : undefined,
        })),
      }
    }
  } catch (err) {
    console.error('[Auth] Failed to load accounts:', err)
  }
  return { accounts: [], activeUuid: null }
}

function clearStorFromDisk(): void {
  try {
    const path = getAuthPath()
    if (existsSync(path)) unlinkSync(path)
    // Also remove old single-account file if it exists
    const oldPath = join(app.getPath('userData'), 'auth', 'account.json')
    if (existsSync(oldPath)) unlinkSync(oldPath)
  } catch (err) {
    console.error('[Auth] Failed to clear accounts:', err)
  }
}

// ============================================================
// Step 1: Microsoft OAuth via Electron BrowserWindow
// ============================================================

async function getMicrosoftToken(parentWindow: BrowserWindow | null): Promise<{ accessToken: string; refreshToken: string }> {
  return new Promise((resolve, reject) => {
    const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${MS_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=XboxLive.signin%20XboxLive.offline_access&prompt=select_account`

    const authWindow = new BrowserWindow({
      width: 520,
      height: 680,
      parent: parentWindow || undefined,
      modal: !!parentWindow,
      show: false,
      title: 'Sign in with Microsoft',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    authWindow.setMenuBarVisibility(false)

    let resolved = false

    const handleCode = async (code: string) => {
      if (resolved) return
      resolved = true
      try {
        const tokens = await exchangeCodeForToken(code)
        if (!authWindow.isDestroyed()) authWindow.destroy()
        resolve(tokens)
      } catch (err) {
        if (!authWindow.isDestroyed()) authWindow.destroy()
        reject(err)
      }
    }

    const handleError = (error: string) => {
      if (resolved) return
      resolved = true
      if (!authWindow.isDestroyed()) authWindow.destroy()
      reject(new Error(`Microsoft login error: ${error}`))
    }

    const checkUrl = (url: string) => {
      if (!url.startsWith(REDIRECT_URI)) return false
      try {
        const urlObj = new URL(url)
        const code = urlObj.searchParams.get('code')
        const error = urlObj.searchParams.get('error')
        if (error) {
          handleError(error)
          return true
        }
        if (code) {
          handleCode(code)
          return true
        }
      } catch {
        // malformed URL, ignore
      }
      return false
    }

    authWindow.webContents.on('will-redirect', (_event, url) => {
      checkUrl(url)
    })

    authWindow.webContents.on('will-navigate', (_event, url) => {
      checkUrl(url)
    })

    authWindow.webContents.on('did-navigate', (_event, url) => {
      checkUrl(url)
    })

    authWindow.on('closed', () => {
      if (!resolved) {
        resolved = true
        reject(new Error('Login window was closed'))
      }
    })

    authWindow.loadURL(authUrl)
    authWindow.once('ready-to-show', () => {
      if (!resolved) authWindow.show()
    })
  })
}

async function exchangeCodeForToken(code: string): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    scope: 'XboxLive.signin XboxLive.offline_access',
  })

  const response = await net.fetch('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${text}`)
  }

  const data = await response.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
  }
}

// ============================================================
// Refresh token flow — silently re-authenticate without UI
// ============================================================

async function refreshMicrosoftToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    redirect_uri: REDIRECT_URI,
    scope: 'XboxLive.signin XboxLive.offline_access',
  })

  const response = await net.fetch('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
  }
}

// ============================================================
// Step 2–5: Xbox Live -> XSTS -> Minecraft -> Profile
// ============================================================

async function authenticateXboxLive(msAccessToken: string): Promise<{ token: string; uhs: string }> {
  const response = await net.fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  })

  if (!response.ok) throw new Error(`Xbox Live auth failed: ${response.status}`)

  const data = await response.json()
  return {
    token: data.Token,
    uhs: data.DisplayClaims.xui[0].uhs,
  }
}

async function getXSTSToken(xblToken: string): Promise<{ token: string; uhs: string }> {
  const response = await net.fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xblToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const xerr = (data as any).XErr
    if (xerr === 2148916233) throw new Error('This Microsoft account does not have an Xbox account. Please create one.')
    if (xerr === 2148916238) throw new Error('This account belongs to someone under 18. An adult must add them to a Microsoft family.')
    throw new Error(`XSTS auth failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    token: data.Token,
    uhs: data.DisplayClaims.xui[0].uhs,
  }
}

async function loginMinecraft(uhs: string, xstsToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await net.fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
    }),
  })

  if (!response.ok) throw new Error(`Minecraft auth failed: ${response.status}`)

  const data = await response.json()
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  }
}

async function getMinecraftProfile(accessToken: string): Promise<{ name: string; id: string }> {
  const response = await net.fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    if (response.status === 404) throw new Error('This Microsoft account does not own Minecraft.')
    throw new Error(`Failed to get Minecraft profile: ${response.status}`)
  }

  const data = await response.json()
  return { name: data.name, id: data.id }
}

// ============================================================
// Full auth chain (from MS token to MC account)
// ============================================================

async function fullAuthChain(msAccessToken: string, msRefreshToken: string): Promise<MinecraftAccount> {
  const xbl = await authenticateXboxLive(msAccessToken)
  const xsts = await getXSTSToken(xbl.token)
  const mc = await loginMinecraft(xsts.uhs, xsts.token)
  const profile = await getMinecraftProfile(mc.accessToken)

  const account: MinecraftAccount = {
    username: profile.name,
    uuid: profile.id,
    displayName: profile.name,
    accessToken: mc.accessToken,
    msRefreshToken: msRefreshToken,
    expiresAt: Date.now() + mc.expiresIn * 1000,
  }

  return account
}

// ============================================================
// Public API — Multi-Account
// ============================================================

/**
 * Full interactive login — opens MS login window.
 * ADDS the account to the store (doesn't replace existing).
 */
export async function microsoftLogin(parentWindow: BrowserWindow | null): Promise<MinecraftAccount> {
  const msTokens = await getMicrosoftToken(parentWindow)
  const account = await fullAuthChain(msTokens.accessToken, msTokens.refreshToken)

  // Check if this account already exists (same UUID = update it)
  const idx = accountStore.accounts.findIndex(a => a.uuid === account.uuid)
  if (idx >= 0) {
    // Preserve custom display name and incognito prefs
    account.displayName = accountStore.accounts[idx].displayName
    account.incognitoRegion = accountStore.accounts[idx].incognitoRegion
    account.incognitoEnabled = accountStore.accounts[idx].incognitoEnabled
    accountStore.accounts[idx] = account
  } else {
    accountStore.accounts.push(account)
  }

  // Set as active
  accountStore.activeUuid = account.uuid
  saveStoreToDisk()
  return account
}

/**
 * Try to restore session from disk on app startup.
 * Refreshes the ACTIVE account's token if expired.
 */
export async function restoreSession(): Promise<MinecraftAccount | null> {
  accountStore = loadStoreFromDisk()

  if (accountStore.accounts.length === 0) return null

  // Find active account
  let active = accountStore.accounts.find(a => a.uuid === accountStore.activeUuid)
  if (!active) {
    active = accountStore.accounts[0]
    accountStore.activeUuid = active.uuid
  }

  // If token is still valid (with 5 min buffer), use it
  if (active.expiresAt > Date.now() + 5 * 60 * 1000) {
    console.log(`[Auth] Session restored — ${active.username} (token valid)`)
    saveStoreToDisk()
    return active
  }

  // Token expired — try to refresh
  if (active.msRefreshToken) {
    try {
      console.log(`[Auth] Token expired for ${active.username}, refreshing...`)
      const newMs = await refreshMicrosoftToken(active.msRefreshToken)
      const refreshed = await fullAuthChain(newMs.accessToken, newMs.refreshToken)
      // Preserve custom fields
      refreshed.displayName = active.displayName
      refreshed.incognitoRegion = active.incognitoRegion
      refreshed.incognitoEnabled = active.incognitoEnabled
      // Update in store
      const idx = accountStore.accounts.findIndex(a => a.uuid === active!.uuid)
      if (idx >= 0) accountStore.accounts[idx] = refreshed
      saveStoreToDisk()
      console.log(`[Auth] Token refreshed for ${refreshed.username}`)
      return refreshed
    } catch (err) {
      console.error(`[Auth] Refresh failed for ${active.username}:`, err)
      // Don't remove the account — just mark it as needing re-login
      return null
    }
  }

  console.log(`[Auth] No refresh token for ${active.username}, re-login needed`)
  return null
}

/**
 * Get the currently active account
 */
export function getCachedAccount(): MinecraftAccount | null {
  if (accountStore.accounts.length === 0) return null
  return accountStore.accounts.find(a => a.uuid === accountStore.activeUuid) || accountStore.accounts[0]
}

/**
 * Get all saved accounts
 */
export function getAllAccounts(): Array<{ uuid: string; username: string; displayName: string; incognitoRegion?: string; incognitoEnabled?: boolean }> {
  return accountStore.accounts.map(a => ({
    uuid: a.uuid,
    username: a.username,
    displayName: a.displayName,
    incognitoRegion: a.incognitoRegion,
    incognitoEnabled: a.incognitoEnabled,
  }))
}

/**
 * Get the active UUID
 */
export function getActiveUuid(): string | null {
  return accountStore.activeUuid
}

/**
 * Switch active account by UUID (no re-login needed)
 */
export async function switchAccount(uuid: string): Promise<MinecraftAccount | null> {
  const account = accountStore.accounts.find(a => a.uuid === uuid)
  if (!account) return null

  accountStore.activeUuid = uuid

  // Refresh token if expired
  if (account.expiresAt < Date.now() + 5 * 60 * 1000 && account.msRefreshToken) {
    try {
      const newMs = await refreshMicrosoftToken(account.msRefreshToken)
      const refreshed = await fullAuthChain(newMs.accessToken, newMs.refreshToken)
      refreshed.displayName = account.displayName
      refreshed.incognitoRegion = account.incognitoRegion
      refreshed.incognitoEnabled = account.incognitoEnabled
      const idx = accountStore.accounts.findIndex(a => a.uuid === uuid)
      if (idx >= 0) accountStore.accounts[idx] = refreshed
      saveStoreToDisk()
      return refreshed
    } catch {
      // Token refresh failed, but still switch — user can re-login later
      saveStoreToDisk()
      return account
    }
  }

  saveStoreToDisk()
  return account
}

/**
 * Remove a specific account by UUID
 */
export function removeAccount(uuid: string): void {
  accountStore.accounts = accountStore.accounts.filter(a => a.uuid !== uuid)
  if (accountStore.activeUuid === uuid) {
    accountStore.activeUuid = accountStore.accounts[0]?.uuid || null
  }
  saveStoreToDisk()
}

/**
 * Update display name for an account
 */
export function updateDisplayName(uuid: string, displayName: string): void {
  const account = accountStore.accounts.find(a => a.uuid === uuid)
  if (account) {
    account.displayName = displayName
    saveStoreToDisk()
  }
}

/**
 * Update incognito preferences for an account
 */
export function updateIncognitoPrefs(uuid: string, region?: string, enabled?: boolean): void {
  const account = accountStore.accounts.find(a => a.uuid === uuid)
  if (account) {
    if (region !== undefined) account.incognitoRegion = region
    if (enabled !== undefined) account.incognitoEnabled = enabled
    saveStoreToDisk()
  }
}

/**
 * Clear ALL accounts — full logout
 */
export function clearCachedAccount(): void {
  accountStore = { accounts: [], activeUuid: null }
  clearStorFromDisk()
}

// Legacy alias
export function clearAllAccounts(): void {
  clearCachedAccount()
}
