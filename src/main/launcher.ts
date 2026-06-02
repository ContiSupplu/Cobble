import { app, BrowserWindow, ipcMain, net } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, copyFileSync, statSync } from 'fs'
import dns from 'dns'
import { execSync } from 'child_process'
import { installTask, getVersionList, installFabric, getLoaderArtifactListFor, fetchJavaRuntimeManifest, installJavaRuntimeTask, installLibrariesTask, getForgeVersionList, installForge, installNeoForged, getQuiltVersionsList, installQuiltVersion } from '@xmcl/installer'
import { launch, Version } from '@xmcl/core'
import { Task } from '@xmcl/task'
import { ChildProcess } from 'child_process'
import { getCachedAccount, restoreSession, switchAccount } from './auth'
import { startDynamicIslandServer, stopDynamicIslandServer, sendNotification, getSessionToken } from './dynamic-island-server'
import { getAllInstances, computeModsHash, markLaunchReady, getInstancePath } from './instances'
import { getProxyJvmArgs } from './proxy-config'
import { setPlayingMinecraft, clearPlayingMinecraft } from './discord'
import { setHighPerformancePowerPlan, restoreDefaultPowerPlan, writeOptimizedGameSettings } from './system-optimizations'
import { installPerformanceMods } from './performance-mods'
import { autoBackup } from './backups'
import { storeGet, storeSet } from './settings-store'
import { syncToInstance, syncFromInstance } from './file-sync'
import { getFFmpegPath, downloadFFmpeg } from './recording'

// ============================================================
// Windows Defender Exclusion — Opt-in prompt
// ============================================================

/**
 * Check if Windows Defender real-time protection is active by looking
 * for the MsMpEng.exe process. This is faster and doesn't require
 * elevated privileges (unlike Get-MpPreference).
 */
function isDefenderActive(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const output = execSync(
      'tasklist /FI "IMAGENAME eq MsMpEng.exe" /NH',
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    )
    return output.includes('MsMpEng.exe')
  } catch {
    return false
  }
}

/**
 * Check which paths are already excluded from Defender scanning.
 * Uses Get-MpPreference which works without elevation for reads.
 */
