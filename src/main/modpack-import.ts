import { net } from 'electron'
import { join, basename, dirname, extname } from 'path'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs'
import AdmZip from 'adm-zip'
import { createInstance, getInstancePath } from './instances'

// ============================================================
// Types
// ============================================================

export interface ImportProgress {
  stage: string
  percent: number
  detail?: string
}

interface CurseForgeManifest {
  minecraft: {
    version: string
    modLoaders: Array<{ id: string; primary?: boolean }>
  }
  manifestType: string
  manifestVersion: number
  name: string
  version: string
  author: string
  files: Array<{
    projectID: number
    fileID: number
    required: boolean
  }>
  overrides?: string
}

interface ModrinthIndex {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: Array<{
    path: string
    hashes: { sha512?: string; sha1?: string }
    env?: { client: string; server: string }
    downloads: string[]
    fileSize?: number
  }>
  dependencies: Record<string, string>  // e.g. { "minecraft": "1.20.1", "fabric-loader": "0.14.22" }
}

// ============================================================
// Constants
// ============================================================

// Public CurseForge API key (embedded in open-source launchers)
const CURSEFORGE_API_KEY = '$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueJMLN6KC'
const CURSEFORGE_API_BASE = 'https://api.curseforge.com/v1'

const USER_AGENT = 'Cobble-Launcher/1.0 (contact@cobble.gg)'

// ============================================================
// Helpers
// ============================================================

function log(message: string): void {
  console.log(`[Modpack] ${message}`)
}

function logError(message: string, err?: any): void {
  console.error(`[Modpack] ${message}`, err?.message || err || '')
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Download a file via Electron's net.fetch and return the Buffer.
 * Returns null if the download fails.
 */
async function downloadToBuffer(url: string, headers?: Record<string, string>): Promise<Buffer | null> {
  try {
    const res = await net.fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        ...(headers || {})
      }
    })

    if (!res.ok) {
      logError(`HTTP ${res.status} for ${url}`)
      return null
    }

    return Buffer.from(await res.arrayBuffer())
  } catch (err: any) {
    logError(`Download failed: ${url}`, err)
    return null
  }
}

/**
 * Verify a buffer against an expected SHA-512 hash.
 */
function verifySha512(buffer: Buffer, expected: string): boolean {
  const actual = createHash('sha512').update(buffer).digest('hex')
  if (actual !== expected) {
    logError(`Hash mismatch! Expected: ${expected.substring(0, 16)}... Got: ${actual.substring(0, 16)}...`)
    return false
  }
  log(`Hash verified ✓`)
  return true
}

/**
 * Copy zip entries from a source folder (e.g. "overrides/") into a destination directory.
 * Preserves subdirectory structure.
 */
function extractOverrides(zip: AdmZip, overridesPrefix: string, destDir: string): number {
  let count = 0
  const entries = zip.getEntries()

  // Normalize prefix — ensure it ends with /
  const prefix = overridesPrefix.endsWith('/') ? overridesPrefix : overridesPrefix + '/'

  for (const entry of entries) {
    // Match entries inside the overrides folder
    if (!entry.entryName.startsWith(prefix)) continue
    if (entry.isDirectory) continue

    // Get relative path within overrides
    const relativePath = entry.entryName.slice(prefix.length)
    if (!relativePath) continue

    const destPath = join(destDir, ...relativePath.split('/'))
    const destDirForFile = dirname(destPath)

    ensureDir(destDirForFile)
    writeFileSync(destPath, entry.getData())
    count++
  }

  if (count > 0) {
    log(`Copied ${count} override files to instance`)
  }
  return count
}

/**
 * Parse a CurseForge mod loader ID like "forge-47.2.0" or "neoforge-21.1.99" or "fabric-0.15.3".
 * Returns { loader, loaderVersion }.
 */
