// ============================================================
// Proxy Configuration — SOCKS5 regions for Privacy Mode
// ============================================================
// SECURITY: Credentials are loaded from encrypted storage at runtime.
// Never hardcode proxy credentials in source code.

import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface ProxyRegion {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  available: boolean
}

// Proxy server endpoints — credentials loaded from encrypted storage
export const PROXY_REGIONS: ProxyRegion[] = [
  { id: 'us-east',   name: 'US East',        host: '149.28.39.243',  port: 1080, username: '', password: '', available: true },
  { id: 'us-west',   name: 'US West',        host: '66.42.104.127',  port: 1080, username: '', password: '', available: true },
  { id: 'uk',        name: 'United Kingdom',  host: '78.141.201.20',  port: 1080, username: '', password: '', available: true },
  { id: 'australia', name: 'Australia',       host: '45.32.189.89',   port: 1080, username: '', password: '', available: true },
]

function getCredsPath(): string {
  const dir = join(app.getPath('userData'), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'proxy-creds.enc')
}

/**
 * Load proxy credentials from encrypted storage.
 * Call this after app 'ready' event.
 */
export function loadProxyCredentials(): void {
  const credsPath = getCredsPath()
  if (!existsSync(credsPath)) {
    console.warn('[Proxy] No proxy credentials found. Configure via Settings > Network.')
    return
  }
  try {
    const raw = readFileSync(credsPath, 'utf-8')
    let json: string
    try {
      json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(raw, 'base64'))
        : raw
    } catch {
      json = raw
    }
    const creds = JSON.parse(json) as Record<string, { username: string; password: string }>
    for (const region of PROXY_REGIONS) {
      if (creds[region.id]) {
        region.username = creds[region.id].username
        region.password = creds[region.id].password
      }
    }
    console.log('[Proxy] Credentials loaded from encrypted storage')
  } catch (e) {
    console.error('[Proxy] Failed to load credentials:', e)
  }
}

/**
 * Save proxy credentials to encrypted storage.
 */
export function saveProxyCredentials(creds: Record<string, { username: string; password: string }>): void {
  const json = JSON.stringify(creds)
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json).toString('base64')
    : json
  writeFileSync(getCredsPath(), encrypted, 'utf-8')
  console.log('[Proxy] Credentials saved (encrypted:', safeStorage.isEncryptionAvailable(), ')')
}

export function getRegion(id: string): ProxyRegion | undefined {
  return PROXY_REGIONS.find(r => r.id === id)
}

export function getAvailableRegions(): ProxyRegion[] {
  return PROXY_REGIONS.filter(r => r.available)
}

export function getAllRegions(): ProxyRegion[] {
  return PROXY_REGIONS
}

/**
 * Get JVM args for SOCKS5 proxy.
 * Includes auth via system properties that the Loom Proxy mod reads.
 * Returns empty array if region is not available or credentials are missing.
 */
export function getProxyJvmArgs(regionId: string): string[] {
  const region = getRegion(regionId)
  if (!region || !region.available || !region.host) return []

  // Don't pass credentials if they haven't been loaded
  if (!region.username || !region.password) {
    console.warn('[Proxy] Credentials not loaded for region:', regionId)
    return []
  }

  return [
    `-Dloom.proxy.host=${region.host}`,
    `-Dloom.proxy.port=${region.port}`,
    `-Dloom.proxy.username=${region.username}`,
    `-Dloom.proxy.password=${region.password}`,
  ]
}
