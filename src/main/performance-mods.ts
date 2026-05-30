import { app } from 'electron'
import { net } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

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
  { slug: 'moreculling', name: 'More Culling', description: 'Additional culling for entities, tiles, and sky', loaders: ['fabric', 'quilt'] },
  { slug: 'cull-less-leaves', name: 'Cull Less Leaves', description: 'Configurable leaf rendering optimization', loaders: ['fabric', 'quilt'] },
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

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await net.fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(destPath, buffer)
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
      if (versions.length > 0) return versions[0]
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
  const modsDir = getInstanceModsDir(instanceId)
  const existingMods = readInstanceMods(instanceId)
  const blacklist = readBlacklist(instanceId)

  // Build the mod list — include Iris if its separate toggle is on
  const { storeGet } = require('./settings-store')
  const irisEnabled = storeGet?.('perf_iris_shaders') ?? false
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

      await downloadFile(primaryFile.url, destPath)
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
}
