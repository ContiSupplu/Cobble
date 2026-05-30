import { app, BrowserWindow, net } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'fs'
import dns from 'dns'
import { installTask } from '@xmcl/installer'
import { launch, Version } from '@xmcl/core'
import { Task } from '@xmcl/task'
import { ChildProcess } from 'child_process'
import { getCachedAccount } from './auth'
import { startDynamicIslandServer, stopDynamicIslandServer, sendNotification } from './dynamic-island-server'
import { getAllInstances } from './instances'
import { getProxyJvmArgs } from './proxy-config'
import { setPlayingMinecraft, clearPlayingMinecraft } from './discord'
import { setHighPerformancePowerPlan, restoreDefaultPowerPlan, writeOptimizedGameSettings } from './system-optimizations'
import { installPerformanceMods } from './performance-mods'

// ============================================================
// State
// ============================================================

export interface LaunchStatus {
  running: boolean
  progress: number
  task: string
  detail?: string     // e.g. "142 / 1,847 files"
  error?: string
  firstDownload?: boolean
}

let activeProcess: ChildProcess | null = null
let currentStatus: LaunchStatus = { running: false, progress: 0, task: '' }
let mainWindow: BrowserWindow | null = null
let cancelRequested = false
let currentLaunchInstanceId: string | null = null

const gameLogBuffer: string[] = []
const GAME_LOG_MAX_LINES = 200

export function getGameLogBuffer(): string[] {
  return gameLogBuffer
}

// Version manifest cache — avoid re-fetching from Mojang every launch
let cachedMojangVersions: any = null
let versionCacheTime = 0
const VERSION_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

// Read a setting from the shared config file (same file index.ts storeGet uses)
function readPerfModpackSetting(): boolean {
  try {
    const configPath = join(app.getPath('userData'), 'config', 'settings.json')
    if (existsSync(configPath)) {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'))
      // Default to true if not explicitly set
      return data.perf_modpack !== undefined ? !!data.perf_modpack : true
    }
  } catch { /* ignore */ }
  return true  // default ON
}

// Preload caches — populated on app boot
let fabricLoaderCache: Map<string, any[]> = new Map() // version -> loaders
let javaPathCache: Map<string, string> = new Map()    // component -> javaBin path
let persistentAgent: any = null // reuse across launches

function getAgent() {
  if (!persistentAgent) {
    const { Agent } = require('undici')
    persistentAgent = new Agent({ connections: 32, pipelining: 1 })
  }
  return persistentAgent
}

// Helper: ensure Java is available for mod loader installation (Forge/NeoForge need it)
async function ensureJavaForLoader(rootPath: string, mcVersion: string): Promise<string> {
  // Determine which Java component this MC version needs
  // MC 1.20+ uses java-runtime-delta (Java 21), 1.18-1.19 uses java-runtime-gamma (Java 17)
  const javaComponent = parseInt(mcVersion.split('.')[1] || '0') >= 20 
    ? 'java-runtime-delta' 
    : parseInt(mcVersion.split('.')[1] || '0') >= 18 
      ? 'java-runtime-gamma' 
      : 'java-runtime-beta'
  const jreDir = join(rootPath, 'java', javaComponent)
  const javaBin = join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  
  if (existsSync(javaBin)) return javaBin
  
  // Download Java
  console.log(`[Launcher] Pre-downloading Java (${javaComponent}) for mod loader install...`)
  const { fetchJavaRuntimeManifest, installJavaRuntimeTask } = require('@xmcl/installer')
  const javaManifest = await fetchJavaRuntimeManifest({ target: javaComponent })
  const { Agent } = require('undici')
  const agent = new Agent({ connections: 16, pipelining: 1 })
  const javaTask = installJavaRuntimeTask({
    manifest: javaManifest,
    destination: jreDir,
    agent
  })
  await javaTask.startAndWait()
  agent.close()
  return javaBin
}

export function setLauncherWindow(win: BrowserWindow) {
  mainWindow = win
}

// ============================================================
// Preload — called on app boot to warm caches
// ============================================================

export async function preloadEssentials() {
  const startTime = Date.now()
  console.log('[Preload] Starting background preload...')

  const rootPath = join(app.getPath('userData'), 'minecraft_data')

  const broadcastPreload = (step: string, progress: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('preload:progress', { step, progress })
    }
  }

  // Step 1: Warm up HTTP agent + DNS pre-resolution
  broadcastPreload('Initializing...', 5)
  getAgent()

  // DNS pre-warming — resolve Mojang CDN hosts in parallel
  const cdnHosts = [
    'launchermeta.mojang.com', 'piston-meta.mojang.com',
    'resources.download.minecraft.net', 'libraries.minecraft.net',
    'piston-data.mojang.com', 'meta.fabricmc.net', 'maven.fabricmc.net'
  ]
  Promise.all(cdnHosts.map(h => dns.promises.resolve4(h).catch(() => {}))).catch(() => {})

  // Step 2: Fetch Mojang version manifest
  broadcastPreload('Fetching version manifest...', 15)
  try {
    const { getVersionList } = require('@xmcl/installer')
    cachedMojangVersions = await getVersionList()
    versionCacheTime = Date.now()
    console.log(`[Preload] Version manifest cached (${cachedMojangVersions.versions.length} versions)`)
  } catch (err) {
    console.warn('[Preload] Version manifest prefetch failed:', err)
  }
  broadcastPreload('Version manifest ready', 40)

  // Step 3: Prefetch Fabric loader metadata for all Fabric instances
  broadcastPreload('Loading mod loaders...', 45)
  try {
    const instances = getAllInstances()
    const fabricVersions = [...new Set(instances.filter(i => i.loader === 'Fabric').map(i => i.version))]
    if (fabricVersions.length > 0) {
      const { getLoaderArtifactListFor } = require('@xmcl/installer')
      await Promise.all(fabricVersions.map(async (ver) => {
        try {
          const loaders = await getLoaderArtifactListFor(ver)
          if (loaders && loaders.length > 0) {
            fabricLoaderCache.set(ver, loaders)
            console.log(`[Preload] Fabric loaders cached for ${ver}`)
          }
        } catch { /* ignore per-version failures */ }
      }))
    }
  } catch (err) {
    console.warn('[Preload] Fabric prefetch failed:', err)
  }
  broadcastPreload('Mod loaders ready', 70)

  // Step 4: Pre-check Java paths for installed versions
  broadcastPreload('Checking Java runtimes...', 75)
  try {
    const versionsDir = join(rootPath, 'versions')
    if (existsSync(versionsDir)) {
      const installedVersions = readdirSync(versionsDir)
      for (const verId of installedVersions) {
        try {
          const resolved = await Version.parse(rootPath, verId)
          const component = resolved.javaVersion?.component || 'java-runtime-gamma'
          const javaBin = join(rootPath, 'java', component, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
          if (existsSync(javaBin)) {
            javaPathCache.set(component, javaBin)
          }
        } catch { /* skip unparseable versions */ }
      }
      if (javaPathCache.size > 0) {
        console.log(`[Preload] Java paths cached: ${[...javaPathCache.keys()].join(', ')}`)
      }
    }
  } catch (err) {
    console.warn('[Preload] Java path check failed:', err)
  }
  broadcastPreload('Java ready', 90)

  // Done!
  const elapsed = Date.now() - startTime
  broadcastPreload('Ready', 100)
  console.log(`[Preload] Done in ${elapsed}ms`)
}

