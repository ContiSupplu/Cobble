import { net } from 'electron'
import { join, basename, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'

// ============================================================
// Modpack Installer — CurseForge & Modrinth
// ============================================================
//
// Handles importing modpacks from CurseForge (.zip) and
// Modrinth (.mrpack) formats. Downloads mods in parallel,
// extracts overrides, and reports progress via callback.
// ============================================================

const MODRINTH_UA = 'Loom/1.3.0 (minecraft-launcher)'

// ============================================================
// Types
// ============================================================

export interface ModpackImportProgress {
  stage: string
  progress: number
  detail?: string
}

export interface ModpackInfo {
  name: string
  version: string
  mcVersion: string
  loader: string
  loaderVersion?: string
  modCount: number
  source: 'curseforge' | 'modrinth'
}

type ProgressCallback = (progress: ModpackImportProgress) => void

// CurseForge manifest.json types
interface CFManifest {
  minecraft: {
    version: string
    modLoaders: { id: string; primary: boolean }[]
  }
  manifestType: string
  manifestVersion: number
  name: string
  version: string
  author: string
  files: { projectID: number; fileID: number; required: boolean }[]
  overrides: string
}

// Modrinth modrinth.index.json types
interface MRIndex {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: {
    path: string
    hashes: { sha1: string; sha512: string }
    env?: { client: string; server: string }
    downloads: string[]
    fileSize: number
  }[]
  dependencies: Record<string, string>
}

// Modrinth search result types
export interface ModrinthSearchResult {
  slug: string
  title: string
  description: string
  project_type: string
  downloads: number
  icon_url: string
  versions: string[]
  categories: string[]
  author: string
}

export interface ModrinthSearchResponse {
  hits: ModrinthSearchResult[]
  offset: number
  limit: number
  total_hits: number
}

// ============================================================
// ZIP Extraction (yauzl)
// ============================================================

function extractZip(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Buffer>()
    const yauzl = require('yauzl')
    yauzl.open(zipPath, { lazyEntries: true }, (err: any, zipfile: any) => {
      if (err) return reject(err)
      zipfile.readEntry()
      zipfile.on('entry', (entry: any) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry()
          return
        }
        zipfile.openReadStream(entry, (err2: any, readStream: any) => {
          if (err2) return reject(err2)
          const chunks: Buffer[] = []
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
          readStream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks))
            zipfile.readEntry()
          })
        })
      })
      zipfile.on('end', () => resolve(entries))
      zipfile.on('error', reject)
    })
  })
}

// ============================================================
// Download Helpers
// ============================================================

