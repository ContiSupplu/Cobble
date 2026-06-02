import { app } from 'electron'
import { net } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs'
import { createHash } from 'crypto'
import { storeGet } from './settings-store'
import { storeAndLink } from './mod-store'

// ============================================================
// Performance Mods — Auto-installer
// ============================================================
//
// Downloads and installs a curated set of performance-enhancing
// mods from Modrinth before each game launch. Skips mods that
// are already installed or incompatible with the target version.
// ============================================================

const INSTANCES_DIR = join(app.getPath('userData'), 'instances')
const MODRINTH_UA = 'loom-launcher/1.0.0'
const PERF_CHECK_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

// In-memory cache of last perf mod check per instance
const lastPerfCheckCache = new Map<string, { time: number; version: string; loader: string }>()

/**
 * The performance mods to auto-install.
 * `maxVersion` means the mod is only installed for MC versions BELOW that value
 * (e.g. starlight is vanilla in 1.20+, so maxVersion = '1.20').
 */
interface PerfModEntry {
  slug: string
  name: string
  description: string
  maxVersion?: string  // Only install if gameVersion < this (semver-like compare)
  minVersion?: string  // Only install if gameVersion >= this
  loaders?: string[]   // Restrict to these loaders only (omit = all loaders)
}

const PERFORMANCE_MODS: PerfModEntry[] = [
  // ── Core / Dependencies ──
  { slug: 'fabric-api', name: 'Fabric API', description: 'Core library required by most Fabric mods', loaders: ['fabric', 'quilt'] },
  { slug: 'cloth-config', name: 'Cloth Config', description: 'Config library required by many mods' },
  { slug: 'modmenu', name: 'Mod Menu', description: 'In-game mod configuration menu', loaders: ['fabric', 'quilt'] },

  // ── Rendering (FPS) ──
  { slug: 'sodium', name: 'Sodium', description: 'Rendering engine replacement (MASSIVE FPS boost)', loaders: ['fabric', 'quilt'] },
  { slug: 'embeddium', name: 'Embeddium', description: 'Sodium port for Forge/NeoForge (MASSIVE FPS boost)', loaders: ['forge', 'neoforge'] },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', description: 'UI/text rendering optimization' },
  { slug: 'entityculling', name: 'Entity Culling', description: 'Skip rendering hidden entities' },
  { slug: 'enhanced-block-entities', name: 'Enhanced Block Entities', description: 'Block entity rendering optimization (chests, signs, beds)', loaders: ['fabric', 'quilt'] },
  // Note: moreculling and cull-less-leaves removed — they have strict Sodium version
  // requirements (e.g. Sodium 0.6.x only) and cause crashes when Sodium updates.
  // Their performance benefit is marginal compared to Sodium/Lithium.
  { slug: 'sodium-extra', name: 'Sodium Extra', description: 'Extra optimization toggles for Sodium', loaders: ['fabric', 'quilt'] },
  { slug: 'badoptimizations', name: 'BadOptimizations', description: 'Non-rendering logic optimizations' },

  // ── Game Logic ──
  { slug: 'lithium', name: 'Lithium', description: 'Game logic optimizer', loaders: ['fabric', 'quilt'] },

  // ── Chunk Loading & World Gen ──
  { slug: 'noisium', name: 'Noisium', description: 'World generation speed optimization' },

  // ── Lighting ──
  { slug: 'starlight', name: 'Starlight', description: 'Light engine rewrite', maxVersion: '1.20' },
  { slug: 'scalablelux', name: 'ScalableLux', description: 'Optimized lighting engine (Starlight successor)', minVersion: '1.21' },

  // ── Memory ──
  { slug: 'ferritecore', name: 'FerriteCore', description: 'Memory optimization' },
  { slug: 'modernfix', name: 'ModernFix', description: 'Various performance fixes' },

  // ── Network ──
  { slug: 'krypton', name: 'Krypton', description: 'Network stack optimization', loaders: ['fabric', 'quilt'] },

  // ── Startup ──
  { slug: 'lazydfu', name: 'LazyDFU', description: 'Faster game startup', maxVersion: '1.20' },

  // ── Quality of Life ──
  { slug: 'dynamic-fps', name: 'Dynamic FPS', description: 'Reduces FPS when game is in background', loaders: ['fabric', 'quilt'] },
  { slug: 'notenoughcrashes', name: 'Not Enough Crashes', description: 'Crash recovery — returns to title instead of closing' },
  { slug: 'clumps', name: 'Clumps', description: 'Merges XP orbs to reduce entity lag' },
  { slug: 'debugify', name: 'Debugify', description: 'Fixes 70+ MC bugs including performance-affecting ones', loaders: ['fabric', 'quilt'] },
]

