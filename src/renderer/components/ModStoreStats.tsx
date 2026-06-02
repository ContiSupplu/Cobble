import { useState, useEffect } from 'react'

const api = (window as any).electronAPI

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

interface ModStoreStatsProps {
  instances: { id: string; name: string }[]
}

export default function ModStoreStats({ instances }: ModStoreStatsProps) {
  const [stats, setStats] = useState({ totalMods: 0, totalSize: 0, totalRefs: 0 })
  const [savings, setSavings] = useState({ totalStored: 0, totalLinked: 0, savedBytes: 0 })
  const [migrating, setMigrating] = useState(false)
  const [migrateProgress, setMigrateProgress] = useState(0)
  const [result, setResult] = useState('')

  useEffect(() => { loadStats() }, [])

  const loadStats = async () => {
    try {
      const [s, sv] = await Promise.all([
        api?.modStoreStats?.(),
        api?.modStoreSavings?.(),
      ])
      if (s) setStats(s)
      if (sv) setSavings(sv)
    } catch { /* API not ready */ }
  }

  const optimizeAll = async () => {
    setMigrating(true)
    setResult('')
    let totalMigrated = 0
    let totalSaved = 0

    for (let i = 0; i < instances.length; i++) {
      setMigrateProgress(Math.round(((i + 1) / instances.length) * 100))
      try {
        const r = await api?.modStoreMigrate?.(instances[i].id)
        if (r) {
          totalMigrated += r.migrated
          totalSaved += r.savedBytes
        }
      } catch { /* skip */ }
    }

    setMigrating(false)
    setResult(`Optimized ${totalMigrated} mods, saved ${formatBytes(totalSaved)}`)
    await loadStats()
  }

  const dedupRatio = savings.totalLinked > 0
    ? Math.min(100, Math.round((1 - savings.totalStored / savings.totalLinked) * 100))
    : 0

  return (
    <div className="modvault-panel settings-section">
      <div className="settings-label">Mod Vault</div>

      {/* Header */}
      <div className="modvault-header">
        <div className="modvault-header-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <div>
          <div className="modvault-title">Deduplicated mod storage</div>
          <div className="modvault-desc">Share identical mods across instances with hard links</div>
        </div>
      </div>

      {/* Stats */}
      <div className="modvault-stats-row">
        <div className="modvault-stat-card">
          <div className="modvault-stat-value">{stats.totalMods}</div>
          <div className="modvault-stat-label">mods stored</div>
        </div>
        <div className="modvault-stat-card">
          <div className="modvault-stat-value">{stats.totalRefs}</div>
          <div className="modvault-stat-label">instances linked</div>
        </div>
        <div className="modvault-stat-card">
          <div className="modvault-stat-value">{formatBytes(savings.savedBytes)}</div>
          <div className="modvault-stat-label">saved</div>
        </div>
      </div>

      {/* Progress */}
      <div className="modvault-progress-wrap">
        <div className="modvault-progress-bar">
          <div className="modvault-progress-fill" style={{ width: `${dedupRatio}%` }} />
        </div>
        <div className="modvault-progress-label">
          {dedupRatio > 0 ? `${dedupRatio}% dedup ratio` : 'No deduplication data yet'}
        </div>
      </div>

      {/* Optimize */}
      <button
        className="modvault-optimize-btn"
        onClick={optimizeAll}
        disabled={migrating || instances.length === 0}
      >
        {migrating ? (
          <>Optimizing... {migrateProgress}%</>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Optimize All Instances
          </>
        )}
      </button>

      {result && <div className="modvault-result">{result}</div>}
    </div>
  )
}