function getDefenderExclusionPaths(): string[] {
  if (process.platform !== 'win32') return []
  try {
    const output = execSync(
      'powershell -NoProfile -Command "(Get-MpPreference).ExclusionPath -join \'||\'"',
      { encoding: 'utf8', timeout: 10000, windowsHide: true }
    )
    return output.trim().split('||').map(p => p.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Check if a path (or any parent of it) is already covered by an
 * existing Defender exclusion.
 */
function isPathExcluded(targetPath: string, exclusions: string[]): boolean {
  const normTarget = targetPath.replace(/\//g, '\\').toLowerCase()
  return exclusions.some(exc => {
    const normExc = exc.replace(/\//g, '\\').toLowerCase()
    return normTarget.startsWith(normExc)
  })
}

/**
 * Apply Defender exclusions for the given paths via elevated PowerShell.
 * Returns true if the UAC prompt was accepted and the command succeeded.
 */
async function applyDefenderExclusions(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true
  try {
    const exclusionArgs = paths.map(p => `-ExclusionPath \\"${p}\\"`).join(' ')
    const cmd = `powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','Add-MpPreference ${exclusionArgs}' -Wait"`
    const { exec } = require('child_process')
    await new Promise<void>((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (err: any) => {
        if (err) reject(err)
        else resolve()
      })
    })
    console.log('[Defender] Exclusions applied:', paths)
    return true
  } catch (err: any) {
    console.warn('[Defender] Failed to apply exclusions (user may have declined UAC):', err.message)
    return false
  }
}

// Pending Defender prompt resolution — allows the IPC handler to resolve the user's choice
let defenderPromptResolve: ((approved: boolean) => void) | null = null

/**
 * Register the IPC handler for the renderer's Defender exclusion response.
 * Called once during module initialization.
 */
function registerDefenderIPC(): void {
  ipcMain.handle('defender:userResponse', (_e, approved: boolean) => {
    if (defenderPromptResolve) {
      defenderPromptResolve(approved)
      defenderPromptResolve = null
    }
    return true
  })
}

// Register on module load
registerDefenderIPC()

/**
 * Check if Windows Defender is scanning game files, and offer the user
 * an opt-in prompt to exclude the instance and JRE paths.
 *
 * Flow:
 * 1. Skip on non-Windows or if user already made a choice
 * 2. Check if Defender is active
 * 3. Check if paths are already excluded
 * 4. Send IPC prompt to renderer, wait for response
 * 5. If approved, run elevated PowerShell to add exclusions
 * 6. Store the user's choice so we don't ask again
 *
 * @param instancePath - The instance folder to potentially exclude
 */
export async function checkAndOfferDefenderExclusion(instancePath: string): Promise<void> {
  // Skip entirely on non-Windows platforms
  if (process.platform !== 'win32') return

  const startTime = Date.now()
  console.log('[Defender] Checking Windows Defender exclusion status...')

  // Check if user already made a choice (don't ask again)
  const userChoice = storeGet('defender_exclusion_choice') as string | undefined
  if (userChoice === 'declined' || userChoice === 'applied') {
    console.log(`[Defender] User previously ${userChoice}, skipping prompt`)
    return
  }

  // Check if Defender is active
  if (!isDefenderActive()) {
    console.log('[Defender] Windows Defender not active, skipping')
    return
  }

  // Gather paths to potentially exclude
  const rootPath = join(app.getPath('userData'), 'minecraft_data')
  const javaDir = join(rootPath, 'java')
  const instancesDir = join(app.getPath('userData'), 'instances')

  // Check existing exclusions
  const existingExclusions = getDefenderExclusionPaths()
  const pathsToExclude: string[] = []

  if (!isPathExcluded(instancesDir, existingExclusions)) {
    pathsToExclude.push(instancesDir)
  }
  if (!isPathExcluded(javaDir, existingExclusions)) {
    pathsToExclude.push(javaDir)
  }
  if (!isPathExcluded(rootPath, existingExclusions)) {
    // If rootPath isn't excluded, it covers both java and game data
    // Replace individual paths with the parent
    pathsToExclude.length = 0
    pathsToExclude.push(rootPath, instancesDir)
  }

  if (pathsToExclude.length === 0) {
    console.log('[Defender] All game paths already excluded from Defender scanning')
    storeSet('defender_exclusion_choice', 'applied')
    return
  }

  const elapsed = Date.now() - startTime
  console.log(`[Defender] Detection took ${elapsed}ms. ${pathsToExclude.length} path(s) need exclusion`)

  // Send prompt to renderer and wait for user response
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log('[Defender] No window available for prompt, skipping')
    return
  }

  const userApproved = await new Promise<boolean>((resolve) => {
    defenderPromptResolve = resolve

    mainWindow!.webContents.send('defender:exclusionPrompt', {
      paths: pathsToExclude,
      reason: 'Minecraft loads thousands of .class and .jar files at startup. ' +
              'Excluding these folders from Windows Defender real-time scanning ' +
              'can speed up game launches by several seconds.',
    })

    // Auto-decline after 60 seconds if user doesn't respond (don't block launch forever)
    setTimeout(() => {
      if (defenderPromptResolve) {
        console.log('[Defender] Prompt timed out after 60s, treating as declined')
        defenderPromptResolve(false)
        defenderPromptResolve = null
      }
    }, 60_000)
  })

  if (!userApproved) {
    console.log('[Defender] User declined Defender exclusion')
    storeSet('defender_exclusion_choice', 'declined')
    broadcastLog('[Launcher] Windows Defender exclusion skipped (user choice)\n')
    return
  }

  // User approved — apply exclusions via elevated PowerShell
  broadcastLog('[Launcher] Applying Windows Defender exclusions (admin prompt may appear)...\n')
  const success = await applyDefenderExclusions(pathsToExclude)

  if (success) {
    storeSet('defender_exclusion_choice', 'applied')
    broadcastLog('[Launcher] ✓ Windows Defender exclusions applied — future launches will be faster\n')
    console.log('[Defender] Exclusions applied successfully')
  } else {
    // Don't store 'declined' — let user retry next launch
    broadcastLog('[Launcher] Windows Defender exclusion failed (admin rights needed)\n')
    console.log('[Defender] Exclusion application failed')
  }
}

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
    persistentAgent = new Agent({
      connections: 256,
      pipelining: 4,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      connect: { timeout: 10_000 },
    })
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
  
  // Download Java — reuse the persistent agent for speed
  console.log(`[Launcher] Pre-downloading Java (${javaComponent}) for mod loader install...`)
  // fetchJavaRuntimeManifest, installJavaRuntimeTask — from static import
  const javaManifest = await fetchJavaRuntimeManifest({ target: javaComponent, dispatcher: getAgent() })
  const javaTask = installJavaRuntimeTask({
    manifest: javaManifest,
    destination: jreDir,
    agent: { dispatcher: getAgent() },
    dispatcher: getAgent(),
  })
  await javaTask.startAndWait()
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
    // getVersionList — from static import
    cachedMojangVersions = await getVersionList({ dispatcher: getAgent() })
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
      // getLoaderArtifactListFor — from static import
      await Promise.all(fabricVersions.map(async (ver) => {
        try {
          const loaders = await getLoaderArtifactListFor(ver, { dispatcher: getAgent() })
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

// ============================================================
// Page Cache Pre-warming — read instance files into OS cache
// ============================================================

let activePrewarmAbort: AbortController | null = null

/**
 * Pre-warm the OS page cache for an instance by sequentially reading
 * its key files (JARs, libraries, mods) into memory. This means when
 * the JVM actually loads them, they come from RAM instead of disk.
 *
 * Called when user selects/hovers an instance — uses idle time before Play.
 * Fire-and-forget, abortable if user switches to a different instance.
 */
export async function prewarmInstanceCache(instanceId: string): Promise<void> {
  // Abort any previous prewarm in progress
  if (activePrewarmAbort) {
    activePrewarmAbort.abort()
    activePrewarmAbort = null
  }

  const abort = new AbortController()
  activePrewarmAbort = abort

  try {
    const instancePath = getInstancePath(instanceId)
    const rootPath = join(app.getPath('userData'), 'minecraft_data')
    const modsDir = join(instancePath, 'mods')
    const buf = Buffer.alloc(64 * 1024) // 64KB read buffer
    let filesWarmed = 0
    let bytesRead = 0

    // Helper: read a file sequentially to warm it into OS cache
    const warmFile = (filePath: string) => {
      if (abort.signal.aborted) return
      try {
        const fd = require('fs').openSync(filePath, 'r')
        try {
          let n = 1
          while (n > 0 && !abort.signal.aborted) {
            n = require('fs').readSync(fd, buf, 0, buf.length, null)
            bytesRead += n
          }
          filesWarmed++
        } finally {
          require('fs').closeSync(fd)
        }
      } catch { /* skip unreadable files */ }
    }

    console.log(`[Prewarm] Starting cache warm for ${instanceId}`)

    // 1. Warm mod JARs (most impactful — these are loaded by Fabric)
    if (existsSync(modsDir)) {
      const mods = readdirSync(modsDir).filter(f => f.endsWith('.jar'))
      for (const mod of mods) {
        if (abort.signal.aborted) break
        warmFile(join(modsDir, mod))
      }
    }

    // 2. Warm the version JAR
    if (!abort.signal.aborted) {
      const instances = getAllInstances()
      const instance = instances.find(i => i.id === instanceId)
      if (instance) {
        const versionJar = join(rootPath, 'versions', instance.version, `${instance.version}.jar`)
        if (existsSync(versionJar)) warmFile(versionJar)
      }
    }

    if (!abort.signal.aborted) {
      console.log(`[Prewarm] Warmed ${filesWarmed} files (${Math.round(bytesRead / 1024 / 1024)}MB) into OS cache`)
    }
  } catch (err: any) {
    if (!abort.signal.aborted) {
      console.log(`[Prewarm] Cache warm failed: ${err.message}`)
    }
  } finally {
    if (activePrewarmAbort === abort) {
      activePrewarmAbort = null
    }
  }
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
        await new Promise(r => setTimeout(r, 200))
      }
    }
  }
  throw lastErr
}

// ============================================================
// WATERMeDIA — Auto-install for in-game media viewer
// ============================================================

const WATERMEDIA_MODS = [
  { slug: 'watermedia', name: 'WATERMeDIA', pinnedVersion: '2.1.37' },
  { slug: 'watermedia-yt-plugin', name: 'WATERMeDIA: YouTube Extension', pinnedVersion: '2.1.2' },
]

/**
 * Auto-download WATERMeDIA from Modrinth if not present in the instance mods folder.
 * Pins to v2.1.37 because our mod is compiled against that API (v3 is incompatible).
 */
async function ensureWatermediaMods(instancePath: string, mcVersion: string): Promise<void> {
  const modsDir = join(instancePath, 'mods')
  if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true })

  for (const mod of WATERMEDIA_MODS) {
    // Check for existing jars of this mod
    const existingFiles = readdirSync(modsDir).filter(f =>
      f.toLowerCase().includes(mod.slug.replace(/-/g, '')) && f.endsWith('.jar')
      || f.toLowerCase().includes(mod.slug) && f.endsWith('.jar')
    )

    // Note: v3.x removal is handled below AFTER checking if v2.x is available on Modrinth

    // Re-check after cleanup — see if a valid version is already installed
    const validFiles = readdirSync(modsDir).filter(f => {
      const lower = f.toLowerCase()
      const matchesSlug = lower.includes(mod.slug.replace(/-/g, '')) || lower.includes(mod.slug)
      return matchesSlug && f.endsWith('.jar')
    })
    if (validFiles.length > 0) {
      console.log(`[Launcher] ${mod.name} already present: ${validFiles[0]}`)
      continue
    }

    try {
      console.log(`[Launcher] Downloading ${mod.name}${mod.pinnedVersion ? ' v' + mod.pinnedVersion : ''} from Modrinth...`)

      // Query Modrinth for compatible version
      const { net: electronNet } = require('electron')
      const versionsUrl = `https://api.modrinth.com/v2/project/${mod.slug}/version?loaders=["fabric"]&game_versions=["${mcVersion}"]`
      const res = await electronNet.fetch(versionsUrl, {
        headers: { 'User-Agent': 'Cobble-Launcher/1.0 (contact@cobble.gg)' }
      })

      if (!res.ok) {
        console.log(`[Launcher] ${mod.name}: Modrinth API returned ${res.status}, skipping`)
        continue
      }

      const versions = await res.json() as any[]
      if (!versions || versions.length === 0) {
        console.log(`[Launcher] ${mod.name}: No compatible version found for MC ${mcVersion}`)
        continue
      }

      let latestVersion: any = null
      if (mod.pinnedVersion) {
        // Prefer pinned v2.x if available
        latestVersion = versions.find((v: any) => v.version_number === mod.pinnedVersion)
          || versions.find((v: any) => v.version_number.startsWith('2.'))
        if (!latestVersion) {
          // v2.x not available for this MC version — accept v3.x rather than looping
          console.log(`[Launcher] ${mod.name}: pinned v${mod.pinnedVersion} not available, using latest`)
          latestVersion = versions[0]
        }
      }
      if (!latestVersion) {
        latestVersion = versions[0]
      }

      // Only remove incompatible v3.x if we found a working v2.x to replace it with
      const isDowngradingToV2 = latestVersion.version_number.startsWith('2.')
      if (isDowngradingToV2) {
        const v3Files = readdirSync(modsDir).filter(f =>
          (f.toLowerCase().includes(mod.slug.replace(/-/g, '')) || f.toLowerCase().includes(mod.slug))
          && f.endsWith('.jar') && (f.includes('3.0') || f.includes('3.1') || f.includes('3.2'))
        )
        for (const file of v3Files) {
          console.log(`[Launcher] Removing incompatible ${file} (replacing with v2.x)`)
          try { unlinkSync(join(modsDir, file)) } catch {}
        }
      }

      const primaryFile = latestVersion.files?.find((f: any) => f.primary) || latestVersion.files?.[0]
      if (!primaryFile?.url) {
        console.log(`[Launcher] ${mod.name}: No download URL found`)
        continue
      }

      // Download the JAR
      const downloadRes = await electronNet.fetch(primaryFile.url)
      if (!downloadRes.ok) {
        console.log(`[Launcher] ${mod.name}: Download failed (${downloadRes.status})`)
        continue
      }

      const buffer = Buffer.from(await downloadRes.arrayBuffer())

      // Verify SHA-512 hash if provided by Modrinth
      const expectedHash = primaryFile.hashes?.sha512
      if (expectedHash) {
        const actualHash = createHash('sha512').update(buffer).digest('hex')
        if (actualHash !== expectedHash) {
          console.log(`[Launcher] ${mod.name}: Hash mismatch! Expected: ${expectedHash.substring(0, 16)}... Got: ${actualHash.substring(0, 16)}...`)
          continue
        }
        console.log(`[Security] Hash verified: ${mod.name}`)
      }

      const destFilename = primaryFile.filename || `${mod.slug}-${latestVersion.version_number}.jar`
      const destPath = join(modsDir, destFilename)
      writeFileSync(destPath, buffer)

      console.log(`[Launcher] ${mod.name} v${latestVersion.version_number} installed: ${destFilename}`)
    } catch (err: any) {
      console.log(`[Launcher] ${mod.name} auto-install failed: ${err.message}`)
    }
  }
}

// ============================================================
// MCEF — Auto-install for in-game browser
// ============================================================

/**
 * Auto-download MCEF from Modrinth if not present in the instance mods folder.
 * MCEF enables Chromium-based web rendering inside Minecraft.
 */
async function ensureMcefMod(instancePath: string, mcVersion: string): Promise<void> {
  const modsDir = join(instancePath, 'mods')
  if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true })

  // Check if any MCEF variant is already installed
  const existingFiles = readdirSync(modsDir).filter(f =>
    f.toLowerCase().includes('mcef') && f.endsWith('.jar')
  )
  if (existingFiles.length > 0) {
    console.log(`[Launcher] MCEF already present: ${existingFiles[0]}`)
    return
  }

  try {
    console.log('[Launcher] Downloading MCEF from Modrinth...')
    const { net: electronNet } = require('electron')

    // Try both MCEF variants — original first, then MCEF Modern (actively maintained fork)
    // MCEF uses Mixins targeting obfuscated classes, so exact MC version match is required.
    const mcefProjects = [
      { slug: 'mcef', name: 'MCEF' },
      { slug: 'mcef-modern', name: 'MCEF Modern' },
    ]

    let latestVersion: any = null
    let primaryFile: any = null
    let projectName = ''

    for (const proj of mcefProjects) {
      const versionsUrl = `https://api.modrinth.com/v2/project/${proj.slug}/version?loaders=["fabric"]&game_versions=["${mcVersion}"]`
      const res = await electronNet.fetch(versionsUrl, {
        headers: { 'User-Agent': 'Cobble-Launcher/1.0 (contact@cobble.gg)' }
      })
      if (!res.ok) continue

      const versions = await res.json() as any[]
      if (versions && versions.length > 0) {
        latestVersion = versions[0]
        primaryFile = latestVersion.files?.find((f: any) => f.primary) || latestVersion.files?.[0]
        projectName = proj.name
        console.log(`[Launcher] ${proj.name}: Found build for MC ${mcVersion}`)
        break
      } else {
        console.log(`[Launcher] ${proj.name}: No build for MC ${mcVersion}`)
      }
    }

    if (!latestVersion || !primaryFile?.url) {
      console.log(`[Launcher] MCEF: No build available from any variant for MC ${mcVersion}`)
      // Clean up any stale incompatible jars
      const staleFiles = readdirSync(modsDir).filter(f => f.toLowerCase().includes('mcef') && f.endsWith('.jar'))
      for (const stale of staleFiles) {
        unlinkSync(join(modsDir, stale))
        console.log(`[Launcher] MCEF: Removed incompatible ${stale}`)
      }
      return
    }

    // Download the JAR
    const downloadRes = await electronNet.fetch(primaryFile.url)
    if (!downloadRes.ok) {
      console.log(`[Launcher] ${projectName}: Download failed (${downloadRes.status})`)
      return
    }

    const buffer = Buffer.from(await downloadRes.arrayBuffer())

    // Verify SHA-512 hash if provided by Modrinth
    const expectedHash = primaryFile.hashes?.sha512
    if (expectedHash) {
      const actualHash = createHash('sha512').update(buffer).digest('hex')
      if (actualHash !== expectedHash) {
        console.log(`[Launcher] ${projectName}: Hash mismatch! Expected: ${expectedHash.substring(0, 16)}... Got: ${actualHash.substring(0, 16)}...`)
        return
      }
      console.log(`[Security] Hash verified: ${projectName}`)
    }

    const destFilename = primaryFile.filename || `mcef-${latestVersion.version_number}.jar`
    const destPath = join(modsDir, destFilename)
    writeFileSync(destPath, buffer)

    console.log(`[Launcher] ${projectName} v${latestVersion.version_number} installed: ${destFilename}`)
  } catch (err: any) {
    console.log(`[Launcher] MCEF auto-install failed: ${err.message}`)
  }
}