// Iris is handled separately via the 'perf_iris_shaders' setting
const IRIS_MOD: PerfModEntry = { slug: 'iris', name: 'Iris Shaders', description: 'Shader support built on Sodium (2x faster than OptiFine)' }

// ============================================================
// Helpers
// ============================================================

/** Simple MC version comparison: returns true if `version` < `threshold` */
function isVersionBelow(version: string, threshold: string): boolean {
  const parse = (v: string) => v.split('.').map(Number)
  const a = parse(version)
  const b = parse(threshold)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av < bv) return true
    if (av > bv) return false
  }
  return false // equal
}

function getInstanceModsDir(instanceId: string): string {
  const dir = join(INSTANCES_DIR, instanceId, 'mods')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getInstanceModsPath(instanceId: string): string {
  return join(INSTANCES_DIR, instanceId, 'mods.json')
}

function readInstanceMods(instanceId: string): any[] {
  try {
    const modsPath = getInstanceModsPath(instanceId)
    if (existsSync(modsPath)) {
      return JSON.parse(readFileSync(modsPath, 'utf-8'))
    }
  } catch { /* ignore */ }
  return []
}

function writeInstanceMods(instanceId: string, mods: any[]): void {
  const modsPath = getInstanceModsPath(instanceId)
  const dir = join(INSTANCES_DIR, instanceId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(modsPath, JSON.stringify(mods, null, 2))
}

// ── Perf Mod Blacklist ──
// Tracks mods deliberately removed by the user/Loomie to prevent re-installation

function getBlacklistPath(instanceId: string): string {
  return join(INSTANCES_DIR, instanceId, '.perf-blacklist.json')
}

function readBlacklist(instanceId: string): string[] {
  try {
    const p = getBlacklistPath(instanceId)
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch { /* ignore */ }
  return []
}

function writeBlacklist(instanceId: string, slugs: string[]): void {
  const p = getBlacklistPath(instanceId)
  const dir = join(INSTANCES_DIR, instanceId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify([...new Set(slugs)], null, 2))
}

export function blacklistPerfMod(instanceId: string, slug: string): void {
  const list = readBlacklist(instanceId)
  if (!list.includes(slug)) {
    list.push(slug)
    writeBlacklist(instanceId, list)
    console.log(`[PerfMods] Blacklisted '${slug}' for instance ${instanceId}`)
  }
}

async function downloadFile(url: string, destPath: string, expectedSha512?: string): Promise<void> {
  const response = await net.fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())

  // Verify SHA-512 hash if provided
  if (expectedSha512) {
    const actualHash = createHash('sha512').update(buffer).digest('hex')
    if (actualHash !== expectedSha512) {
      throw new Error(`Hash mismatch for ${destPath}! Expected: ${expectedSha512.substring(0, 16)}... Got: ${actualHash.substring(0, 16)}...`)
    }
    console.log(`[Security] Hash verified: ${destPath}`)
  }

  // Route through mod store for deduplication
  const { basename, dirname } = require('path')
  const fileName = basename(destPath)
  const modsDir = dirname(destPath)
  try {
    const result = storeAndLink(buffer, fileName, modsDir)
    if (result.alreadyExisted) {
      console.log(`[ModStore] Dedup hit: ${fileName} (hard-linked from store)`)
    }
  } catch {
    // Fallback: write directly if mod store fails
    writeFileSync(destPath, buffer)
  }
}

async function getCompatibleVersion(
  slug: string,
  gameVersion: string,
  loader: string
): Promise<any | null> {
  try {
    const url = `https://api.modrinth.com/v2/project/${slug}/version?game_versions=["${gameVersion}"]&loaders=["${loader.toLowerCase()}"]`
    const response = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
    if (response.ok) {
      const versions = await response.json()
      if (versions.length === 0) return null

      // Prefer stable releases over pre-releases.
      // Modrinth returns version_type: 'release' | 'beta' | 'alpha'.
      // Installing alpha/beta mods (e.g. Sodium 0.8.x-alpha) breaks
      // dependent mods (Iris, Sodium Extra) that only support stable APIs.
      const stableVersions = versions.filter((v: any) => v.version_type === 'release')
      if (stableVersions.length > 0) {
        console.log(`[PerfMods] ${slug}: picked stable v${stableVersions[0].version_number} (${stableVersions.length} stable, ${versions.length} total)`)
        return stableVersions[0]
      }

      // Fallback: prefer beta over alpha
      const betaVersions = versions.filter((v: any) => v.version_type === 'beta')
      if (betaVersions.length > 0) {
        console.log(`[PerfMods] ${slug}: no stable release, using beta v${betaVersions[0].version_number}`)
        return betaVersions[0]
      }

      // Last resort: use whatever is available (alpha)
      console.log(`[PerfMods] ${slug}: no stable/beta, using alpha v${versions[0].version_number}`)
      return versions[0]
    }
  } catch { /* ignore */ }
  return null
}

// ============================================================
// Main Export
// ============================================================

/**
 * Install performance mods into the given instance.
 * Called before game launch. Reads the `perf_modpack` setting to decide
 * whether to run. Downloads are parallelized with Promise.allSettled.
 *
 * @param instanceId  The instance ID (folder name under instances/)
 * @param gameVersion The Minecraft version string, e.g. "1.21.1"
 * @param loader      The mod loader name, e.g. "Fabric", "Forge"
 * @param isPerfEnabled Whether the perf_modpack setting is enabled
 */
export async function installPerformanceMods(
  instanceId: string,
  gameVersion: string,
  loader: string,
  isPerfEnabled: boolean
): Promise<void> {
  if (!isPerfEnabled) {
    console.log('[PerfMods] perf_modpack disabled, skipping.')
    return
  }

  // Only works with modded instances
  if (!loader || loader.toLowerCase() === 'vanilla') {
    console.log('[PerfMods] Vanilla instance, skipping performance mods.')
    return
  }

  console.log(`[PerfMods] Installing performance mods for ${instanceId} (MC ${gameVersion}, ${loader})`)

  // Check cache — skip if we checked recently with same version/loader
  const cached = lastPerfCheckCache.get(instanceId)
  if (cached && cached.version === gameVersion && cached.loader === loader
      && Date.now() - cached.time < PERF_CHECK_CACHE_TTL) {
    console.log(`[PerfMods] Skipping check — last verified ${Math.round((Date.now() - cached.time) / 60000)}min ago`)
    return
  }

  const modsDir = getInstanceModsDir(instanceId)
  const existingMods = readInstanceMods(instanceId)
  const blacklist = readBlacklist(instanceId)

  // ── Cleanup: Remove perf mods we previously installed that are no longer in our list ──
  // This handles mods we've removed from the curated set (e.g., moreculling, cull-less-leaves)
  const irisEnabled = storeGet?.('perf_iris_shaders') ?? false
  const allModSlugs = new Set([...PERFORMANCE_MODS.map(m => m.slug), ...(irisEnabled ? [IRIS_MOD.slug] : [])])
  
  const removedMods = existingMods.filter(
    (m: any) => m.isPerfMod && !allModSlugs.has(m.slug)
  )
  for (const rm of removedMods) {
    try {
      const rmPath = join(modsDir, rm.fileName)
      if (existsSync(rmPath)) {
        unlinkSync(rmPath)
        console.log(`[PerfMods] Removed deprecated mod: ${rm.slug} (${rm.fileName})`)
      }
    } catch { /* ignore */ }
  }
  // Also scan for known problematic files that might have been installed before tracking
  const DEPRECATED_MODS = ['moreculling', 'cull-less-leaves']
  try {
    const modFiles = readdirSync(modsDir) as string[]
    for (const file of modFiles) {
      const lower = file.toLowerCase()
      if (DEPRECATED_MODS.some(d => lower.includes(d.replace('-', '')))) {
        unlinkSync(join(modsDir, file))
        console.log(`[PerfMods] Removed deprecated mod file: ${file}`)
      }
    }
  } catch { /* ignore */ }
  // Update mods.json to remove entries for deprecated mods
  const cleanedMods = existingMods.filter(
    (m: any) => !removedMods.some((rm: any) => rm.slug === m.slug)
  )
  if (cleanedMods.length !== existingMods.length) {
    writeInstanceMods(instanceId, cleanedMods)
  }

  // Build the mod list — include Iris if its separate toggle is on
  const allMods = irisEnabled ? [...PERFORMANCE_MODS, IRIS_MOD] : PERFORMANCE_MODS

  const applicableMods = allMods.filter(mod => {
    if (blacklist.includes(mod.slug)) {
      console.log(`[PerfMods] Skipping ${mod.slug} — blacklisted (previously removed)`)
      return false
    }
    // Dependency-aware: iris and sodium-extra require a rendering engine (sodium/embeddium)
    if ((mod.slug === 'iris' || mod.slug === 'sodium-extra') && blacklist.includes('sodium') && blacklist.includes('embeddium')) {
      console.log(`[PerfMods] Skipping ${mod.slug} — depends on sodium/embeddium which are blacklisted`)
      return false
    }
    if (mod.maxVersion && !isVersionBelow(gameVersion, mod.maxVersion)) {
      console.log(`[PerfMods] Skipping ${mod.slug} — included in vanilla since ${mod.maxVersion}`)
      return false
    }
    if (mod.minVersion && isVersionBelow(gameVersion, mod.minVersion)) {
      console.log(`[PerfMods] Skipping ${mod.slug} — requires MC ${mod.minVersion}+`)
      return false
    }
    if (mod.loaders && !mod.loaders.includes(loader.toLowerCase())) {
      console.log(`[PerfMods] Skipping ${mod.slug} — not available for ${loader}`)
      return false
    }
    return true
  })

  // Filter out already-installed mods
  const modsToInstall = applicableMods.filter(mod => {
    const alreadyInstalled = existingMods.some(
      (m: any) => m.slug === mod.slug || m.id === mod.slug || m.projectId === mod.slug
    )
    if (alreadyInstalled) {
      console.log(`[PerfMods] ${mod.slug} already installed, skipping.`)
      return false
    }
    return true
  })

  if (modsToInstall.length === 0) {
    console.log('[PerfMods] All performance mods already installed.')
    // Bulk update check — single API call instead of 20+ individual ones
    try {
      await checkBulkPerfModUpdates(instanceId, modsDir, existingMods, gameVersion, loader)
    } catch (err: any) {
      console.log(`[PerfMods] Bulk update check skipped: ${err.message}`)
    }
    // Cache successful check
    lastPerfCheckCache.set(instanceId, { time: Date.now(), version: gameVersion, loader })
    return
  }

  console.log(`[PerfMods] Downloading ${modsToInstall.length} mod(s) in parallel...`)

  // Download all mods in parallel
  const results = await Promise.allSettled(
    modsToInstall.map(async (mod) => {
      const version = await getCompatibleVersion(mod.slug, gameVersion, loader)
      if (!version || !version.files || version.files.length === 0) {
        console.log(`[PerfMods] ${mod.slug} — no compatible version for MC ${gameVersion}/${loader}`)
        return null
      }

      const primaryFile = version.files.find((f: any) => f.primary) || version.files[0]
      const fileName = primaryFile.filename
      const destPath = join(modsDir, fileName)

      // Skip if file already exists on disk (e.g. manually copied)
      if (existsSync(destPath)) {
        console.log(`[PerfMods] ${mod.slug} — file already on disk, skipping download.`)
        return null
      }

      const expectedHash = primaryFile.hashes?.sha512 || undefined
      await downloadFile(primaryFile.url, destPath, expectedHash)
      console.log(`[PerfMods] ${mod.slug} v${version.version_number} downloaded.`)

      return {
        id: mod.slug,
        name: mod.name,
        description: mod.description,
        version: version.version_number,
        slug: mod.slug,
        fileName,
        projectId: version.project_id,
        installedAt: Date.now(),
        isPerfMod: true,
      }
    })
  )

  // Collect successful installs and update mods.json once
  const newEntries: any[] = []
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      newEntries.push(result.value)
    } else if (result.status === 'rejected') {
      console.error(`[PerfMods] Mod install failed:`, result.reason)
    }
  }

  if (newEntries.length > 0) {
    const currentMods = readInstanceMods(instanceId)
    // Avoid duplicates (in case of race)
    for (const entry of newEntries) {
      if (!currentMods.some((m: any) => m.slug === entry.slug)) {
        currentMods.push(entry)
      }
    }
    writeInstanceMods(instanceId, currentMods)
    console.log(`[PerfMods] ${newEntries.length} performance mod(s) installed and tracked.`)
  } else {
    console.log('[PerfMods] No new mods were installed.')
  }

  // Cache successful check
  lastPerfCheckCache.set(instanceId, { time: Date.now(), version: gameVersion, loader })

  // Ship optimized ModernFix config
  ensureModernFixConfig(instanceId)
}