function broadcastStatus(status: Partial<LaunchStatus>) {
  currentStatus = { ...currentStatus, ...status }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launch:statusUpdate', currentStatus)
  }
}

function broadcastLog(message: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launch:log', message)
  }
  const lines = message.split('\n').filter(l => l.length > 0)
  for (const line of lines) {
    gameLogBuffer.push(line)
    // Immediate per-line crash check
    if (!crashAlreadyFired) {
      checkLineForCrash(line)
    }
  }
  while (gameLogBuffer.length > GAME_LOG_MAX_LINES) {
    gameLogBuffer.shift()
  }
}

let crashAlreadyFired = false

// Critical error patterns — checked on every log line
const CRASH_LINE_PATTERNS: Array<{ test: RegExp; type: string; getDetails: (line: string, allLogs: string[]) => string }> = [
  {
    test: /broken mod state/i,
    type: 'incompatible_mods',
    getDetails: (_line, allLogs) => {
      const full = allLogs.join('\n')
      const m = full.match(/Mod\s+'?(\w+)'?\s+is\s+incompatible\s+with\s+'?(\w+)'?/i)
      if (m) return `Mod '${m[1]}' is incompatible with '${m[2]}'. One of them needs to be removed.`
      return 'A mod is in a broken state. There are incompatible or conflicting mods.'
    }
  },
  {
    test: /Crash report saved to/i,
    type: 'generic_crash',
    getDetails: (_line, allLogs) => {
      const full = allLogs.join('\n')
      const m = full.match(/Mod\s+'?(\w+)'?\s+is\s+incompatible\s+with\s+'?(\w+)'?/i)
      if (m) return `Mod '${m[1]}' is incompatible with '${m[2]}'. One of them needs to be removed.`
      const desc = full.match(/Description:\s*(.+)/)
      if (desc) return `Crash: ${desc[1].trim()}`
      return 'The game crashed. A crash report was saved.'
    }
  },
  {
    test: /Error loading mods|fml\.modloadingissue/i,
    type: 'incompatible_mods',
    getDetails: (_line, allLogs) => {
      const full = allLogs.join('\n')
      const m = full.match(/Mod\s+'?(\w+)'?\s+is\s+incompatible\s+with\s+'?(\w+)'?/i)
      if (m) return `Mod '${m[1]}' is incompatible with '${m[2]}'. One of them needs to be removed.`
      return 'Mod loading errors detected. There are incompatible or broken mods.'
    }
  },
  {
    test: /\[.+?\/FATAL\]/,
    type: 'generic_crash',
    getDetails: (line, allLogs) => {
      const full = allLogs.join('\n')
      const m = full.match(/Mod\s+'?(\w+)'?\s+is\s+incompatible\s+with\s+'?(\w+)'?/i)
      if (m) return `Mod '${m[1]}' is incompatible with '${m[2]}'. One of them needs to be removed.`
      const errMsg = line.match(/FATAL\]\s*(?:\[[^\]]+\]:?)?\s*(.+)/)
      return errMsg ? `Fatal error: ${errMsg[1].trim().slice(0, 120)}` : 'A fatal error occurred.'
    }
  },
  {
    test: /java\.lang\.OutOfMemoryError/,
    type: 'out_of_memory',
    getDetails: () => 'The game ran out of memory. Try increasing the allocated RAM in instance settings.'
  },
  {
    test: /ModResolutionException/,
    type: 'mod_resolution',
    getDetails: (line) => {
      const m = line.match(/ModResolutionException:\s*(.+)/)
      return m ? `Mod resolution failed: ${m[1].trim()}` : 'Mod resolution failed — there may be conflicting or incompatible mods.'
    }
  },
  {
    test: /Incompatible mods found/i,
    type: 'incompatible_mods',
    getDetails: () => 'Incompatible mods were detected. Some installed mods conflict with each other.'
  },
  {
    test: /requires version.*which is missing/i,
    type: 'missing_dependency',
    getDetails: (line) => {
      const m = line.match(/Mod\s+'([^']+)'.*?requires.*?'([^']+)'.*?version\s+([^\s,]+).*?missing/i)
      return m ? `Mod '${m[1]}' requires '${m[2]}' version ${m[3]}, which is not installed.` : 'A mod is missing a required dependency.'
    }
  },
  {
    test: /incompatible with/i,
    type: 'incompatible_mods',
    getDetails: (line) => {
      const m = line.match(/Mod\s+'?(\w+)'?\s+is\s+incompatible\s+with\s+'?(\w+)'?/i)
      return m ? `Mod '${m[1]}' is incompatible with '${m[2]}'. One of them needs to be removed.` : 'A mod incompatibility was detected.'
    }
  },
]