function parseModLoaderId(modLoaderId: string): { loader: string; loaderVersion: string } {
  const lower = modLoaderId.toLowerCase()

  if (lower.startsWith('neoforge-')) {
    return { loader: 'NeoForge', loaderVersion: modLoaderId.slice('neoforge-'.length) }
  }
  if (lower.startsWith('forge-')) {
    return { loader: 'Forge', loaderVersion: modLoaderId.slice('forge-'.length) }
  }
  if (lower.startsWith('fabric-')) {
    return { loader: 'Fabric', loaderVersion: modLoaderId.slice('fabric-'.length) }
  }
  if (lower.startsWith('quilt-')) {
    return { loader: 'Quilt', loaderVersion: modLoaderId.slice('quilt-'.length) }
  }

  // Fallback: assume Forge
  log(`Unknown mod loader format: "${modLoaderId}", defaulting to Forge`)
  return { loader: 'Forge', loaderVersion: modLoaderId }
}

/**
 * Parse Modrinth dependency keys to determine loader and version.
 */
function parseModrinthDependencies(deps: Record<string, string>): {
  mcVersion: string
  loader: string
  loaderVersion: string
} {
  const mcVersion = deps['minecraft'] || ''

  if (deps['fabric-loader']) {
    return { mcVersion, loader: 'Fabric', loaderVersion: deps['fabric-loader'] }
  }
  if (deps['quilt-loader']) {
    return { mcVersion, loader: 'Quilt', loaderVersion: deps['quilt-loader'] }
  }
  if (deps['neoforge']) {
    return { mcVersion, loader: 'NeoForge', loaderVersion: deps['neoforge'] }
  }
  if (deps['forge']) {
    return { mcVersion, loader: 'Forge', loaderVersion: deps['forge'] }
  }

  return { mcVersion, loader: 'Vanilla', loaderVersion: '' }
}

// ============================================================
// CurseForge Import
// ============================================================

async function importCurseForge(
  zip: AdmZip,
  onProgress: (progress: ImportProgress) => void
): Promise<{ instanceId: string; name: string; modCount: number }> {
  // ── Step 1: Parse manifest ──
  onProgress({ stage: 'Parsing manifest...', percent: 5 })

  const manifestEntry = zip.getEntry('manifest.json')
  if (!manifestEntry) {
    throw new Error('Invalid CurseForge modpack: missing manifest.json')
  }

  const manifest: CurseForgeManifest = JSON.parse(manifestEntry.getData().toString('utf-8'))
  log(`Modpack: "${manifest.name}" v${manifest.version}`)
  log(`Minecraft: ${manifest.minecraft.version}`)
  log(`Mods: ${manifest.files.length} files`)

  // ── Step 2: Determine loader ──
  const primaryLoader = manifest.minecraft.modLoaders.find(l => l.primary) || manifest.minecraft.modLoaders[0]
  const { loader, loaderVersion } = primaryLoader
    ? parseModLoaderId(primaryLoader.id)
    : { loader: 'Vanilla', loaderVersion: '' }

  log(`Loader: ${loader} ${loaderVersion}`)

  // ── Step 3: Create instance ──
  onProgress({ stage: 'Creating instance...', percent: 10 })

  const instance = createInstance(
    manifest.name,
    manifest.minecraft.version,
    loader,
    undefined,     // createdBy — will be set by caller if needed
    loaderVersion
  )

  const instanceDir = getInstancePath(instance.id)
  const modsDir = join(instanceDir, 'mods')
  ensureDir(modsDir)

  log(`Instance created: ${instance.id} at ${instanceDir}`)

  // ── Step 4: Download mods ──
  const totalFiles = manifest.files.length
  let downloaded = 0
  let failed = 0

  for (let i = 0; i < totalFiles; i++) {
    const file = manifest.files[i]
    const progressPercent = 15 + Math.floor((i / totalFiles) * 75)

    onProgress({
      stage: `Downloading mods...`,
      percent: progressPercent,
      detail: `${i + 1} / ${totalFiles}`
    })

    try {
      // Resolve download URL via CurseForge API
      const apiUrl = `${CURSEFORGE_API_BASE}/mods/${file.projectID}/files/${file.fileID}/download-url`
      const res = await net.fetch(apiUrl, {
        headers: {
          'x-api-key': CURSEFORGE_API_KEY,
          'Accept': 'application/json'
        }
      })

      if (!res.ok) {
        // Some files have distribution restrictions — try the direct fallback URL
        logError(`CurseForge API returned ${res.status} for mod ${file.projectID}/${file.fileID}`)

        // Fallback: try the edge CDN URL pattern
        const fallbackUrl = `https://edge.forgecdn.net/files/${Math.floor(file.fileID / 1000)}/${file.fileID % 1000}/`
        log(`Trying fallback CDN for ${file.projectID}...`)
        // We can't know the filename from the fallback, so skip
        failed++
        continue
      }

      const body = await res.json() as { data: string }
      const downloadUrl = body.data

      if (!downloadUrl) {
        logError(`No download URL returned for mod ${file.projectID}/${file.fileID}`)
        failed++
        continue
      }

      // Download the mod jar
      const buffer = await downloadToBuffer(downloadUrl)
      if (!buffer) {
        failed++
        continue
      }

      // Extract filename from URL
      const urlPath = new URL(downloadUrl).pathname
      const filename = decodeURIComponent(basename(urlPath))
      const destPath = join(modsDir, filename)

      writeFileSync(destPath, buffer)
      downloaded++
      log(`Downloaded: ${filename} (${(buffer.length / 1024).toFixed(0)} KB)`)
    } catch (err: any) {
      logError(`Failed to download mod ${file.projectID}/${file.fileID}`, err)
      failed++
    }
  }

  // ── Step 5: Copy overrides ──
  onProgress({ stage: 'Copying overrides...', percent: 92 })

  const overridesFolder = manifest.overrides || 'overrides'
  extractOverrides(zip, overridesFolder, instanceDir)

  // ── Done ──
  onProgress({ stage: 'Complete', percent: 100 })

  log(`Import complete: ${downloaded} mods downloaded, ${failed} failed`)
  if (failed > 0) {
    log(`⚠ ${failed} mod(s) could not be downloaded. You may need to install them manually.`)
  }

  return {
    instanceId: instance.id,
    name: manifest.name,
    modCount: downloaded
  }
}