// ============================================================
// CEF Codec Patch — Replace JCEF with codec-enabled build
// ============================================================

const CEF_STANDARD_URL = 'https://cef-builds.spotifycdn.com/cef_binary_143.0.14%2Bgdd46a37%2Bchromium-143.0.7499.193_windows64.tar.bz2'
const CEF_CODEC_MARKER = '.codec-patched'

/**
 * Patch MCEF Modern's JCEF native files with Spotify's CEF Standard Distribution
 * which includes proprietary codecs (H.264, AAC) needed for Twitch video playback.
 * Only runs once — creates a marker file after patching.
 */
async function patchCefCodecs(instancePath: string): Promise<void> {
  const jcefDir = join(instancePath, 'config', 'mcef-modern', 'jcef')
  const markerFile = join(jcefDir, CEF_CODEC_MARKER)

  // Skip if already patched or MCEF not installed
  if (!existsSync(jcefDir) || !existsSync(join(jcefDir, 'libcef.dll'))) return
  if (existsSync(markerFile)) {
    console.log('[Launcher] CEF codecs already patched')
    return
  }

  console.log('[Launcher] Patching CEF with proprietary codecs (H.264/AAC for Twitch)...')
  broadcastLog('[Launcher] Downloading codec-enabled CEF (~300MB, one-time)...\n')

  const { net: electronNet } = require('electron')
  const { execSync } = require('child_process')
  const tmpDir = join(require('os').tmpdir(), 'cef-codec-patch')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  const tarBz2Path = join(tmpDir, 'cef_standard.tar.bz2')
  const extractDir = join(tmpDir, 'extracted')

  try {
    // Download CEF Standard Distribution if not cached
    if (!existsSync(tarBz2Path) || statSync(tarBz2Path).size < 100_000_000) {
      const res = await electronNet.fetch(CEF_STANDARD_URL)
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      writeFileSync(tarBz2Path, buffer)
      console.log(`[Launcher] CEF downloaded: ${Math.round(buffer.length / 1048576)}MB`)
    } else {
      console.log('[Launcher] Using cached CEF download')
    }

    // Extract with 7z (available via scoop) or tar
    if (existsSync(extractDir)) {
      // Clean previous extraction
      execSync(`rmdir /s /q "${extractDir}"`, { stdio: 'ignore' })
    }
    mkdirSync(extractDir, { recursive: true })

    // Try 7z first, then tar
    try {
      execSync(`7z x "${tarBz2Path}" -o"${tmpDir}" -y`, { stdio: 'ignore' })
      const tarFile = join(tmpDir, 'cef_standard.tar')
      execSync(`7z x "${tarFile}" -o"${extractDir}" -y`, { stdio: 'ignore' })
    } catch {
      execSync(`tar -xjf "${tarBz2Path}" -C "${extractDir}"`, { stdio: 'ignore' })
    }

    // Find the extracted CEF directory
    const cefDirs = readdirSync(extractDir).filter(f =>
      statSync(join(extractDir, f)).isDirectory() && f.startsWith('cef_binary')
    )
    if (cefDirs.length === 0) throw new Error('CEF extraction failed — no cef_binary directory found')

    const cefRoot = join(extractDir, cefDirs[0])
    const releaseDir = join(cefRoot, 'Release')
    const resourcesDir = join(cefRoot, 'Resources')

    if (!existsSync(releaseDir)) throw new Error('CEF Release directory not found')

    // Copy Release files (DLLs, binaries) — skip bootstrap*, libcef.lib
    const releaseFiles = readdirSync(releaseDir).filter(f =>
      !f.startsWith('bootstrap') && !f.endsWith('.lib')
    )
    for (const f of releaseFiles) {
      const src = join(releaseDir, f)
      if (statSync(src).isFile()) {
        copyFileSync(src, join(jcefDir, f))
      }
    }

    // Copy Resources (pak files, locales)
    if (existsSync(resourcesDir)) {
      for (const f of readdirSync(resourcesDir)) {
        const src = join(resourcesDir, f)
        if (statSync(src).isFile()) {
          copyFileSync(src, join(jcefDir, f))
        }
      }
      const localesDir = join(resourcesDir, 'locales')
      const destLocales = join(jcefDir, 'locales')
      if (existsSync(localesDir)) {
        if (!existsSync(destLocales)) mkdirSync(destLocales, { recursive: true })
        for (const f of readdirSync(localesDir)) {
          copyFileSync(join(localesDir, f), join(destLocales, f))
        }
      }
    }

    // Create marker file so we don't re-patch
    writeFileSync(markerFile, `Patched at ${new Date().toISOString()}\nSource: ${CEF_STANDARD_URL}\n`)
    console.log('[Launcher] CEF codec patch complete — H.264/AAC codecs enabled')
    broadcastLog('[Launcher] CEF codec patch complete — Twitch streams enabled!\n')
  } catch (err: any) {
    console.log(`[Launcher] CEF codec patch failed: ${err.message}`)
    broadcastLog(`[Launcher] CEF codec patch failed: ${err.message}\n`)
  }
}