/**
 * Ship a ModernFix config with `dynamic_resources` enabled.
 * This is the single biggest startup optimization — defers model baking
 * and atlas stitching to on-demand loading so the title screen appears faster.
 *
 * Only writes if the config doesn't exist yet (preserves user customizations).
 */
export function ensureModernFixConfig(instanceId: string): void {
  const instanceDir = join(INSTANCES_DIR, instanceId)
  const configDir = join(instanceDir, 'config')
  const configFile = join(configDir, 'modernfix-mixins.properties')

  // Don't overwrite if user already has a config
  if (existsSync(configFile)) return

  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    // Enable dynamic_resources — defers model baking to on-demand loading
    // This dramatically cuts time-to-title-screen on modded instances
    const config = [
      '# ModernFix config — shipped by Loom Launcher for faster startup',
      '# dynamic_resources defers model baking/atlas stitching to on-demand',
      '# Delete this file to regenerate with defaults',
      '',
      'mixin.perf.dynamic_resources=true',
      'mixin.perf.deduplicate_location=true',
      'mixin.perf.blast_search_trees=true',
      'mixin.perf.faster_item_rendering=true',
      'mixin.feature.measure_time=true',
      '',
    ].join('\n')

    writeFileSync(configFile, config, 'utf-8')
    console.log('[PerfMods] ModernFix config shipped with dynamic_resources=true')
  } catch (err: any) {
    console.log(`[PerfMods] ModernFix config skip: ${err.message}`)
  }
}

