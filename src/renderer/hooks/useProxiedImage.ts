import { useState, useEffect } from 'react'

// In-memory cache so images persist across re-renders
const cache = new Map<string, string>()
// Track failed URLs so we don't retry endlessly
const failed = new Set<string>()

/**
 * Fetches an external image through Electron's main process (net.fetch),
 * completely bypassing all CSP, CORS, and browser security.
 * Returns a data: URI that always works in <img> tags.
 */
export function useProxiedImage(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => {
    if (!url) return null
    return cache.get(url) || null
  })

  useEffect(() => {
    if (!url) { setSrc(null); return }
    if (cache.has(url)) { setSrc(cache.get(url)!); return }
    if (failed.has(url)) return

    let cancelled = false

    // MUST access window.electronAPI inside the effect, NOT at module level,
    // because the preload script may not have run when the module first loads.
    const api = (window as any).electronAPI

    if (api && typeof api.proxyImage === 'function') {
      api.proxyImage(url).then((result: string | null) => {
        if (cancelled) return
        if (result) {
          cache.set(url, result)
          setSrc(result)
        } else {
          failed.add(url)
        }
      }).catch(() => {
        if (!cancelled) failed.add(url)
      })
    }

    return () => { cancelled = true }
  }, [url])

  return src
}