function checkLineForCrash(line: string) {
  for (const pattern of CRASH_LINE_PATTERNS) {
    if (pattern.test.test(line)) {
      crashAlreadyFired = true
      const details = pattern.getDetails(line, gameLogBuffer)
      console.log(`[Launcher] CRASH DETECTED in log line: "${line.slice(0, 120)}"`)
      console.log(`[Launcher] Type: ${pattern.type} — ${details}`)

      // Small delay to collect a few more log lines for context
      setTimeout(() => {

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('loomie:crash-detected', {
            type: pattern.type,
            instanceId: currentLaunchInstanceId,
            details,
            rawLogs: gameLogBuffer.slice(-50),
          })

        } else {

        }
      }, 500)
      break
    }
  }
}

// ============================================================
// Helper: Task execution with progress streaming + heartbeat
// ============================================================

// Descriptive phase messages that rotate during long waits
const STALL_MESSAGES = [
  'Still working...',
  'This may take a moment...',
  'Downloading from Mojang servers...',
  'Hang tight...',
  'Almost there...',
]

async function runTaskWithProgress(task: Task<any>, name: string, rangeStart = 0, rangeEnd = 100) {
  let highWaterMark = 0
  let lastBroadcast = 0
  let lastLoggedMilestone = -1
  let lastProgressTime = Date.now()
  let stallIndex = 0
  let displayProgress = rangeStart  // Smooth visual progress
  const THROTTLE_MS = 150

  broadcastLog(`[Launcher] ${name}...\n`)

  // Heartbeat: keeps the progress bar alive during stalls
  const heartbeat = setInterval(() => {
    const timeSinceProgress = Date.now() - lastProgressTime
    const mappedProgress = Math.floor(rangeStart + (highWaterMark / 100) * (rangeEnd - rangeStart))

    // Smooth visual progress — creep forward slowly even when stalled
    if (displayProgress < mappedProgress) {
      displayProgress = Math.min(displayProgress + 2, mappedProgress)
    } else if (timeSinceProgress > 3000 && displayProgress < rangeEnd - 2) {
      // Very slow creep when truly stalled (never reaches the end)
      displayProgress = Math.min(displayProgress + 0.3, rangeEnd - 2)
    }

    // Rotate stall messages if no real progress for >5s
    let taskText = `${name} (${Math.round(displayProgress)}%)`
    if (timeSinceProgress > 5000) {
      taskText = STALL_MESSAGES[stallIndex % STALL_MESSAGES.length]
      stallIndex++
    }

    broadcastStatus({ progress: Math.round(displayProgress), task: taskText })
  }, 1500)

  try {
    await task.startAndWait({
      onUpdate: (t) => {
        if (t.total && t.total > 0) {
          const p = Math.floor((t.progress / t.total) * 100)
          if (p > highWaterMark) {
            highWaterMark = p
            lastProgressTime = Date.now()
            stallIndex = 0
          }

          // Build a descriptive detail string (values are bytes)
          const done = t.progress
          const total = t.total
          let detail = ''
          if (total > 1_000_000) {
            const doneMB = (done / 1_048_576).toFixed(0)
            const totalMB = (total / 1_048_576).toFixed(0)
            detail = `${doneMB} / ${totalMB} MB`
          }

          const milestone = Math.floor(highWaterMark / 10) * 10
          if (milestone > lastLoggedMilestone && milestone > 0) {
            lastLoggedMilestone = milestone
            broadcastLog(`[Launcher] ${name}: ${milestone}% complete${detail ? ` (${detail})` : ''}\n`)
          }

          // Map task progress to overall pipeline range
          const overallProgress = Math.floor(rangeStart + (highWaterMark / 100) * (rangeEnd - rangeStart))
          displayProgress = overallProgress
          const now = Date.now()
          if (now - lastBroadcast >= THROTTLE_MS || highWaterMark >= 100) {
            lastBroadcast = now
            const taskText = detail
              ? `${name} (${detail})`
              : `${name} (${highWaterMark}%)`
            broadcastStatus({ progress: overallProgress, task: taskText, detail })
          }
        }
      }
    })
  } finally {
    clearInterval(heartbeat)
  }
}

// ============================================================
// Helper: Retry wrapper with short delay
// ============================================================

async function runWithRetries(fn: () => Promise<void>, maxRetries = 5) {
  let lastErr
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fn()
      return
    } catch (err: any) {
      lastErr = err
      broadcastLog(`[Launcher] Pass ${attempt}/${maxRetries} incomplete, retrying...\n`)
      console.warn(`[Install] Pass ${attempt} incomplete, retrying...`)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500))
      }
    }
  }
  throw lastErr
}

// ============================================================
// Incognito — RespectProxyOptions mod management
// ============================================================

const PROXY_MOD_FILENAME = 'loom-proxy.jar'
const PROXY_MOD_JAR = 'loom-proxy-1.0.0.jar'

// Path to our built mod JAR
function getProxyModSource(): string {
  const candidates = [
    // Sibling project relative to this project's root
    join(app.getAppPath(), '..', 'loom-proxy-mod', 'build', 'libs', PROXY_MOD_JAR),
    join(app.getAppPath(), '..', '..', 'loom-proxy-mod', 'build', 'libs', PROXY_MOD_JAR),
    join(app.getAppPath(), '..', '..', '..', 'loom-proxy-mod', 'build', 'libs', PROXY_MOD_JAR),
    // Absolute fallback for dev
    join('c:', 'Users', 'raysm', 'Minecraft Mod', 'loom-proxy-mod', 'build', 'libs', PROXY_MOD_JAR),
    // Production: bundled in resources
    join(process.resourcesPath || app.getAppPath(), PROXY_MOD_JAR),
  ]

  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`[Launcher] Found proxy mod at: ${p}`)
      return p
    }
  }

  console.error('[Launcher] Proxy mod not found! Searched:', candidates)
  return candidates[candidates.length - 1] // will fail with a clear error
}

/**
 * Ensure the Loom Proxy mod is in the instance mods folder.
 * Copies from the bundled JAR.
 */
async function ensureProxyMod(instancePath: string): Promise<void> {
  const modsDir = join(instancePath, 'mods')
  if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true })

  const modPath = join(modsDir, PROXY_MOD_FILENAME)
  if (existsSync(modPath)) return // already installed

  const sourcePath = getProxyModSource()
  if (!existsSync(sourcePath)) {
    throw new Error(`Loom Proxy mod not found at ${sourcePath}`)
  }

  const { copyFileSync } = require('fs')
  copyFileSync(sourcePath, modPath)
  console.log(`[Launcher] Loom Proxy mod installed: ${modPath}`)
}