async function downloadFile(url: string, destPath: string): Promise<void> {
  const dir = dirname(destPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  writeFileSync(destPath, buffer)
}

async function parallelDownload(
  tasks: Array<{ url: string; dest: string }>,
  maxConcurrent: number,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  let completed = 0
  const total = tasks.length
  const executing = new Set<Promise<void>>()

  for (const task of tasks) {
    const p = downloadFile(task.url, task.dest)
      .then(() => {
        completed++
        onProgress?.(completed, total)
        executing.delete(p)
      })
      .catch((err) => {
        console.warn(`[ModpackInstaller] Failed to download ${task.url}: ${err.message}`)
        completed++
        onProgress?.(completed, total)
        executing.delete(p)
      })
    executing.add(p)
    if (executing.size >= maxConcurrent) {
      await Promise.race(executing)
    }
  }
  await Promise.all(executing)
}

// ============================================================
// Override Extraction
// ============================================================

function extractOverrides(
  entries: Map<string, Buffer>,
  prefix: string,
  instancePath: string
): void {
  const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/'
  entries.forEach((data, path) => {
    if (!path.startsWith(normalizedPrefix)) return
    const relative = path.slice(normalizedPrefix.length)
    if (!relative) return
    const destPath = join(instancePath, relative)
    const destDir = dirname(destPath)
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    writeFileSync(destPath, data)
  })
}

// ============================================================
// Loader Parsing Helpers
// ============================================================

function parseCFLoader(modLoaderId: string): { loader: string; loaderVersion?: string } {
  // CurseForge format: 'forge-47.2.0', 'fabric-0.14.22', 'neoforge-21.1.1'
  const parts = modLoaderId.split('-')
  const rawLoader = parts[0] || 'unknown'
  const loaderVersion = parts.slice(1).join('-') || undefined
  // Capitalize to match launcher's expected format
  const loaderMap: Record<string, string> = {
    fabric: 'Fabric',
    forge: 'Forge',
    neoforge: 'NeoForge',
    quilt: 'Quilt',
  }
  const loader = loaderMap[rawLoader.toLowerCase()] || rawLoader
  return { loader, loaderVersion }
}

function parseMRLoader(dependencies: Record<string, string>): { loader: string; loaderVersion?: string } {
  const loaderKeys: Record<string, string> = {
    'fabric-loader': 'Fabric',
    'forge': 'Forge',
    'neoforge': 'NeoForge',
    'quilt-loader': 'Quilt',
  }
  for (const [key, name] of Object.entries(loaderKeys)) {
    if (dependencies[key]) {
      return { loader: name, loaderVersion: dependencies[key] }
    }
  }
  return { loader: 'Vanilla' }
}

// ============================================================
// 1. Parse Modpack File
// ============================================================

export async function parseModpackFile(filePath: string): Promise<ModpackInfo> {
  console.log(`[ModpackInstaller] Parsing modpack: ${filePath}`)
  const entries = await extractZip(filePath)
  const ext = filePath.toLowerCase()

  if (ext.endsWith('.mrpack')) {
    // Modrinth format
    const indexBuf = entries.get('modrinth.index.json')
    if (!indexBuf) throw new Error('Invalid .mrpack: missing modrinth.index.json')
    const index: MRIndex = JSON.parse(indexBuf.toString('utf-8'))
    const { loader, loaderVersion } = parseMRLoader(index.dependencies)
    const mcVersion = index.dependencies['minecraft'] || 'unknown'

    console.log(`[ModpackInstaller] Modrinth pack: ${index.name} v${index.versionId} (MC ${mcVersion}, ${loader})`)
    return {
      name: index.name,
      version: index.versionId,
      mcVersion,
      loader,
      loaderVersion,
      modCount: index.files.length,
      source: 'modrinth',
    }
  } else {
    // CurseForge format (.zip)
    const manifestBuf = entries.get('manifest.json')
    if (!manifestBuf) throw new Error('Invalid CurseForge zip: missing manifest.json')
    const manifest: CFManifest = JSON.parse(manifestBuf.toString('utf-8'))
    const primaryLoader = manifest.minecraft.modLoaders.find((l) => l.primary) || manifest.minecraft.modLoaders[0]
    const { loader, loaderVersion } = primaryLoader
      ? parseCFLoader(primaryLoader.id)
      : { loader: 'unknown', loaderVersion: undefined }

    console.log(`[ModpackInstaller] CurseForge pack: ${manifest.name} v${manifest.version} (MC ${manifest.minecraft.version}, ${loader})`)
    return {
      name: manifest.name,
      version: manifest.version,
      mcVersion: manifest.minecraft.version,
      loader,
      loaderVersion,
      modCount: manifest.files.length,
      source: 'curseforge',
    }
  }
}

// ============================================================
// 2. Install Modrinth Pack
// ============================================================

export async function installModrinthPack(
  mrpackPath: string,
  instancePath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  console.log(`[ModpackInstaller] Installing Modrinth pack: ${mrpackPath}`)
  onProgress?.({ stage: 'extracting', progress: 0, detail: 'Extracting modpack...' })

  const entries = await extractZip(mrpackPath)
  const indexBuf = entries.get('modrinth.index.json')
  if (!indexBuf) throw new Error('Invalid .mrpack: missing modrinth.index.json')
  const index: MRIndex = JSON.parse(indexBuf.toString('utf-8'))

  // Ensure instance directory exists
  if (!existsSync(instancePath)) mkdirSync(instancePath, { recursive: true })

  // Filter files: skip env.client === 'unsupported'
  const downloadableFiles = index.files.filter((f) => {
    if (f.env?.client === 'unsupported') return false
    return true
  })

  console.log(`[ModpackInstaller] ${downloadableFiles.length} files to download (${index.files.length} total)`)
  onProgress?.({ stage: 'downloading', progress: 0, detail: `0/${downloadableFiles.length} files` })

  // Build download tasks
  const tasks = downloadableFiles
    .filter((f) => f.downloads.length > 0)
    .map((f) => ({
      url: f.downloads[0],
      dest: join(instancePath, f.path),
    }))

  // Download with concurrency limit of 10
  await parallelDownload(tasks, 10, (done, total) => {
    const pct = Math.round((done / total) * 100)
    onProgress?.({ stage: 'downloading', progress: pct, detail: `${done}/${total} files` })
  })

  // Extract overrides/ and client-overrides/
  onProgress?.({ stage: 'overrides', progress: 90, detail: 'Applying overrides...' })
  extractOverrides(entries, 'overrides', instancePath)
  extractOverrides(entries, 'client-overrides', instancePath)

  console.log(`[ModpackInstaller] Modrinth pack installed to ${instancePath}`)
  onProgress?.({ stage: 'done', progress: 100, detail: 'Installation complete' })
}

// ============================================================
// 3. Install CurseForge Pack
// ============================================================

export async function installCurseForgePack(
  zipPath: string,
  instancePath: string,
  curseforgeApiKey: string | null,
  onProgress?: ProgressCallback
): Promise<void> {
  console.log(`[ModpackInstaller] Installing CurseForge pack: ${zipPath}`)
  onProgress?.({ stage: 'extracting', progress: 0, detail: 'Extracting modpack...' })

  const entries = await extractZip(zipPath)
  const manifestBuf = entries.get('manifest.json')
  if (!manifestBuf) throw new Error('Invalid CurseForge zip: missing manifest.json')
  const manifest: CFManifest = JSON.parse(manifestBuf.toString('utf-8'))

  // Ensure instance directory exists
  if (!existsSync(instancePath)) mkdirSync(instancePath, { recursive: true })

  const modsDir = join(instancePath, 'mods')
  if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true })

  const fileIds = manifest.files.map((f) => f.fileID)
  console.log(`[ModpackInstaller] ${fileIds.length} mods to resolve`)
  onProgress?.({ stage: 'resolving', progress: 5, detail: `Resolving ${fileIds.length} mod files...` })

  // Resolve download URLs via CurseForge API
  let fileMap = new Map<number, { downloadUrl: string | null; fileName: string }>()

  if (curseforgeApiKey && fileIds.length > 0) {
    try {
      const res = await net.fetch('https://api.curseforge.com/v1/mods/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': curseforgeApiKey,
          Accept: 'application/json',
        },
        body: JSON.stringify({ fileIds }),
      })

      if (res.ok) {
        const body = await res.json() as any
        const files: any[] = body.data || []
        for (const f of files) {
          fileMap.set(f.id, {
            downloadUrl: f.downloadUrl || null,
            fileName: f.fileName || `${f.id}.jar`,
          })
        }
        console.log(`[ModpackInstaller] Resolved ${fileMap.size}/${fileIds.length} file URLs`)
      } else {
        console.warn(`[ModpackInstaller] CurseForge API responded with ${res.status}`)
      }
    } catch (err: any) {
      console.warn(`[ModpackInstaller] CurseForge API request failed: ${err.message}`)
    }
  } else if (!curseforgeApiKey) {
    console.warn('[ModpackInstaller] No CurseForge API key provided — cannot resolve download URLs')
  }

  // Download mods
  onProgress?.({ stage: 'downloading', progress: 10, detail: `0/${fileIds.length} mods` })

  const tasks: Array<{ url: string; dest: string }> = []
  let skipped = 0

  for (const file of manifest.files) {
    const info = fileMap.get(file.fileID)
    if (!info || !info.downloadUrl) {
      console.warn(`[ModpackInstaller] Skipping file ${file.fileID} (project ${file.projectID}) — no download URL`)
      skipped++
      continue
    }
    tasks.push({
      url: info.downloadUrl,
      dest: join(modsDir, info.fileName),
    })
  }

  if (skipped > 0) {
    console.log(`[ModpackInstaller] ${skipped} mod(s) skipped (no download URL available)`)
  }

  await parallelDownload(tasks, 10, (done, total) => {
    const pct = 10 + Math.round((done / total) * 80)
    onProgress?.({ stage: 'downloading', progress: pct, detail: `${done}/${total} mods` })
  })

  // Extract overrides
  onProgress?.({ stage: 'overrides', progress: 92, detail: 'Applying overrides...' })
  const overridesPrefix = manifest.overrides || 'overrides'
  extractOverrides(entries, overridesPrefix, instancePath)

  console.log(`[ModpackInstaller] CurseForge pack installed to ${instancePath}`)
  onProgress?.({ stage: 'done', progress: 100, detail: 'Installation complete' })
}