const PROXY_MOD_FILENAME = 'loom-proxy.jar'
const PROXY_MOD_JAR = 'loom-proxy-1.0.0.jar'

// Path to our built mod JAR
function getProxyModSource(): string {
  const candidates = [
    // Sibling project relative to this project's root
    join(app.getAppPath(), '..', 'loom-proxy-mod', 'build', 'libs', PROXY_MOD_JAR),
    join(app.getAppPath(), '..', '..', 'loom-proxy-mod', 'build', 'libs', PROXY_MOD_JAR),
    join(app.getAppPath(), '..', '..', '..', 'loom-proxy-mod', 'build', 'libs', PROXY_MOD_JAR),
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

  let account = getCachedAccount()
  if (!account || !account.accessToken) {
    broadcastStatus({ running: false, error: 'Not logged into Minecraft' })
    throw new Error('Not logged into Minecraft')
  }

  // Refresh token if expired (prevents "Invalid session" errors)
  if (account.expiresAt < Date.now() + 5 * 60 * 1000) {
    console.log('[Launcher] Token expired, refreshing before launch...')
    broadcastStatus({ running: true, progress: 0, task: 'Refreshing session...' })
    const refreshed = await switchAccount(account.uuid)
    if (refreshed && refreshed.accessToken) {
      account = refreshed
      console.log('[Launcher] Token refreshed successfully')
    } else {
      // switchAccount failed, try full restore
      const restored = await restoreSession()
      if (restored && restored.accessToken) {
        account = restored
        console.log('[Launcher] Session restored via full refresh')
      } else {
        broadcastStatus({ running: false, error: 'Session expired — please log in again' })
        throw new Error('Session expired — please log in again')
      }
    }
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
  // storeGet — from static import
  const perfJvmFlags = storeGet?.('perf_jvm_flags') ?? true
  const perfHighPriority = storeGet?.('perf_high_priority') ?? true
  const perfPowerPlan = storeGet?.('perf_power_plan') ?? false
  const perfGameSettings = storeGet?.('perf_game_settings') ?? true
  const perfCacheAndSkip = storeGet?.('perf_cache_and_skip') ?? true

  // Use persistent preloaded agent — dispatcher for metadata fetches, agent for file downloads
  // skipPrevalidate: skip SHA1 checks for files that already exist on disk (huge speedup for re-launches)
  const isRelaunch = existsSync(join(rootPath, 'versions', instance.version, `${instance.version}.jar`))
  const installOptions: any = {
    agent: { dispatcher: getAgent() },
    dispatcher: getAgent(),
    skipPrevalidate: isRelaunch,
  }

  // ── FAST PATH: Skip all verification if instance was previously launched successfully ──
  const currentModsHash = computeModsHash(id)
const isFastRelaunch = instance.launchReady === true
    && instance.modsHash === currentModsHash
    && isRelaunch
  
  try {
    // Variables needed for launch — set during verification or fast-path
    let resolvedVersionId = instance.version
    let javaComponent = 'java-runtime-gamma'
    let javaBin = ''

    if (isFastRelaunch) {
      // ── FAST PATH: Resolve version + Java without network calls ──
      console.log(`[Launcher] ⚡ FAST RELAUNCH — skipping verification (modsHash=${currentModsHash})`)
      broadcastLog('[Launcher] ⚡ Fast relaunch — all files verified from previous launch\n')
      broadcastStatus({ task: 'Fast relaunch...', progress: 90 })

      // Resolve version ID from local files
      if (instance.loader && instance.loader !== 'Vanilla') {
        const allVersions = existsSync(versionsDir) ? readdirSync(versionsDir) : []
        const loaderName = instance.loader.toLowerCase()
        const match = allVersions.find((v: string) =>
          v.includes(loaderName) && (v.startsWith(instance.version + '-') || v.startsWith(loaderName + '-'))
        )
        if (match) resolvedVersionId = match
      }

      // Parse version for Java component
      const resolvedVersion = await Version.parse(rootPath, resolvedVersionId)
      javaComponent = resolvedVersion.javaVersion?.component || 'java-runtime-gamma'
      const jreDir = join(rootPath, 'java', javaComponent)
      javaBin = javaPathCache.get(javaComponent)
        || join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')

      // Fire-and-forget backup
      autoBackup(id).then(backup => {
        if (backup) broadcastLog(`[Backup] Auto-backup: ${backup.worldCount} world(s)\n`)
      }).catch(() => {})

      broadcastStatus({ task: 'Starting Minecraft...', progress: 98 })
    } else {
    // ── PHASE 1: Get version manifest (cached) ──────────────────
    broadcastStatus({ task: 'Checking version...', progress: 5, firstDownload: isFirstDownload })
    broadcastLog('[Launcher] Checking version manifest...\n')
    // getVersionList — from static import

    if (!cachedMojangVersions || Date.now() - versionCacheTime > VERSION_CACHE_TTL) {
      broadcastLog('[Launcher] Fetching version list from Mojang...\n')
      cachedMojangVersions = await getVersionList({ dispatcher: getAgent() })
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
          // fetchJavaRuntimeManifest, installJavaRuntimeTask — from static import
          const javaManifest = await Promise.race([
            fetchJavaRuntimeManifest({ target: javaComp, dispatcher: getAgent() }),
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
    const allVersions = existsSync(versionsDir) ? readdirSync(versionsDir) : []
    let skipLoader = false
    if (instance.loader && instance.loader !== 'Vanilla') {
      const match = allVersions.find((v: string) => v.includes(instance.loader.toLowerCase()) && (v.startsWith(instance.version + '-') || v.startsWith(instance.loader.toLowerCase() + '-')))
      if (match) {
        skipLoader = true
        broadcastLog(`[Launcher] Fast Boot: ${instance.loader} already installed, skipping setup.\n`)
      }
    }

    if (instance.loader === 'Fabric' && !skipLoader) {
      broadcastStatus({ task: 'Installing Fabric...', progress: 52 })
      try {
        // installFabric — from static import
        let loaders = fabricLoaderCache.get(instance.version)
        if (!loaders) {
          broadcastLog('[Launcher] Fetching Fabric loader metadata...\n')
          // getLoaderArtifactListFor — from static import
          loaders = await getLoaderArtifactListFor(instance.version, { dispatcher: getAgent() })
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
    } else if (instance.loader === 'Forge' && !skipLoader) {
      broadcastStatus({ task: 'Installing Forge...', progress: 52 })
      broadcastLog('[Launcher] Fetching Forge version list...\n')
      try {
        const javaBin = await ensureJavaForLoader(rootPath, instance.version)
        // getForgeVersionList, installForge — from static import
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
    } else if (instance.loader === 'NeoForge' && !skipLoader) {
      broadcastStatus({ task: 'Installing NeoForge...', progress: 52 })
      broadcastLog('[Launcher] Fetching NeoForge versions...\n')
      try {
        const javaBin = await ensureJavaForLoader(rootPath, instance.version)
        // installNeoForged — from static import
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
    } else if (instance.loader === 'Quilt' && !skipLoader) {
      broadcastStatus({ task: 'Installing Quilt...', progress: 52 })
      broadcastLog('[Launcher] Fetching Quilt loader versions...\n')
      try {
        // getQuiltVersionsList, installQuiltVersion — from static import
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
    resolvedVersionId = instance.version
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
      
      const isFastBoot = skipLoader && existsSync(join(versionsDir, resolvedVersionId, `${resolvedVersionId}.json`))
      if (isFastBoot) {
        broadcastLog('[Launcher] Fast Boot: Skipping library verification.\n')
        broadcastStatus({ task: 'Libraries verified', progress: 80 })
      } else {
        const libsPromise = runWithRetries(async () => {
          broadcastLog('[Launcher] Downloading mod loader libraries...\n')
          const resolvedVer = await Version.parse(rootPath, resolvedVersionId)
          // installLibrariesTask — from static import
          const libsTask = installLibrariesTask(resolvedVer, installOptions)
          await runTaskWithProgress(libsTask, 'Installing Libraries', 68, 80)
          broadcastLog('[Launcher] All libraries installed.\n')
        })
        await libsPromise
        broadcastStatus({ task: 'Libraries installed', progress: 80 })
      }
    } else {
      broadcastStatus({ progress: 80 })
    }

    // ── PHASE 5: Java runtime (80% → 95%) ───────────────────────
    broadcastStatus({ task: 'Checking Java...', progress: 82 })
    broadcastLog('[Launcher] Checking Java runtime...\n')
    const resolvedVersion = await Version.parse(rootPath, resolvedVersionId)
    javaComponent = resolvedVersion.javaVersion?.component || 'java-runtime-gamma'
    const jreDir = join(rootPath, 'java', javaComponent)
    javaBin = join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')

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

      // fetchJavaRuntimeManifest, installJavaRuntimeTask — from static import
      broadcastLog('[Launcher] Fetching Java manifest from Mojang...\n')
      const manifestPromise = fetchJavaRuntimeManifest({ target: javaComponent, dispatcher: getAgent() })
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

    // ── PHASE 5.5-5.7: Parallel pre-launch tasks ─────────────────
    const preLaunchTasks: Promise<void>[] = []

    // Perf mods (non-critical — if it fails, still launch)
    if (instance.loader && instance.loader.toLowerCase() !== 'vanilla') {
      preLaunchTasks.push(
        (async () => {
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
        })()
      )
    }

    // Auto-backup (fire-and-forget — don't block launch)
    autoBackup(id).then(backup => {
      if (backup) {
        broadcastLog(`[Backup] Auto-backup created: ${backup.worldCount} world(s), ${Math.round(backup.sizeBytes / 1024)}KB\n`)
      }
    }).catch(err => {
      broadcastLog(`[Backup] Auto-backup skipped: ${err.message}\n`)
    })

    // CEF codec patch (non-critical)
    preLaunchTasks.push(
      patchCefCodecs(instancePath).catch(err => {
        console.log(`[Launcher] CEF codec patch skipped: ${err.message}`)
      })
    )

    await Promise.all(preLaunchTasks)

    if (cancelRequested) throw new Error('Launch cancelled')
    } // end of else (non-fast-relaunch verification path)

    // ── PHASE 6: Launch (95% → 100%) ────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    broadcastStatus({ task: 'Starting Minecraft...', progress: 98 })
    broadcastLog(`[Launcher] All files ready in ${elapsed}s. Launching game...\n`)
    console.log(`[Launcher] Pipeline complete in ${elapsed}s, spawning JVM`)

    // ── Windows Defender exclusion check (opt-in, first launch only) ──
    // Fire-and-forget on fast path; on first launch, briefly pause to prompt
    checkAndOfferDefenderExclusion(instancePath).catch(err => {
      console.log(`[Defender] Check skipped: ${err.message}`)
    })

    // ── Privacy Mode: proxy mod + JVM args ────────────────────────
    const extraJVMArgs: string[] = []

    // ── Performance JVM flags (Aikar's flags / ZGC) ──
    const isJava21 = javaComponent === 'java-runtime-delta'
    if (isJava21) {
      extraJVMArgs.push(
        '-XX:+UseZGC',
        '-XX:+ZGenerational',
        '-XX:+PerfDisableSharedMem',
        '-XX:+DisableExplicitGC',
        // Additional performance flags
        '-Dfile.encoding=UTF-8',
        '-Djava.net.preferIPv4Stack=true',
        '-XX:+UseStringDeduplication',
        '-XX:+OptimizeStringConcat'
      )
    } else {
      extraJVMArgs.push(
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:+DisableExplicitGC',
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
        '-XX:+OptimizeStringConcat'
      )
    }

    // ── AppCDS (temporarily disabled — investigating JVM crash) ──
    // const cdsArchive = join(instancePath, 'mc.jsa')
    // const cdsClassList = join(instancePath, 'mc-classlist.txt')
    // if (existsSync(cdsArchive)) {
    //   extraJVMArgs.push(`-XX:SharedArchiveFile=${cdsArchive}`, '-Xshare:auto')
    //   try {
    //     const archiveSize = statSync(cdsArchive).size
    //     console.log(`[Launcher] AppCDS archive found (${Math.round(archiveSize / 1024 / 1024)}MB), using for faster startup`)
    //     broadcastLog(`[Launcher] ⚡ AppCDS: ${Math.round(archiveSize / 1024 / 1024)}MB class cache loaded\n`)
    //   } catch {
    //     console.log('[Launcher] AppCDS archive found, using for faster startup')
    //   }
    // } else {
    //   extraJVMArgs.push(
    //     `-XX:ArchiveClassesAtExit=${cdsArchive}`,
    //     `-XX:DumpLoadedClassList=${cdsClassList}`
    //   )
    //   console.log('[Launcher] AppCDS: class archive + classlist will be generated on this launch')
    //   broadcastLog('[Launcher] First launch — building class cache for faster future launches...\n')
    // }

    // Reduce JIT compiler threads to avoid CPU contention at startup
    extraJVMArgs.push('-XX:CICompilerCount=2')

    // ── JFR profiling for startup analysis (temporarily disabled for debugging) ──
    // const jfrFile = join(instancePath, 'mc-profile.jfr')
    // extraJVMArgs.push(
    //   `-XX:StartFlightRecording=filename=${jfrFile},dumponexit=true,settings=profile,maxsize=50m`
    // )
    // console.log(`[Launcher] JFR profiling enabled → ${jfrFile}`)

    // ── Start Dynamic Island server BEFORE reading token ──
    // Must start the server first so getSessionToken() returns the fresh token
    startDynamicIslandServer()

    // ── WebSocket session token for Dynamic Island auth ──
    const wsToken = getSessionToken()
    if (wsToken) {
      extraJVMArgs.push(`-Dloom.ws.token=${wsToken}`)
      console.log(`[DynamicIsland] Token passed to JVM: ${wsToken.substring(0, 8)}...`)
    }

    // ── Loom Shield: Crash loop safe mode ──
    const lastServer = storeGet?.('loom_shield_last_server') || ''
    const crashCount = storeGet?.('loom_shield_crash_count') || 0
    const lastCrashTime = storeGet?.('loom_shield_last_crash') || 0
    const inCrashWindow = Date.now() - lastCrashTime < 5 * 60 * 1000
    if (crashCount >= 3 && inCrashWindow) {
      extraJVMArgs.push('-Dloom.safemode=true')
      console.log(`[LoomShield] Safe mode enabled (${crashCount} crashes on ${lastServer})`)
      broadcastLog(`[LoomShield] Safe mode enabled — ${crashCount} recent crashes detected\n`)
    }

    // ── Network JVM flags (Netty optimization) ──
    const perfNetwork = storeGet?.('perf_network') ?? false
    if (perfNetwork) {
      extraJVMArgs.push(
        '-Dio.netty.buffer.checkAccessible=false',
        '-Dio.netty.buffer.checkBounds=false',
      )
      console.log('[Launcher] Network JVM flags enabled')
    }

    // ── Recording: Ensure FFmpeg is available and pass path to mod ──
    let ffmpegPath = getFFmpegPath()
    if (!ffmpegPath) {
      try {
        broadcastStatus({ running: true, task: 'Downloading FFmpeg for recording...', progress: 92 })
        ffmpegPath = await downloadFFmpeg()
      } catch (err) {
        console.warn('[Launcher] FFmpeg download failed, recording will be unavailable:', err)
      }
    }
    if (ffmpegPath) {
      extraJVMArgs.push(`-Dloom.ffmpeg.path=${ffmpegPath}`)
      console.log(`[Launcher] FFmpeg path passed to JVM: ${ffmpegPath}`)
    }
    const recordingsDir = join(app.getPath('userData'), 'gallery')
    if (!existsSync(recordingsDir)) mkdirSync(recordingsDir, { recursive: true })
    extraJVMArgs.push(`-Dloom.recordings.dir=${recordingsDir}`)

    const isModded = instance.loader && instance.loader !== 'vanilla'

    if (account.privacyEnabled && account.privacyRegion && isModded) {
      // Install proxy mod and inject JVM args
      broadcastStatus({ task: 'Setting up privacy mode...', progress: 97 })
      try {
        await ensureProxyMod(instancePath)
        broadcastLog('[Launcher] RespectProxyOptions mod ready\n')
      } catch (modErr: any) {
        broadcastLog(`[Launcher] Warning: Could not install proxy mod: ${modErr.message}\n`)
      }

      const proxyArgs = getProxyJvmArgs(account.privacyRegion)
      if (proxyArgs.length > 0) {
        extraJVMArgs.push(...proxyArgs)
        broadcastLog(`[Launcher] Privacy Mode ON — routing through ${account.privacyRegion}\n`)
        console.log(`[Launcher] Privacy Mode: ${account.privacyRegion} proxy args injected`)
      }
    } else {
      // Privacy mode off — remove proxy mod if it was left behind
      removeProxyMod(instancePath)
    }

    // ── Dynamic Island — Multi-version deployment ──────────────
    console.log(`[Launcher] DI check: loader=${instance.loader}, version=${instance.version}`)
    if (instance.loader && (instance.loader.toLowerCase() === 'fabric' || instance.loader.toLowerCase() === 'quilt')) {
      try {
        const ver = instance.version
        const modDest = join(instancePath, 'mods', 'dynamic-island-1.0.0.jar')

        // Determine which mod build to use based on MC version
        let modDir: string | null = null
        if (ver === '1.21.11') {
          modDir = 'dynamic-island-1.21.11'  // 1.21.11 build
        } else if (ver === '1.21.1' || ver === '1.21') {
          modDir = 'dynamic-island'        // 1.21.x build
        } else if (ver === '1.20.1') {
          modDir = 'dynamic-island-1.20'   // 1.20.1 build
        }
        // All other versions: DI is not supported — modDir stays null

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
            // In dev mode, the mod JAR is at the project root not inside the app bundle
            // Check if the mod is already in the instance mods folder
            if (existsSync(modDest)) {
              broadcastLog('[Launcher] Dynamic Island mod already present in instance.\n')
            } else {
              broadcastLog(`[Launcher] Dynamic Island mod NOT FOUND at ${modSource}\n`)
            }
          }

          // ── Auto-install WATERMeDIA dependencies (always, regardless of DI JAR source) ──
          await ensureWatermediaMods(instancePath, ver)

          // ── Auto-install MCEF for in-game browser ──
          await ensureMcefMod(instancePath, ver)
        }
      } catch (err) {
        broadcastLog(`[Launcher] Could not install Dynamic Island mod: ${err}\n`)
      }
    }

    // ── Loom Lazy Init — Deferred loading mod (all Fabric instances) ──
    if (instance.loader === 'Fabric') {
      try {
        const mcMajorMinor = instance.version.split('.').slice(0, 2).join('.')
        const is121Plus = parseFloat(mcMajorMinor) >= 1.21
        const lazyInitVariant = is121Plus ? 'loom-lazy-init-1.21' : 'loom-lazy-init'
        const lazyInitJarName = is121Plus ? 'loom-lazy-init-1.21-1.0.0.jar' : 'loom-lazy-init-1.0.0.jar'

        // Clean up wrong-version JAR if present
        const wrongJar = is121Plus ? 'loom-lazy-init-1.0.0.jar' : 'loom-lazy-init-1.21-1.0.0.jar'
        const wrongPath = join(instancePath, 'mods', wrongJar)
        if (existsSync(wrongPath)) {
          require('fs').unlinkSync(wrongPath)
          console.log(`[Launcher] Removed wrong-version lazy init JAR: ${wrongJar}`)
        }

        const lazyInitDest = join(instancePath, 'mods', lazyInitJarName)
        const lazyInitSource = join(app.getAppPath(), 'mods', lazyInitVariant, 'build', 'libs', lazyInitJarName)
        if (existsSync(lazyInitSource)) {
          if (!existsSync(join(instancePath, 'mods'))) {
            mkdirSync(join(instancePath, 'mods'), { recursive: true })
          }
          copyFileSync(lazyInitSource, lazyInitDest)
          console.log(`[Launcher] Loom Lazy Init (${is121Plus ? '1.21' : '1.20'}) installed — deferred recipes/models/advancements`)
        }
      } catch (err: any) {
        console.log(`[Launcher] Loom Lazy Init install skipped: ${err.message}`)
      }
    }

    // ── Cache & Skip — Model/atlas bake caching (Fabric only) ──
    if (instance.loader === 'Fabric' && perfCacheAndSkip) {
      try {
        const cacheSkipJarName = 'cache-and-skip-1.0.0.jar'
        const cacheSkipDest = join(instancePath, 'mods', cacheSkipJarName)
        const cacheSkipSource = join(app.getAppPath(), 'mods', 'cache-and-skip', 'build', 'libs', cacheSkipJarName)
        if (existsSync(cacheSkipSource)) {
          if (!existsSync(join(instancePath, 'mods'))) {
            mkdirSync(join(instancePath, 'mods'), { recursive: true })
          }
          copyFileSync(cacheSkipSource, cacheSkipDest)
          console.log('[Launcher] Cache & Skip mod installed — baked model caching enabled')
          broadcastLog('[Launcher] Cache & Skip mod installed — faster repeat launches\n')
        } else if (existsSync(cacheSkipDest)) {
          console.log('[Launcher] Cache & Skip mod already in instance')
        } else {
          console.log(`[Launcher] Cache & Skip mod not found at ${cacheSkipSource}`)
        }
      } catch (err: any) {
        console.log(`[Launcher] Cache & Skip install skipped: ${err.message}`)
      }
    } else if (instance.loader === 'Fabric' && !perfCacheAndSkip) {
      // User disabled — remove if present
      const cacheSkipPath = join(instancePath, 'mods', 'cache-and-skip-1.0.0.jar')
      if (existsSync(cacheSkipPath)) {
        try {
          unlinkSync(cacheSkipPath)
          console.log('[Launcher] Cache & Skip mod removed (disabled in settings)')
        } catch {}
      }
    }

    // ── File Sync: Copy canonical files TO instance before launch ──
    try {
      const syncResult = syncToInstance(instance.id)
      if (syncResult.synced > 0) {
        broadcastLog(`[FileSync] Pre-launch: synced ${syncResult.synced} file(s) to instance\n`)
      }
    } catch (err: any) {
      console.log(`[FileSync] Pre-launch sync skipped: ${err.message}`)
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
        setHighPerformancePowerPlan(perfPowerPlan)
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
      // DI server already started before JVM launch (for token)
      sendNotification(`Playing ${instance.name}`)
    })

    activeProcess.on('exit', (code) => {
      broadcastLog(`[Launcher] Game exited (code ${code})\n`)
      activeProcess = null
      broadcastStatus({ running: false, progress: 0, task: `Exited (code ${code})` })


      // File Sync: Copy modified files FROM instance back to canonical store
      try {
        const syncResult = syncFromInstance(instance.id)
        if (syncResult.synced > 0) {
          console.log(`[FileSync] Post-close: synced ${syncResult.synced} file(s) from instance`)
        }
      } catch (err: any) {
        console.log(`[FileSync] Post-close sync skipped: ${err.message}`)
      }

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
        // ── Loom Shield: Track crash for crash loop detection ──
        try {
          const sg = storeGet, ss = storeSet
          const prevCount = sg?.('loom_shield_crash_count') || 0
          const prevTime = sg?.('loom_shield_last_crash') || 0
          const inWindow = Date.now() - prevTime < 5 * 60 * 1000
          ss?.('loom_shield_crash_count', inWindow ? prevCount + 1 : 1)
          ss?.('loom_shield_last_crash', Date.now())
          console.log(`[LoomShield] Crash recorded (${inWindow ? prevCount + 1 : 1} in window)`)
        } catch { /* non-critical */ }
      } else {
        // Successful exit — reset crash counter and mark instance as fast-relaunch ready
        try {
          const ss = storeSet
          ss?.('loom_shield_crash_count', 0)
        } catch { /* non-critical */ }
        // Mark as launch-ready for next time (skip verification)
        try {
          markLaunchReady(currentLaunchInstanceId || id)
          console.log('[Launcher] Instance marked as launch-ready for fast relaunch')
        } catch { /* non-critical */ }
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

// ============================================================
// Pre-download — triggered on instance creation to warm files
// ============================================================

// Track active pre-downloads to avoid duplicate work
const activePredownloads = new Set<string>()

/**
 * Pre-download game files for a newly created instance so they're
 * ready when the user clicks Launch.
 *
 * Downloads: version manifest, game JAR + assets + libraries,
 * mod loader (Fabric/Forge/NeoForge/Quilt), and Java runtime.
 *
 * Does NOT install performance mods (that happens at launch time).
 * Fully idempotent — safe to call multiple times for the same instance.
 * All errors are caught silently — pre-download failure is not critical.
 */
export async function predownloadForInstance(
  instanceId: string,
  version: string,
  loader: string,
  loaderVersion?: string
): Promise<void> {
  // Idempotency guard — skip if already in progress for this instance
  if (activePredownloads.has(instanceId)) {
    console.log(`[Predownload] Already in progress for ${instanceId}, skipping`)
    return
  }
  activePredownloads.add(instanceId)

  const startTime = Date.now()
  console.log(`[Predownload] Starting for ${instanceId} (${version}, ${loader || 'Vanilla'})`)

  const broadcastPredownload = (progress: number, task: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('predownload:progress', { instanceId, progress, task })
    }
  }

  const rootPath = join(app.getPath('userData'), 'minecraft_data')
  if (!existsSync(rootPath)) mkdirSync(rootPath, { recursive: true })

  const installOptions: any = {
    agent: { dispatcher: getAgent() },
    dispatcher: getAgent(),
    skipPrevalidate: false,
  }

  try {
    // ── Step 1: Version manifest ──────────────────────────────
    broadcastPredownload(5, 'Fetching version manifest...')
    if (!cachedMojangVersions || Date.now() - versionCacheTime > VERSION_CACHE_TTL) {
      cachedMojangVersions = await getVersionList({ dispatcher: getAgent() })
      versionCacheTime = Date.now()
    }
    const versionMeta = cachedMojangVersions.versions.find((v: any) => v.id === version)
    if (!versionMeta) {
      console.log(`[Predownload] Version ${version} not found in manifest, aborting`)
      return
    }
    broadcastPredownload(10, 'Version manifest ready')

    // ── Step 2: Game JAR + assets + libraries ─────────────────
    const versionJar = join(rootPath, 'versions', version, `${version}.jar`)
    if (existsSync(versionJar)) {
      console.log(`[Predownload] Game files already cached for ${version}`)
      broadcastPredownload(50, 'Game files already cached')
    } else {
      broadcastPredownload(12, 'Downloading game files...')
      console.log(`[Predownload] Downloading game files for ${version}...`)

      await runWithRetries(async () => {
        const mcTask = installTask(versionMeta, rootPath, installOptions)
        // Run silently — no broadcastStatus (that's for the launch pipeline)
        await mcTask.startAndWait()
      })
      broadcastPredownload(50, 'Game files downloaded')
      console.log(`[Predownload] Game files downloaded for ${version}`)
    }

    // ── Step 3: Mod loader ────────────────────────────────────
    const versionsDir = join(rootPath, 'versions')
    const allVersions = existsSync(versionsDir) ? readdirSync(versionsDir) : []

    // Check if loader is already installed
    let loaderAlreadyInstalled = false
    if (loader && loader !== 'Vanilla') {
      const match = allVersions.find((v: string) =>
        v.includes(loader.toLowerCase()) &&
        (v.startsWith(version + '-') || v.startsWith(loader.toLowerCase() + '-'))
      )
      if (match) loaderAlreadyInstalled = true
    }

    if (loader === 'Fabric' && !loaderAlreadyInstalled) {
      broadcastPredownload(52, 'Installing Fabric...')
      console.log(`[Predownload] Installing Fabric for ${version}...`)
      let loaders = fabricLoaderCache.get(version)
      if (!loaders) {
        loaders = await getLoaderArtifactListFor(version, { dispatcher: getAgent() })
        if (loaders && loaders.length > 0) fabricLoaderCache.set(version, loaders)
      }
      if (loaders && loaders.length > 0) {
        const fabricArtifact = loaders.find((l: any) => l.loader.stable) || loaders[0]
        await installFabric(fabricArtifact, rootPath, installOptions)
        console.log(`[Predownload] Fabric ${fabricArtifact.loader.version} installed`)
      }
      broadcastPredownload(65, 'Fabric installed')
    } else if (loader === 'Forge' && !loaderAlreadyInstalled) {
      broadcastPredownload(52, 'Installing Forge...')
      console.log(`[Predownload] Installing Forge for ${version}...`)
      const javaBin = await ensureJavaForLoader(rootPath, version)
      let forgeVersion: string
      if (loaderVersion) {
        forgeVersion = loaderVersion
      } else {
        const forgeList = await getForgeVersionList({ minecraft: version })
        forgeVersion = forgeList.versions[0].version
      }
      await installForge(
        { mcversion: version, version: forgeVersion },
        rootPath,
        { ...installOptions, java: javaBin }
      )
      console.log(`[Predownload] Forge ${forgeVersion} installed`)
      broadcastPredownload(65, 'Forge installed')
    } else if (loader === 'NeoForge' && !loaderAlreadyInstalled) {
      broadcastPredownload(52, 'Installing NeoForge...')
      console.log(`[Predownload] Installing NeoForge for ${version}...`)
      const javaBin = await ensureJavaForLoader(rootPath, version)
      let neoForgeVersion: string
      if (loaderVersion) {
        neoForgeVersion = loaderVersion
      } else {
        const mcParts = version.split('.')
        const neoPrefix = `${mcParts[1]}.${mcParts[2] || '0'}`
        const res = await net.fetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml')
        const xml = await res.text()
        const versionMatches = xml.match(/<version>([^<]+)<\/version>/g) || []
        const allNeoVersions = versionMatches.map((m: string) => m.replace(/<\/?version>/g, ''))
        const compatible = allNeoVersions
          .filter((v: string) => v.startsWith(neoPrefix + '.'))
          .sort((a: string, b: string) => {
            const aParts = a.split('.').map(Number)
            const bParts = b.split('.').map(Number)
            for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
              const diff = (bParts[i] || 0) - (aParts[i] || 0)
              if (diff !== 0) return diff
            }
            return 0
          })
        if (compatible.length === 0) {
          console.log(`[Predownload] No NeoForge versions found for MC ${version}`)
          broadcastPredownload(65, 'NeoForge not available')
        }
        neoForgeVersion = compatible[0]
      }
      if (neoForgeVersion) {
        await installNeoForged('neoforge', neoForgeVersion, rootPath, { ...installOptions, java: javaBin })
        console.log(`[Predownload] NeoForge ${neoForgeVersion} installed`)
      }
      broadcastPredownload(65, 'NeoForge installed')
    } else if (loader === 'Quilt' && !loaderAlreadyInstalled) {
      broadcastPredownload(52, 'Installing Quilt...')
      console.log(`[Predownload] Installing Quilt for ${version}...`)
      let quiltVersion: string
      if (loaderVersion) {
        quiltVersion = loaderVersion
      } else {
        const quiltVersions = await getQuiltVersionsList()
        if (quiltVersions && quiltVersions.length > 0) {
          quiltVersion = quiltVersions[0].version
        } else {
          console.log(`[Predownload] No Quilt versions found`)
          broadcastPredownload(65, 'Quilt not available')
          quiltVersion = ''
        }
      }
      if (quiltVersion) {
        await installQuiltVersion({
          minecraftVersion: version,
          version: quiltVersion,
          minecraft: rootPath,
        })
        console.log(`[Predownload] Quilt ${quiltVersion} installed`)
      }
      broadcastPredownload(65, 'Quilt installed')
    } else {
      broadcastPredownload(65, loader === 'Vanilla' ? 'No mod loader needed' : 'Mod loader already cached')
    }

    // ── Step 4: Libraries for mod loader ──────────────────────
    if (loader && loader !== 'Vanilla') {
      let resolvedVersionId = version
      const updatedVersions = existsSync(versionsDir) ? readdirSync(versionsDir) : []
      const loaderName = loader.toLowerCase()
      const match = updatedVersions.find((v: string) =>
        v.includes(loaderName) &&
        (v.startsWith(version + '-') || v.startsWith(loaderName + '-'))
      )
      if (match) resolvedVersionId = match

      broadcastPredownload(68, 'Installing libraries...')
      try {
        const resolvedVer = await Version.parse(rootPath, resolvedVersionId)
        const libsTask = installLibrariesTask(resolvedVer, installOptions)
        await libsTask.startAndWait()
        console.log(`[Predownload] Libraries installed for ${resolvedVersionId}`)
      } catch (e: any) {
        console.log(`[Predownload] Libraries install note: ${e.message}`)
      }
      broadcastPredownload(80, 'Libraries installed')
    } else {
      broadcastPredownload(80, 'Libraries ready')
    }

    // ── Step 5: Java runtime ──────────────────────────────────
    broadcastPredownload(82, 'Checking Java...')

    // Determine resolved version ID for Java component detection
    let resolvedForJava = version
    if (loader && loader !== 'Vanilla') {
      const updatedVersions = existsSync(versionsDir) ? readdirSync(versionsDir) : []
      const loaderName = loader.toLowerCase()
      const match = updatedVersions.find((v: string) =>
        v.includes(loaderName) &&
        (v.startsWith(version + '-') || v.startsWith(loaderName + '-'))
      )
      if (match) resolvedForJava = match
    }

    let javaComponent = 'java-runtime-gamma'
    try {
      const resolvedVersion = await Version.parse(rootPath, resolvedForJava)
      javaComponent = resolvedVersion.javaVersion?.component || 'java-runtime-gamma'
    } catch {
      // Fallback: determine from MC version number
      const minor = parseInt(version.split('.')[1] || '0')
      javaComponent = minor >= 20
        ? 'java-runtime-delta'
        : minor >= 18
          ? 'java-runtime-gamma'
          : 'java-runtime-beta'
    }

    const jreDir = join(rootPath, 'java', javaComponent)
    const javaBin = join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')

    if (javaPathCache.has(javaComponent) || existsSync(javaBin)) {
      if (!javaPathCache.has(javaComponent)) javaPathCache.set(javaComponent, javaBin)
      broadcastPredownload(95, 'Java ready')
      console.log(`[Predownload] Java (${javaComponent}) already available`)
    } else {
      broadcastPredownload(85, 'Downloading Java...')
      console.log(`[Predownload] Downloading Java (${javaComponent})...`)
      const javaManifest = await fetchJavaRuntimeManifest({ target: javaComponent, dispatcher: getAgent() })
      await runWithRetries(async () => {
        const javaTask = installJavaRuntimeTask({
          manifest: javaManifest,
          destination: jreDir,
          ...installOptions,
        })
        await javaTask.startAndWait()
      }, 3)
      javaPathCache.set(javaComponent, javaBin)
      broadcastPredownload(95, 'Java installed')
      console.log(`[Predownload] Java (${javaComponent}) installed`)
    }

    // ── Done ──────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    broadcastPredownload(100, 'Ready')
    console.log(`[Predownload] Complete for ${instanceId} in ${elapsed}s`)

  } catch (err: any) {
    // Pre-download failure is never critical — log and move on
    console.log(`[Predownload] Failed for ${instanceId}: ${err.message}`)
    broadcastPredownload(0, 'Pre-download failed (will retry at launch)')
  } finally {
    activePredownloads.delete(instanceId)
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