/**
 * Remove the proxy mod from the instance if present.
 */
function removeProxyMod(instancePath: string): void {
  const modsDir = join(instancePath, 'mods')
  // Remove our mod
  const modPath = join(modsDir, PROXY_MOD_FILENAME)
  if (existsSync(modPath)) {
    unlinkSync(modPath)
    console.log(`[Launcher] Proxy mod removed: ${modPath}`)
  }
  // Also clean up old RespectProxyOptions if it was left behind
  const oldMod = join(modsDir, 'loom-respectproxyoptions.jar')
  if (existsSync(oldMod)) {
    unlinkSync(oldMod)
    console.log(`[Launcher] Cleaned up old proxy mod: ${oldMod}`)
  }
}

// ============================================================
// Main Launch Pipeline — Optimized for speed
// ============================================================

export async function launchInstance(id: string) {
  if (currentStatus.running || activeProcess) {
    throw new Error('An instance is already running')
  }

  const instances = getAllInstances()
  const instance = instances.find(i => i.id === id)
  if (!instance) throw new Error('Instance not found')

  const account = getCachedAccount()
  if (!account || !account.accessToken) {
    broadcastStatus({ running: false, error: 'Not logged into Minecraft' })
    throw new Error('Not logged into Minecraft')
  }

  gameLogBuffer.length = 0
  crashAlreadyFired = false
  currentLaunchInstanceId = id
  broadcastStatus({ running: true, progress: 0, task: 'Preparing...', error: '' })
  cancelRequested = false
  const startTime = Date.now()
  console.log(`[Launcher] === LAUNCH START === ${instance.name} (${instance.version}, ${instance.loader || 'Vanilla'})`)
  broadcastLog(`[Launcher] Starting: ${instance.name} (${instance.version}, ${instance.loader || 'Vanilla'})\n`)

  const rootPath = join(app.getPath('userData'), 'minecraft_data')
  if (!existsSync(rootPath)) mkdirSync(rootPath, { recursive: true })
  const instancePath = join(app.getPath('userData'), 'instances', id)
  const versionsDir = join(rootPath, 'versions')

  // Detect first-time download
  const isFirstDownload = !existsSync(versionsDir) || readdirSync(versionsDir).length === 0

  // Read performance settings from store
  const { storeGet } = require('./settings-store')
  const perfJvmFlags = storeGet?.('perf_jvm_flags') ?? true
  const perfHighPriority = storeGet?.('perf_high_priority') ?? true
  const perfPowerPlan = storeGet?.('perf_power_plan') ?? false
  const perfGameSettings = storeGet?.('perf_game_settings') ?? true

  // Use persistent preloaded agent
  const installOptions = { agent: { dispatcher: getAgent() } }

  try {
    // ── PHASE 1: Get version manifest (cached) ──────────────────
    broadcastStatus({ task: 'Checking version...', progress: 5, firstDownload: isFirstDownload })
    broadcastLog('[Launcher] Checking version manifest...\n')
    const { getVersionList } = require('@xmcl/installer')

    if (!cachedMojangVersions || Date.now() - versionCacheTime > VERSION_CACHE_TTL) {
      broadcastLog('[Launcher] Fetching version list from Mojang...\n')
      cachedMojangVersions = await getVersionList()
      versionCacheTime = Date.now()
    } else {
      broadcastLog('[Launcher] Using cached version list.\n')
    }
    const versionMeta = cachedMojangVersions.versions.find((v: any) => v.id === instance.version)
    if (!versionMeta) throw new Error(`Version ${instance.version} not found in Mojang manifest`)

    broadcastStatus({ task: 'Version found', progress: 10 })
    broadcastLog(`[Launcher] Version ${instance.version} found in manifest.\n`)

    if (cancelRequested) throw new Error('Launch cancelled')

    // ── PHASE 2: Install game files (10% → 50%) ────────────────
    const versionJar = join(rootPath, 'versions', instance.version, `${instance.version}.jar`)
    if (existsSync(versionJar)) {
      broadcastStatus({ task: 'Game files verified', progress: 50 })
      broadcastLog('[Launcher] Game files already cached, skipping download.\n')
      console.log('[Launcher] Version jar found, skipping installTask')
    } else {
      broadcastStatus({ task: 'Downloading game files...', progress: 10 })
      broadcastLog('[Launcher] Downloading game files (version jar, assets, libraries)...\n')

      // Start Java download in parallel with game files (different CDNs, no contention)
      const resolvedForJava = await Version.parse(rootPath, instance.version).catch(() => null)
      const javaComp = resolvedForJava?.javaVersion?.component || 'java-runtime-gamma'
      const jreDirEarly = join(rootPath, 'java', javaComp)
      const javaBinEarly = join(jreDirEarly, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      const needsJava = !existsSync(javaBinEarly) && !javaPathCache.has(javaComp)

      const javaPromise = needsJava ? (async () => {
        try {
          broadcastLog('[Launcher] Downloading Java in parallel with game files...\n')
          const { fetchJavaRuntimeManifest, installJavaRuntimeTask } = require('@xmcl/installer')
          const javaManifest = await Promise.race([
            fetchJavaRuntimeManifest({ target: javaComp }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Java manifest timeout')), 30000))
          ]) as any
          await runWithRetries(async () => {
            const jTask = installJavaRuntimeTask({ manifest: javaManifest, destination: jreDirEarly, ...installOptions })
            await runTaskWithProgress(jTask, 'Installing Java', 85, 95)
          }, 3)
          javaPathCache.set(javaComp, javaBinEarly)
          broadcastLog('[Launcher] Java installed (parallel).\n')
        } catch (e: any) {
          broadcastLog(`[Launcher] Parallel Java download failed, will retry later: ${e.message}\n`)
        }
      })() : Promise.resolve()

      await runWithRetries(async () => {
        const mcTask = installTask(versionMeta, rootPath, installOptions)
        await runTaskWithProgress(mcTask, 'Downloading game files', 10, 50)
      })

      // Wait for parallel Java if it was started
      await javaPromise

      broadcastStatus({ task: 'Download complete', progress: 50 })
      broadcastLog('[Launcher] All game files downloaded successfully.\n')
    }

    if (cancelRequested) throw new Error('Launch cancelled')

    // ── PHASE 3: Mod loader (50% → 65%) ─────────────────────────
    if (instance.loader === 'Fabric') {
      broadcastStatus({ task: 'Installing Fabric...', progress: 52 })
      try {
        const { installFabric } = require('@xmcl/installer')
        let loaders = fabricLoaderCache.get(instance.version)
        if (!loaders) {
          broadcastLog('[Launcher] Fetching Fabric loader metadata...\n')
          const { getLoaderArtifactListFor } = require('@xmcl/installer')
          loaders = await getLoaderArtifactListFor(instance.version)
          if (loaders && loaders.length > 0) fabricLoaderCache.set(instance.version, loaders)
        } else {
          broadcastLog('[Launcher] Using cached Fabric metadata.\n')
        }
        if (!loaders || loaders.length === 0) {
          throw new Error('No Fabric loaders found')
        }
        const fabricArtifact = loaders.find((l: any) => l.loader.stable) || loaders[0]
        broadcastStatus({ task: `Installing Fabric ${fabricArtifact.loader.version}...`, progress: 55 })
        broadcastLog(`[Launcher] Installing Fabric loader ${fabricArtifact.loader.version}...\n`)
        await installFabric(fabricArtifact, rootPath, installOptions)
        broadcastStatus({ task: 'Fabric installed', progress: 65 })
        broadcastLog(`[Launcher] Fabric ${fabricArtifact.loader.version} installed successfully.\n`)
      } catch (e: any) {
        throw new Error(`Fabric install failed for ${instance.version}: ${e.message}`)
      }
    } else if (instance.loader === 'Forge') {
      broadcastStatus({ task: 'Installing Forge...', progress: 52 })
      broadcastLog('[Launcher] Fetching Forge version list...\n')
      try {
        const javaBin = await ensureJavaForLoader(rootPath, instance.version)
        const { getForgeVersionList, installForge } = require('@xmcl/installer')
        let forgeVersion: string
        if (instance.loaderVersion) {
          // Use exact version from modpack/instance config
          forgeVersion = instance.loaderVersion
          broadcastLog(`[Launcher] Using pinned Forge version: ${forgeVersion}\n`)
        } else {
          const forgeList = await getForgeVersionList({ minecraft: instance.version })
          forgeVersion = forgeList.versions[0].version
          broadcastLog(`[Launcher] Auto-selected Forge version: ${forgeVersion}\n`)
        }
        broadcastStatus({ task: `Installing Forge ${forgeVersion}...`, progress: 55 })
        broadcastLog(`[Launcher] Installing Forge ${forgeVersion}...\n`)
        await installForge({ mcversion: instance.version, version: forgeVersion }, rootPath, { ...installOptions, java: javaBin })
        broadcastStatus({ task: 'Forge installed', progress: 65 })
        broadcastLog(`[Launcher] Forge ${forgeVersion} installed successfully.\n`)
      } catch (e: any) {
        throw new Error(`Forge does not support version ${instance.version} yet. Try a different version or use Vanilla.`)
      }
    } else if (instance.loader === 'NeoForge') {
      broadcastStatus({ task: 'Installing NeoForge...', progress: 52 })
      broadcastLog('[Launcher] Fetching NeoForge versions...\n')
      try {
        const javaBin = await ensureJavaForLoader(rootPath, instance.version)
        const { installNeoForged } = require('@xmcl/installer')
        let neoForgeVersion: string
        if (instance.loaderVersion) {
          // Use exact version from modpack/instance config
          neoForgeVersion = instance.loaderVersion
          broadcastLog(`[Launcher] Using pinned NeoForge version: ${neoForgeVersion}\n`)
        } else {
          // Auto-detect: Determine NeoForge version prefix from MC version
          // MC 1.20.1 -> NeoForge 20.1.x, MC 1.21.1 -> NeoForge 21.1.x
          const mcParts = instance.version.split('.')
          const neoPrefix = `${mcParts[1]}.${mcParts[2] || '0'}`
          const res = await net.fetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml')
          const xml = await res.text()
          const versionMatches = xml.match(/<version>([^<]+)<\/version>/g) || []
          const allVersions = versionMatches.map((m: string) => m.replace(/<\/?version>/g, ''))
          const compatible = allVersions
            .filter((v: string) => v.startsWith(neoPrefix + '.'))
            .sort((a: string, b: string) => {
              // Numeric version comparison: 21.1.172 > 21.1.99
              const aParts = a.split('.').map(Number)
              const bParts = b.split('.').map(Number)
              for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                const diff = (bParts[i] || 0) - (aParts[i] || 0)
                if (diff !== 0) return diff
              }
              return 0
            })
          if (compatible.length === 0) {
            throw new Error(`No NeoForge versions found for MC ${instance.version}`)
          }
          neoForgeVersion = compatible[0]
          broadcastLog(`[Launcher] Auto-selected NeoForge version: ${neoForgeVersion}\n`)
        }
        broadcastStatus({ task: `Installing NeoForge ${neoForgeVersion}...`, progress: 55 })
        broadcastLog(`[Launcher] Installing NeoForge ${neoForgeVersion}...\n`)
        await installNeoForged('neoforge', neoForgeVersion, rootPath, { ...installOptions, java: javaBin })
        broadcastStatus({ task: 'NeoForge installed', progress: 65 })
        broadcastLog(`[Launcher] NeoForge ${neoForgeVersion} installed successfully.\n`)
      } catch (e: any) {
        throw new Error(`NeoForge install failed for ${instance.version}: ${e.message}`)
      }
    } else if (instance.loader === 'Quilt') {
      broadcastStatus({ task: 'Installing Quilt...', progress: 52 })
      broadcastLog('[Launcher] Fetching Quilt loader versions...\n')
      try {
        const { getQuiltVersionsList, installQuiltVersion } = require('@xmcl/installer')
        let quiltVersion: string
        if (instance.loaderVersion) {
          quiltVersion = instance.loaderVersion
          broadcastLog(`[Launcher] Using pinned Quilt version: ${quiltVersion}\n`)
        } else {
          const quiltVersions = await getQuiltVersionsList()
          if (!quiltVersions || quiltVersions.length === 0) {
            throw new Error('No Quilt loader versions found')
          }
          quiltVersion = quiltVersions[0].version
          broadcastLog(`[Launcher] Auto-selected Quilt version: ${quiltVersion}\n`)
        }
        broadcastStatus({ task: `Installing Quilt ${quiltVersion}...`, progress: 55 })
        broadcastLog(`[Launcher] Installing Quilt ${quiltVersion}...\n`)
        await installQuiltVersion({
          minecraftVersion: instance.version,
          version: quiltVersion,
          minecraft: rootPath,
        })
        broadcastStatus({ task: 'Quilt installed', progress: 65 })
        broadcastLog(`[Launcher] Quilt ${quiltVersion} installed successfully.\n`)
      } catch (e: any) {
        throw new Error(`Quilt install failed for ${instance.version}: ${e.message}`)
      }
    } else {
      broadcastStatus({ task: 'Vanilla — no mod loader needed', progress: 65 })
      broadcastLog('[Launcher] Vanilla instance, no mod loader to install.\n')
    }

    if (cancelRequested) throw new Error('Launch cancelled')

    // ── PHASE 4: Resolve version & install libs (65% → 80%) ─────
    let resolvedVersionId = instance.version
    if (instance.loader && instance.loader !== 'Vanilla') {
      broadcastStatus({ task: 'Resolving mod loader version...', progress: 66 })
      broadcastLog('[Launcher] Resolving mod loader version ID...\n')
      const allVersions = existsSync(versionsDir) ? readdirSync(versionsDir) : []
      if (instance.loader === 'Fabric') {
        const match = allVersions.find((v: string) => v.includes('fabric') && v.startsWith(instance.version + '-'))
        if (match) resolvedVersionId = match
      } else if (instance.loader === 'Forge') {
        const match = allVersions.find((v: string) => v.includes('forge') && v.startsWith(instance.version + '-'))
        if (match) resolvedVersionId = match
      } else if (instance.loader === 'NeoForge') {
        const match = allVersions.find((v: string) => v.includes('neoforge') && (v.startsWith(instance.version + '-') || v.startsWith('neoforge-')))
        if (match) resolvedVersionId = match
      } else if (instance.loader === 'Quilt') {
        const match = allVersions.find((v: string) => v.includes('quilt') && v.startsWith(instance.version + '-'))
        if (match) resolvedVersionId = match
      }
      broadcastLog(`[Launcher] Resolved version: ${resolvedVersionId}\n`)

      // Libraries and Java check in parallel
      broadcastStatus({ task: 'Installing libraries & checking Java...', progress: 68 })
      const libsPromise = runWithRetries(async () => {
        broadcastLog('[Launcher] Downloading mod loader libraries...\n')
        const resolvedVer = await Version.parse(rootPath, resolvedVersionId)
        const { installLibrariesTask } = require('@xmcl/installer')
        const libsTask = installLibrariesTask(resolvedVer, installOptions)
        await runTaskWithProgress(libsTask, 'Installing Libraries', 68, 80)
        broadcastLog('[Launcher] All libraries installed.\n')
      })

      await libsPromise
      broadcastStatus({ task: 'Libraries installed', progress: 80 })
    } else {
      broadcastStatus({ progress: 80 })
    }

    // ── PHASE 5: Java runtime (80% → 95%) ───────────────────────
    broadcastStatus({ task: 'Checking Java...', progress: 82 })
    broadcastLog('[Launcher] Checking Java runtime...\n')
    const resolvedVersion = await Version.parse(rootPath, resolvedVersionId)
    const javaComponent = resolvedVersion.javaVersion?.component || 'java-runtime-gamma'
    const jreDir = join(rootPath, 'java', javaComponent)
    let javaBin = join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')

    // Use preloaded cache first (avoids filesystem check)
    const cachedJava = javaPathCache.get(javaComponent)
    if (cachedJava && existsSync(cachedJava)) {
      javaBin = cachedJava
      broadcastStatus({ task: 'Java ready', progress: 95 })
      broadcastLog(`[Launcher] Java (${javaComponent}) found in cache.\n`)
    } else if (!existsSync(javaBin)) {
      broadcastStatus({ task: 'Downloading Java...', progress: 83 })
      broadcastLog(`[Launcher] Java (${javaComponent}) not found, downloading...\n`)
      console.log('[Launcher] Fetching Java manifest for:', javaComponent)

      const { fetchJavaRuntimeManifest, installJavaRuntimeTask } = require('@xmcl/installer')
      broadcastLog('[Launcher] Fetching Java manifest from Mojang...\n')
      const manifestPromise = fetchJavaRuntimeManifest({ target: javaComponent })
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Java manifest fetch timed out')), 30000)
      )
      const javaManifest = await Promise.race([manifestPromise, timeoutPromise]) as any
      broadcastLog(`[Launcher] Java ${javaManifest.version.name} manifest received (${Object.keys(javaManifest.files).length} files).\n`)
      broadcastStatus({ task: `Installing Java ${javaManifest.version.name}...`, progress: 85 })

      await runWithRetries(async () => {
        const javaTask = installJavaRuntimeTask({
          manifest: javaManifest,
          destination: jreDir,
          ...installOptions
        })
        await runTaskWithProgress(javaTask, 'Installing Java', 85, 95)
      }, 3)
      javaPathCache.set(javaComponent, javaBin)
      broadcastStatus({ task: 'Java installed', progress: 95 })
      broadcastLog('[Launcher] Java runtime installed successfully.\n')
    } else {
      javaPathCache.set(javaComponent, javaBin)
      broadcastStatus({ task: 'Java ready', progress: 95 })
      broadcastLog(`[Launcher] Java (${javaComponent}) found locally.\n`)
    }

    if (cancelRequested) throw new Error('Launch cancelled')

    // ── PHASE 5.5: Performance mods (auto-install if enabled) ───
    if (instance.loader && instance.loader.toLowerCase() !== 'vanilla') {
      try {
        broadcastStatus({ task: 'Checking performance mods...', progress: 96 })
        const perfEnabled = readPerfModpackSetting()
        await installPerformanceMods(id, instance.version, instance.loader, perfEnabled)
        if (perfEnabled) {
          broadcastLog('[Launcher] Performance mods check complete.\n')
        }
      } catch (err: any) {
        broadcastLog(`[Launcher] Performance mods warning: ${err.message}\n`)
      }
    }

    if (cancelRequested) throw new Error('Launch cancelled')

    // ── PHASE 6: Launch (95% → 100%) ────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    broadcastStatus({ task: 'Starting Minecraft...', progress: 98 })
    broadcastLog(`[Launcher] All files ready in ${elapsed}s. Launching game...\n`)
    console.log(`[Launcher] Pipeline complete in ${elapsed}s, spawning JVM`)

    // ── Incognito: proxy mod + JVM args ────────────────────────
    const extraJVMArgs: string[] = []

    // ── Performance JVM flags (Aikar's flags — industry standard for MC) ──
    extraJVMArgs.push(
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:+AlwaysPreTouch',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1',
      // Additional performance flags
      '-Dfile.encoding=UTF-8',
      '-Djava.net.preferIPv4Stack=true',
      '-XX:+UseStringDeduplication',
      '-XX:+OptimizeStringConcat',
    )

    // ── Network JVM flags (Netty optimization) ──
    const perfNetwork = storeGet?.('perf_network') ?? false
    if (perfNetwork) {
      extraJVMArgs.push(
        '-Dio.netty.buffer.checkAccessible=false',
        '-Dio.netty.buffer.checkBounds=false',
      )
      console.log('[Launcher] Network JVM flags enabled')
    }

    const isModded = instance.loader && instance.loader !== 'vanilla'

    if (account.incognitoEnabled && account.incognitoRegion && isModded) {
      // Install proxy mod and inject JVM args
      broadcastStatus({ task: 'Setting up incognito...', progress: 97 })
      try {
        await ensureProxyMod(instancePath)
        broadcastLog('[Launcher] RespectProxyOptions mod ready\n')
      } catch (modErr: any) {
        broadcastLog(`[Launcher] Warning: Could not install proxy mod: ${modErr.message}\n`)
      }

      const proxyArgs = getProxyJvmArgs(account.incognitoRegion)
      if (proxyArgs.length > 0) {
        extraJVMArgs.push(...proxyArgs)
        broadcastLog(`[Launcher] Incognito ON — routing through ${account.incognitoRegion}\n`)
        console.log(`[Launcher] Incognito: ${account.incognitoRegion} proxy args injected`)
      }
    } else {
      // Not incognito — remove proxy mod if it was left behind
      removeProxyMod(instancePath)
    }

    // ── Dynamic Island — Multi-version deployment ──────────────
    if (instance.loader && (instance.loader.toLowerCase() === 'fabric' || instance.loader.toLowerCase() === 'quilt')) {
      try {
        const ver = instance.version
        const modDest = join(instancePath, 'mods', 'dynamic-island-1.0.0.jar')

        // Determine which mod build to use based on MC version
        let modDir: string | null = null
        if (ver.startsWith('1.21.11')) {
          modDir = 'dynamic-island-1.21.11'  // 1.21.11 build
        } else if (ver.startsWith('1.21.1') || ver === '1.21') {
          modDir = 'dynamic-island'        // 1.21.x build
        } else if (ver.startsWith('1.20')) {
          modDir = 'dynamic-island-1.20'   // 1.20.x build
        }

        if (!modDir) {
          // Incompatible version — remove if previously installed
          if (existsSync(modDest)) {
            unlinkSync(modDest)
            broadcastLog(`[Launcher] Removed incompatible Dynamic Island mod from ${instance.name}\n`)
          }
        } else {
          const modSource = join(app.getAppPath(), 'mods', modDir, 'build', 'libs', 'dynamic-island-1.0.0.jar')
          broadcastLog(`[Launcher] Dynamic Island: using ${modDir} build for MC ${ver}\n`)
          if (existsSync(modSource)) {
            if (!existsSync(join(instancePath, 'mods'))) {
              mkdirSync(join(instancePath, 'mods'), { recursive: true })
            }
            copyFileSync(modSource, modDest)
            broadcastLog('[Launcher] Dynamic Island mod auto-installed.\n')
          } else {
            broadcastLog(`[Launcher] Dynamic Island mod NOT FOUND at ${modSource}\n`)
          }
        }
      } catch (err) {
        broadcastLog(`[Launcher] Could not install Dynamic Island mod: ${err}\n`)
      }
    }

    // ── Per-instance JVM args ────────────────────────────────
    if (instance.jvmArgs) {
      const userArgs = instance.jvmArgs.split(/\s+/).filter(Boolean)
      extraJVMArgs.push(...userArgs)
      broadcastLog(`[Launcher] Custom JVM args: ${userArgs.join(' ')}\n`)
    }

    // ── Write optimized game settings for new instances ─────
    if (perfGameSettings) {
      writeOptimizedGameSettings(instancePath)
    }

    const memMax = instance.memoryMax || 4096
    const memMin = memMax  // Aikar: match -Xms to -Xmx to avoid heap growth pauses

    activeProcess = await launch({
      gamePath: instancePath,
      resourcePath: rootPath,
      javaPath: javaBin,
      version: resolvedVersionId,
      minMemory: memMin,
      maxMemory: memMax,
      gameProfile: {
        id: account.uuid,
        name: account.username,
      },
      accessToken: account.accessToken,
      userType: 'msa',
      properties: {},
      extraJVMArgs,
    })

    activeProcess.stdout?.on('data', (b) => broadcastLog(b.toString()))
    activeProcess.stderr?.on('data', (b) => broadcastLog(b.toString()))

    activeProcess.on('error', (err) => {
      broadcastLog(`[Launcher] Process error: ${err.message}\n`)
      broadcastStatus({ running: false, progress: 0, error: `Java process error: ${err.message}` })
      activeProcess = null
    })

    activeProcess.on('spawn', () => {
      broadcastLog('[Launcher] Game process spawned!\n')
      broadcastStatus({ running: true, task: 'Game Running', progress: 100 })

      // Set process priority to HIGH for better CPU scheduling
      if (perfHighPriority) {
        try {
          if (activeProcess?.pid && process.platform === 'win32') {
            const { execSync } = require('child_process')
            execSync(`wmic process where ProcessId=${activeProcess.pid} CALL setpriority "high priority"`, { stdio: 'ignore' })
            broadcastLog('[Launcher] Process priority set to HIGH.\n')
          }
        } catch { /* non-critical */ }
      }

      // Switch to High Performance power plan if enabled
      if (perfPowerPlan) {
        setHighPerformancePowerPlan()
        broadcastLog('[Launcher] Power plan set to High Performance.\n')
      }

      // Watch the game's latest.log file for crash patterns not caught by stdout
      const logFilePath = join(instancePath, 'logs', 'latest.log')

      const logWatcher = setInterval(() => {
        if (crashAlreadyFired) { clearInterval(logWatcher); return }
        try {
          if (!existsSync(logFilePath)) return
          const content = readFileSync(logFilePath, 'utf-8')
          const lines = content.split('\n')

          // Scan the last 100 lines for error patterns
          const tail = lines.slice(-100)
          for (const line of tail) {
            if (!crashAlreadyFired && line.length > 0) {
              checkLineForCrash(line)
            }
          }

        } catch { /* ignore log read errors */ }
      }, 3000)

      // Clean up watcher when process exits
      activeProcess?.on('exit', () => clearInterval(logWatcher))

      // Set Discord Rich Presence
      setPlayingMinecraft(instance.name, instance.version, instance.loader || 'Vanilla')
      // Start Dynamic Island overlay server (WebSocket for mod)
      startDynamicIslandServer()
      sendNotification(`Playing ${instance.name}`)
    })

    activeProcess.on('exit', (code) => {
      broadcastLog(`[Launcher] Game exited (code ${code})\n`)
      activeProcess = null
      broadcastStatus({ running: false, progress: 0, task: `Exited (code ${code})` })
      // Clear Discord Rich Presence
      clearPlayingMinecraft()
      // Stop Dynamic Island overlay server
      stopDynamicIslandServer()
      // Restore power plan if it was changed
      if (perfPowerPlan) {
        restoreDefaultPowerPlan()
        broadcastLog('[Launcher] Power plan restored.\n')
      }
      // Auto-diagnose crashes on non-zero exit
      if (code !== null && code !== 0) {
        detectCrash()
      }
    })

  } catch (err: any) {
    activeProcess = null
    console.error('Launch Error:', err)
    if (err.errors) console.error('Sub-errors:', err.errors)
    if (cancelRequested) {
      broadcastStatus({ running: false, progress: 0, task: '' })
    } else {
      broadcastStatus({ running: false, progress: 0, error: err.message || 'Launch failed' })
    }
  }
}