// ============================================================
// Bulk Update Check — Single API call for all installed perf mods
// ============================================================

/**
 * Check all installed perf mods for updates using a single Modrinth API call
 * (POST /v2/version_files/update) instead of 20+ individual lookups.
 */
async function checkBulkPerfModUpdates(
  instanceId: string,
  modsDir: string,
  existingMods: any[],
  gameVersion: string,
  loader: string
): Promise<void> {
  // Collect SHA-512 hashes of installed perf mod JARs
  const hashToFile = new Map<string, { filename: string; slug: string }>()

  for (const mod of existingMods) {
    if (!mod.filename) continue
    const filePath = join(modsDir, mod.filename)
    if (!existsSync(filePath)) continue
    try {
      const buffer = readFileSync(filePath)
      const hash = createHash('sha512').update(buffer).digest('hex')
      hashToFile.set(hash, { filename: mod.filename, slug: mod.slug })
    } catch { /* skip */ }
  }

  if (hashToFile.size === 0) {
    console.log('[PerfMods] No installed perf mod JARs found for bulk check')
    return
  }

  console.log(`[PerfMods] Bulk update check: ${hashToFile.size} mod(s) in 1 API call`)

  const response = await net.fetch('https://api.modrinth.com/v2/version_files/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': MODRINTH_UA,
    },
    body: JSON.stringify({
      hashes: [...hashToFile.keys()],
      algorithm: 'sha512',
      loaders: [loader.toLowerCase()],
      game_versions: [gameVersion],
    }),
  })

  if (!response.ok) {
    console.log(`[PerfMods] Bulk update API returned ${response.status}`)
    return
  }

  const updates = await response.json() as Record<string, any>
  let updatedCount = 0

  for (const [hash, latestVersion] of Object.entries(updates)) {
    const installed = hashToFile.get(hash)
    if (!installed) continue

    // Check if the latest version is different from what's installed
    const latestFile = latestVersion.files?.find((f: any) => f.primary) || latestVersion.files?.[0]
    if (!latestFile) continue

    // If the hash matches, it's already the latest
    if (latestFile.hashes?.sha512 === hash) continue

    // Update available — download it
    console.log(`[PerfMods] Update available for ${installed.slug}: ${latestVersion.version_number}`)
    try {
      const dlRes = await net.fetch(latestFile.url)
      if (!dlRes.ok) continue
      const buffer = Buffer.from(await dlRes.arrayBuffer())

      // Verify hash
      if (latestFile.hashes?.sha512) {
        const actualHash = createHash('sha512').update(buffer).digest('hex')
        if (actualHash !== latestFile.hashes.sha512) {
          console.log(`[PerfMods] Hash mismatch for ${installed.slug} update, skipping`)
          continue
        }
      }

      // Remove old file, write new one
      try { unlinkSync(join(modsDir, installed.filename)) } catch { /* ignore */ }
      const newFilename = latestFile.filename || `${installed.slug}-${latestVersion.version_number}.jar`
      writeFileSync(join(modsDir, newFilename), buffer)

      // Update mods.json entry
      const currentMods = readInstanceMods(instanceId)
      const modEntry = currentMods.find((m: any) => m.slug === installed.slug)
      if (modEntry) {
        modEntry.filename = newFilename
        modEntry.version = latestVersion.version_number
        writeInstanceMods(instanceId, currentMods)
      }

      console.log(`[PerfMods] Updated ${installed.slug} to v${latestVersion.version_number}`)
      updatedCount++
    } catch (err: any) {
      console.log(`[PerfMods] Failed to update ${installed.slug}: ${err.message}`)
    }
  }

  if (updatedCount > 0) {
    console.log(`[PerfMods] Bulk update: ${updatedCount} mod(s) updated`)
  } else {
    console.log('[PerfMods] All perf mods are up-to-date')
  }
}
