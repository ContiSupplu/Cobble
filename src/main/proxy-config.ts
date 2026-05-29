// ============================================================
// Proxy Configuration — SOCKS5 regions for Incognito Mode
// ============================================================

export interface ProxyRegion {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  available: boolean
}

export const PROXY_REGIONS: ProxyRegion[] = [
  { id: 'us-east',   name: 'US East',        host: '149.28.39.243',  port: 1080, username: 'cobble', password: 'CobbleProxy2026!', available: true },
  { id: 'us-west',   name: 'US West',        host: '66.42.104.127',  port: 1080, username: 'cobble', password: 'CobbleProxy2026!', available: true },
  { id: 'uk',        name: 'United Kingdom',  host: '78.141.201.20',  port: 1080, username: 'cobble', password: 'CobbleProxy2026!', available: true },
  { id: 'australia', name: 'Australia',       host: '45.32.189.89',   port: 1080, username: 'cobble', password: 'CobbleProxy2026!', available: true },
]

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
 * Includes auth via system properties that RespectProxyOptions mod reads.
 * Returns empty array if region is not available.
 */
export function getProxyJvmArgs(regionId: string): string[] {
  const region = getRegion(regionId)
  if (!region || !region.available || !region.host) return []

  return [
    // Use custom property names that only our Cobble Proxy mod reads.
    // This ensures auth/session traffic goes DIRECT (not through proxy),
    // while game server connections route through SOCKS5.
    `-Dcobble.proxy.host=${region.host}`,
    `-Dcobble.proxy.port=${region.port}`,
    `-Dcobble.proxy.username=${region.username}`,
    `-Dcobble.proxy.password=${region.password}`,
  ]
}