// ============================================================
// 4. Search Modrinth Modpacks
// ============================================================

export async function searchModrinthModpacks(
  query: string,
  offset: number = 0,
  limit: number = 20
): Promise<ModrinthSearchResponse> {
  const facets = encodeURIComponent('[["project_type:modpack"]]')
  const q = encodeURIComponent(query)
  const url = `https://api.modrinth.com/v2/search?query=${q}&facets=${facets}&limit=${limit}&offset=${offset}`

  console.log(`[ModpackInstaller] Searching Modrinth modpacks: "${query}" (offset=${offset}, limit=${limit})`)
  const res = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
  if (!res.ok) throw new Error(`Modrinth search failed: ${res.status}`)

  const data = (await res.json()) as ModrinthSearchResponse
  console.log(`[ModpackInstaller] Found ${data.total_hits} results`)
  return data
}

// ============================================================
// 5. Get Modrinth Pack Versions
// ============================================================

export async function getModrinthPackVersions(projectId: string): Promise<any[]> {
  const url = `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`
  console.log(`[ModpackInstaller] Fetching versions for project: ${projectId}`)

  const res = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
  if (!res.ok) throw new Error(`Failed to fetch versions: ${res.status}`)

  const versions = (await res.json()) as any[]
  console.log(`[ModpackInstaller] ${versions.length} version(s) found for ${projectId}`)
  return versions
}

// ============================================================
// 6. Download Modrinth Pack
// ============================================================

export async function downloadModrinthPack(
  projectId: string,
  versionId: string,
  destDir: string
): Promise<string> {
  console.log(`[ModpackInstaller] Downloading pack: project=${projectId}, version=${versionId}`)

  // Get version info
  const url = `https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`
  const res = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
  if (!res.ok) throw new Error(`Failed to fetch version info: ${res.status}`)

  const version = (await res.json()) as any
  const primaryFile = version.files?.find((f: any) => f.primary) || version.files?.[0]
  if (!primaryFile) throw new Error('No downloadable file found for this version')

  const fileName = primaryFile.filename || `${projectId}-${versionId}.mrpack`
  const destPath = join(destDir, fileName)

  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

  console.log(`[ModpackInstaller] Downloading ${fileName} to ${destDir}`)
  await downloadFile(primaryFile.url, destPath)
  console.log(`[ModpackInstaller] Download complete: ${destPath}`)

  return destPath
}