// ============================================================
// Modrinth Import
// ============================================================

async function importModrinth(
  zip: AdmZip,
  onProgress: (progress: ImportProgress) => void
): Promise<{ instanceId: string; name: string; modCount: number }> {
  // ── Step 1: Parse index ──
  onProgress({ stage: 'Parsing modpack index...', percent: 5 })

  const indexEntry = zip.getEntry('modrinth.index.json')
  if (!indexEntry) {
    throw new Error('Invalid Modrinth modpack: missing modrinth.index.json')
  }

  const index: ModrinthIndex = JSON.parse(indexEntry.getData().toString('utf-8'))
  log(`Modpack: "${index.name}" (${index.versionId})`)
  log(`Files: ${index.files.length}`)

  // ── Step 2: Determine loader and MC version ──
  const { mcVersion, loader, loaderVersion } = parseModrinthDependencies(index.dependencies)
  log(`Minecraft: ${mcVersion}`)
  log(`Loader: ${loader} ${loaderVersion}`)

  if (!mcVersion) {
    throw new Error('Modrinth modpack is missing a Minecraft version dependency')
  }

  // ── Step 3: Create instance ──
  onProgress({ stage: 'Creating instance...', percent: 10 })

  const instance = createInstance(
    index.name,
    mcVersion,
    loader,
    undefined,
    loaderVersion
  )

  const instanceDir = getInstancePath(instance.id)
  log(`Instance created: ${instance.id} at ${instanceDir}`)

  // ── Step 4: Download files ──
  const totalFiles = index.files.length
  let downloaded = 0
  let failed = 0

  for (let i = 0; i < totalFiles; i++) {
    const file = index.files[i]
    const progressPercent = 15 + Math.floor((i / totalFiles) * 75)

    onProgress({
      stage: 'Downloading mods...',
      percent: progressPercent,
      detail: `${i + 1} / ${totalFiles}`
    })

    // Skip server-only files
    if (file.env && file.env.client === 'unsupported') {
      log(`Skipping server-only file: ${file.path}`)
      continue
    }

    const downloadUrl = file.downloads[0]
    if (!downloadUrl) {
      logError(`No download URL for file: ${file.path}`)
      failed++
      continue
    }

    try {
      const buffer = await downloadToBuffer(downloadUrl)
      if (!buffer) {
        failed++
        continue
      }

      // Verify SHA-512 hash if provided
      if (file.hashes.sha512) {
        if (!verifySha512(buffer, file.hashes.sha512)) {
          logError(`Hash verification failed for ${file.path}, skipping`)
          failed++
          continue
        }
      }

      // Write file to the correct relative path within the instance
      // Modrinth paths are like "mods/sodium-0.5.jar" or "config/something.toml"
      const destPath = join(instanceDir, ...file.path.split('/'))
      const destDirForFile = dirname(destPath)
      ensureDir(destDirForFile)

      writeFileSync(destPath, buffer)
      downloaded++

      const filename = basename(file.path)
      log(`Downloaded: ${filename} (${(buffer.length / 1024).toFixed(0)} KB)`)
    } catch (err: any) {
      logError(`Failed to download ${file.path}`, err)
      failed++
    }
  }

  // ── Step 5: Copy overrides ──
  onProgress({ stage: 'Copying overrides...', percent: 92 })

  // Modrinth supports both "overrides" and "client-overrides"
  extractOverrides(zip, 'overrides', instanceDir)
  extractOverrides(zip, 'client-overrides', instanceDir)

  // ── Done ──
  onProgress({ stage: 'Complete', percent: 100 })

  log(`Import complete: ${downloaded} files downloaded, ${failed} failed`)
  if (failed > 0) {
    log(`⚠ ${failed} file(s) could not be downloaded. You may need to install them manually.`)
  }

  return {
    instanceId: instance.id,
    name: index.name,
    modCount: downloaded
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Detect modpack format from file extension.
 */
function detectFormat(filePath: string): 'curseforge' | 'modrinth' | 'unknown' {
  const ext = extname(filePath).toLowerCase()

  if (ext === '.mrpack') {
    return 'modrinth'
  }

  if (ext === '.zip') {
    // Could be CurseForge — peek inside for manifest.json
    try {
      const zip = new AdmZip(filePath)
      if (zip.getEntry('manifest.json')) {
        return 'curseforge'
      }
      if (zip.getEntry('modrinth.index.json')) {
        return 'modrinth'
      }
    } catch {
      // Not a valid zip
    }
  }

  return 'unknown'
}

/**
 * Import a modpack from a CurseForge (.zip) or Modrinth (.mrpack) file.
 *
 * Creates a new instance with the modpack's mods, configs, and overrides.
 * Reports progress through the onProgress callback at each stage.
 *
 * @param filePath    Path to the modpack file (.zip or .mrpack)
 * @param onProgress  Callback for progress updates
 * @returns           Instance ID, name, and number of mods downloaded
 */
export async function importModpack(
  filePath: string,
  onProgress: (progress: ImportProgress) => void
): Promise<{ instanceId: string; name: string; modCount: number }> {
  log(`Starting import: ${basename(filePath)}`)

  // ── Detect format ──
  onProgress({ stage: 'Detecting format...', percent: 1 })

  const format = detectFormat(filePath)
  if (format === 'unknown') {
    throw new Error(
      `Unsupported modpack format. Expected a CurseForge .zip (with manifest.json) or Modrinth .mrpack file.`
    )
  }

  log(`Detected format: ${format}`)

  // ── Extract zip ──
  onProgress({ stage: 'Extracting archive...', percent: 3 })

  let zip: AdmZip
  try {
    zip = new AdmZip(filePath)
  } catch (err: any) {
    throw new Error(`Failed to open archive: ${err.message}`)
  }

  log(`Archive opened: ${zip.getEntries().length} entries`)

  // ── Delegate to format-specific handler ──
  if (format === 'curseforge') {
    return importCurseForge(zip, onProgress)
  } else {
    return importModrinth(zip, onProgress)
  }
}