export function killInstance() {
  cancelRequested = true
  if (activeProcess) {
    activeProcess.kill()
    activeProcess = null
  }
  broadcastStatus({ running: false, progress: 0, task: 'Stopped' })
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
  }
}

export function getLaunchStatus() {
  return currentStatus
}

function detectCrash(): void {
  if (crashAlreadyFired) return
  const logs = gameLogBuffer.join('\n')
  let type: string | null = null
  let details = ''

  if (logs.includes('java.lang.OutOfMemoryError')) {
    type = 'out_of_memory'
    details = 'The game ran out of memory. Try increasing the allocated RAM in instance settings.'
  } else if (logs.includes('Error loading mods') || logs.includes('fml.modloadingissue')) {
    type = 'incompatible_mods'
    // Try to extract which mod is incompatible (NeoForge format)
    const incompMatch = logs.match(/Mod\s+(\w+)\s+is\s+incompatible\s+with\s+(\w+)/i)
    if (incompMatch) {
      details = `Mod '${incompMatch[1]}' is incompatible with '${incompMatch[2]}'. One of them needs to be removed.`
    } else {
      const errorMatch = logs.match(/(\d+)\s+error(?:s)?\s+(?:has|have)\s+occurred/i)
      details = errorMatch
        ? `${errorMatch[1]} mod loading error(s) occurred. There are incompatible or broken mods.`
        : 'Mod loading errors detected. There are incompatible or broken mods.'
    }
  } else if (logs.includes('ModResolutionException')) {
    type = 'mod_resolution'
    const match = logs.match(/ModResolutionException:(.+)/)
    details = match ? `Mod resolution failed: ${match[1].trim()}` : 'Mod resolution failed — there may be conflicting or incompatible mods.'
  } else if (logs.includes('Incompatible mods found')) {
    type = 'incompatible_mods'
    details = 'Incompatible mods were detected. Some installed mods conflict with each other.'
  } else if (logs.includes('requires version') && logs.includes('which is missing')) {
    type = 'missing_dependency'
    const match = logs.match(/Mod\s+'([^']+)'\s+requires.*?mod\s+'([^']+)'.*?version\s+([^\s,]+).*?which is missing/i)
    if (match) {
      details = `Mod '${match[1]}' requires '${match[2]}' version ${match[3]}, which is not installed.`
    } else {
      details = 'A mod is missing a required dependency.'
    }
  } else if (logs.includes('requires version') && logs.includes('wrong version is present')) {
    type = 'wrong_java'
    details = 'A mod requires a different Java version than what is currently being used.'
  } else if (logs.includes('CrashReport') || logs.includes('crash-reports')) {
    type = 'generic_crash'
    const match = logs.match(/Description:\s*(.+)/)
    details = match ? `Crash: ${match[1].trim()}` : 'The game crashed. Check the crash report for details.'
  }

  if (type && mainWindow && !mainWindow.isDestroyed()) {
    crashAlreadyFired = true
    const rawLogs = gameLogBuffer.slice(-50)
    mainWindow.webContents.send('loomie:crash-detected', {
      type,
      instanceId: currentLaunchInstanceId,
      details,
      rawLogs,
    })
    console.log(`[Launcher] Crash detected: ${type} — ${details}`)
  }
}
