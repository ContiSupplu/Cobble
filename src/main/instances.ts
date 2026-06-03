import { app, shell } from 'electron'
import * as fs from 'fs/promises'
import { join, basename } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  cpSync,
  statSync,
  copyFileSync
} from 'fs'

// ============================================================
// Instance Types
// ============================================================

export interface InstanceConfig {
  id: string
  name: string
  version: string
  loader: string
  loaderVersion?: string   // Exact loader version (e.g. '21.1.99' for NeoForge)
  mods: number
  created: number
  lastPlayed: number | null
  color?: string
  backgroundImage?: string
  // New fields for Better Instances
  favorite?: boolean
  playtime?: number          // Total play seconds
  memoryMax?: number         // MB (e.g. 2048, 4096)
  jvmArgs?: string           // Custom JVM arguments
  resolution?: { width: number; height: number }
  createdBy?: string         // Profile UUID for isolation
  customIcon?: string        // Path to custom icon image
  // Launch speed optimization
  launchReady?: boolean      // True after first successful launch — skips verification
  modsHash?: string          // Hash of mods folder for cache invalidation
}

// ============================================================
// Paths
// ============================================================

const INSTANCES_DIR = join(app.getPath('userData'), 'instances')
const TRASH_DIR = join(app.getPath('userData'), 'trash')

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

async function ensureDirAsync(dir: string): Promise<void> {
  try {
    await fs.access(dir)
  } catch {
    await fs.mkdir(dir, { recursive: true })
  }
}

// ============================================================
// Helpers
// ============================================================

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function randomChars(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function generateId(name: string): string {
  const slug = slugify(name) || 'instance'
  return `${slug}-${randomChars(4)}`
}

function readInstanceJson(dir: string): InstanceConfig | null {
  const filePath = join(dir, 'instance.json')
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    }
  } catch {
    // Corrupted instance, skip
  }
  return null
}

function writeInstanceJson(dir: string, config: InstanceConfig): void {
  ensureDir(dir)
  writeFileSync(join(dir, 'instance.json'), JSON.stringify(config, null, 2), 'utf-8')
}

// ============================================================
// Public API
// ============================================================

/**
 * Assign a createdBy UUID to any instances that don't have one.
 * Called on startup to migrate old instances to the active profile.
 */
export function migrateOrphanInstances(activeUuid: string): number {
  ensureDir(INSTANCES_DIR)
  let migrated = 0
  const entries = readdirSync(INSTANCES_DIR, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const config = readInstanceJson(join(INSTANCES_DIR, entry.name))
      if (config && !config.createdBy) {
        config.createdBy = activeUuid
        writeInstanceJson(join(INSTANCES_DIR, entry.name), config)
        migrated++
      }
    }
  }
  return migrated
}

export async function getAllInstances(): Promise<InstanceConfig[]> {
  await ensureDirAsync(INSTANCES_DIR)

  const entries = await fs.readdir(INSTANCES_DIR, { withFileTypes: true })
  const instances: InstanceConfig[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const config = readInstanceJson(join(INSTANCES_DIR, entry.name))
      if (config) {
        // Dynamically count .jar files in the mods directory
        try {
          const modsDir = join(INSTANCES_DIR, entry.name, 'mods')
          if (existsSync(modsDir)) {
            const jarFiles = await fs.readdir(modsDir)
            config.mods = jarFiles.filter(f => f.endsWith('.jar')).length
          }
        } catch { /* ignore */ }
        instances.push(config)
      }
    }
  }

  // Sort: favorite first, then by last played (most recent first), then by created
  instances.sort((a, b) => {
    if (a.favorite && !b.favorite) return -1
    if (!a.favorite && b.favorite) return 1
    const aTime = a.lastPlayed ?? a.created
    const bTime = b.lastPlayed ?? b.created
    return bTime - aTime
  })
  return instances
}

// Standard Minecraft folders that every instance should have
const STANDARD_DIRS = [
  'mods',
  'config',
  'saves',
  'resourcepacks',
  'shaderpacks',
  'screenshots',
  'logs',
  'crash-reports',
]

/**
 * Ensure standard Minecraft subdirectories exist inside an instance
 */
export async function scaffoldInstanceDirs(instanceDir: string): Promise<void> {
  await Promise.all(STANDARD_DIRS.map(dir => ensureDirAsync(join(instanceDir, dir))))
}

export async function createInstance(
  name: string,
  version: string,
  loader: string,
  createdBy?: string,
  loaderVersion?: string
): Promise<InstanceConfig> {
  await ensureDirAsync(INSTANCES_DIR)

  const id = generateId(name)
  const instanceDir = join(INSTANCES_DIR, id)

  const config: InstanceConfig = {
    id,
    name,
    version,
    loader,
    ...(loaderVersion ? { loaderVersion } : {}),
    mods: 0,
    created: Date.now(),
    lastPlayed: null,
    ...(createdBy ? { createdBy } : {})
  }

  writeInstanceJson(instanceDir, config)
  // Pre-create standard Minecraft folders so the file explorer isn't empty
  await scaffoldInstanceDirs(instanceDir)
  return config
}

export async function deleteInstance(id: string): Promise<boolean | string> {
  const instanceDir = join(INSTANCES_DIR, id)

  if (!existsSync(instanceDir)) {
    return false
  }

  // Move to trash instead of permanent delete
  ensureDir(TRASH_DIR)
  const trashDest = join(TRASH_DIR, id)
  // If already in trash, remove old one first
  try {
    if (existsSync(trashDest)) await fs.rm(trashDest, { recursive: true, force: true })
  } catch { /* ignore */ }

  try {
    await fs.cp(instanceDir, trashDest, { recursive: true })
  } catch { /* copy best-effort */ }

  // Write trash metadata
  const meta = { deletedAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }
  try {
    await fs.writeFile(join(trashDest, '.trash-meta.json'), JSON.stringify(meta), 'utf-8')
  } catch { /* ignore */ }

  // Remove from instances — retry if files are locked (game still running)
  try {
    await fs.rm(instanceDir, { recursive: true, force: true })
  } catch (err: any) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      return 'Close the game first before deleting this instance.'
    }
    // Try once more after a brief pause
    try {
      await new Promise(r => setTimeout(r, 500))
      await fs.rm(instanceDir, { recursive: true, force: true })
    } catch {
      return 'Could not delete — some files are still in use. Try again in a moment.'
    }
  }
  return true
}

/** Get all trashed instances */
export async function getTrashedInstances(): Promise<(InstanceConfig & { deletedAt: number; expiresAt: number })[]> {
  await ensureDirAsync(TRASH_DIR)
  const entries = await fs.readdir(TRASH_DIR, { withFileTypes: true })
  const results: (InstanceConfig & { deletedAt: number; expiresAt: number })[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(TRASH_DIR, entry.name)
    const config = readInstanceJson(dir)
    if (!config) continue

    let deletedAt = Date.now()
    let expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
    try {
      const metaPath = join(dir, '.trash-meta.json')
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        deletedAt = meta.deletedAt
        expiresAt = meta.expiresAt
      }
    } catch { /* ignore */ }

    // Auto-expire: permanently delete if past expiry
    if (Date.now() > expiresAt) {
      await fs.rm(dir, { recursive: true, force: true })
      continue
    }

    results.push({ ...config, deletedAt, expiresAt })
  }

  return results
}

/** Recover an instance from trash */
export async function recoverInstance(id: string): Promise<InstanceConfig | null> {
  const trashDir = join(TRASH_DIR, id)
  if (!existsSync(trashDir)) return null

  const config = readInstanceJson(trashDir)
  if (!config) return null

  await ensureDirAsync(INSTANCES_DIR)
  const destDir = join(INSTANCES_DIR, id)
  await fs.cp(trashDir, destDir, { recursive: true })

  // Remove trash metadata
  const metaPath = join(destDir, '.trash-meta.json')
  if (existsSync(metaPath)) await fs.rm(metaPath)

  // Remove from trash
  await fs.rm(trashDir, { recursive: true, force: true })
  return config
}

/** Permanently delete from trash */
export async function permanentlyDeleteInstance(id: string): Promise<boolean> {
  const trashDir = join(TRASH_DIR, id)
  if (!existsSync(trashDir)) return false
  await fs.rm(trashDir, { recursive: true, force: true })
  return true
}

export function updateInstance(
  id: string,
  updates: Partial<Omit<InstanceConfig, 'id' | 'created'>>
): InstanceConfig | null {
  const instanceDir = join(INSTANCES_DIR, id)
  const config = readInstanceJson(instanceDir)

  if (!config) {
    return null
  }

  const updated: InstanceConfig = {
    ...config,
    ...updates,
    id: config.id,       // Prevent overwriting id
    created: config.created // Prevent overwriting created
  }

  writeInstanceJson(instanceDir, updated)
  return updated
}

export async function cloneInstance(id: string, newName: string, targetProfileId?: string): Promise<InstanceConfig | null> {
  const sourceDir = join(INSTANCES_DIR, id)
  const sourceConfig = readInstanceJson(sourceDir)

  if (!sourceConfig) return null

  const newId = generateId(newName)
  const destDir = join(INSTANCES_DIR, newId)

  // Copy entire instance directory (mods, configs, worlds, etc.)
  await fs.cp(sourceDir, destDir, { recursive: true })

  const cloned: InstanceConfig = {
    ...sourceConfig,
    id: newId,
    name: newName,
    created: Date.now(),
    lastPlayed: null,
    favorite: false,
    playtime: 0,
    // If duplicating to another profile, set the new owner
    ...(targetProfileId ? { createdBy: targetProfileId } : {})
  }

  writeInstanceJson(destDir, cloned)
  return cloned
}

export function openInstanceFolder(id: string): boolean {
  const instanceDir = join(INSTANCES_DIR, id)
  if (!existsSync(instanceDir)) return false
  shell.openPath(instanceDir)
  return true
}

export function getInstancePath(id: string): string {
  return join(INSTANCES_DIR, id)
}

// ============================================================
// File Explorer — In-App File Browser
// ============================================================

export interface FileEntry {
  name: string
  path: string         // Relative to instance root
  isDirectory: boolean
  size: number         // Bytes (0 for dirs)
  modified: number     // Timestamp
  extension: string    // e.g. '.jar', '.json'
}

/**
 * Ensure a resolved path is within the instance dir (security)
 */
function assertWithin(instanceDir: string, targetPath: string): void {
  const resolved = join(instanceDir, targetPath).replace(/\\/g, '/')
  const base = instanceDir.replace(/\\/g, '/')
  if (!resolved.startsWith(base)) {
    throw new Error('Path traversal detected')
  }
}

/**
 * List files/folders at a relative path within an instance
 */
export async function listInstanceDir(id: string, relativePath: string = ''): Promise<FileEntry[]> {
  const instanceDir = join(INSTANCES_DIR, id)
  assertWithin(instanceDir, relativePath)

  // Auto-scaffold standard folders if browsing root
  if (!relativePath || relativePath === '') {
    await scaffoldInstanceDirs(instanceDir)
  }

  const targetDir = join(instanceDir, relativePath)

  if (!existsSync(targetDir)) return []

  const entries = await fs.readdir(targetDir, { withFileTypes: true })
  const results: FileEntry[] = []

  for (const entry of entries) {
    // Skip instance.json from the listing (internal)
    if (relativePath === '' && entry.name === 'instance.json') continue

    const fullPath = join(targetDir, entry.name)
    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    const isDir = entry.isDirectory()

    let size = 0
    let modified = Date.now()
    try {
      const stat = await fs.stat(fullPath)
      size = isDir ? 0 : stat.size
      modified = stat.mtimeMs
    } catch { /* skip */ }

    const ext = isDir ? '' : (entry.name.includes('.') ? '.' + entry.name.split('.').pop()! : '')

    results.push({
      name: entry.name,
      path: relPath,
      isDirectory: isDir,
      size,
      modified,
      extension: ext.toLowerCase(),
    })
  }

  // Sort: folders first, then by name
  results.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return results
}

/**
 * Delete a file or folder within an instance
 */
export async function deleteInstanceFile(id: string, relativePath: string): Promise<boolean> {
  const instanceDir = join(INSTANCES_DIR, id)
  assertWithin(instanceDir, relativePath)
  const target = join(instanceDir, relativePath)

  if (!existsSync(target)) return false
  await fs.rm(target, { recursive: true, force: true })
  return true
}

/**
 * Rename a file or folder within an instance
 */
export function renameInstanceFile(id: string, relativePath: string, newName: string): boolean {
  const instanceDir = join(INSTANCES_DIR, id)
  assertWithin(instanceDir, relativePath)
  const target = join(instanceDir, relativePath)

  if (!existsSync(target)) return false

  const parentDir = join(target, '..')
  const dest = join(parentDir, newName)
  assertWithin(instanceDir, dest.replace(instanceDir, '').replace(/^[\\/]+/, ''))

  const { renameSync } = require('fs')
  renameSync(target, dest)
  return true
}

/**
 * Open a file with the system default app
 */
export function openInstanceFile(id: string, relativePath: string): boolean {
  const instanceDir = join(INSTANCES_DIR, id)
  assertWithin(instanceDir, relativePath)
  const target = join(instanceDir, relativePath)

  if (!existsSync(target)) return false
  shell.openPath(target)
  return true
}

/**
 * Copy files from absolute OS paths into a subdirectory of an instance.
 * Used by drag-and-drop to import mods, resource packs, etc.
 */
export async function copyFilesToInstance(
  id: string,
  relativeDest: string,
  filePaths: string[]
): Promise<{ copied: number; errors: string[] }> {
  const instanceDir = join(INSTANCES_DIR, id)
  assertWithin(instanceDir, relativeDest)

  const destDir = join(instanceDir, relativeDest)
  await ensureDirAsync(destDir)

  let copied = 0
  const errors: string[] = []

  for (const srcPath of filePaths) {
    try {
      if (!existsSync(srcPath)) {
        errors.push(`File not found: ${srcPath}`)
        continue
      }
      const fileName = basename(srcPath)
      const destPath = join(destDir, fileName)
      await fs.copyFile(srcPath, destPath)
      copied++
    } catch (err: any) {
      errors.push(`Failed to copy ${srcPath}: ${err.message}`)
    }
  }

  return { copied, errors }
}

// ============================================================
// Launch Speed — Ready Flag Helpers
// ============================================================

import { createHash } from 'crypto'

/**
 * Compute a fast hash of the mods folder (filenames + sizes).
 * Used to detect when mods change and invalidate the launch cache.
 */
export function computeModsHash(id: string): string {
  const modsDir = join(INSTANCES_DIR, id, 'mods')
  if (!existsSync(modsDir)) return 'empty'
  try {
    const files = readdirSync(modsDir)
      .filter(f => f.endsWith('.jar'))
      .sort()
      .map(f => {
        try {
          const s = statSync(join(modsDir, f))
          return `${f}:${s.size}`
        } catch { return f }
      })
    return createHash('md5').update(files.join('|')).digest('hex').substring(0, 12)
  } catch { return 'error' }
}

/**
 * Mark an instance as launch-ready (all files verified, skip on next launch).
 */
export function markLaunchReady(id: string): void {
  const dir = join(INSTANCES_DIR, id)
  const config = readInstanceJson(dir)
  if (config) {
    config.launchReady = true
    config.modsHash = computeModsHash(id)
    writeInstanceJson(dir, config)
  }
}

/**
 * Invalidate launch-ready status (e.g. mod installed/removed, version changed).
 * Also removes the AppCDS archive since the class list will be different.
 */
export function invalidateLaunchReady(id: string): void {
  const dir = join(INSTANCES_DIR, id)
  const config = readInstanceJson(dir)
  if (config && config.launchReady) {
    config.launchReady = false
    config.modsHash = undefined
    writeInstanceJson(dir, config)
    // Delete AppCDS archive — class list is now stale
    try {
      const cdsPath = join(dir, 'mc.jsa')
      const clsPath = join(dir, 'mc-classlist.txt')
      if (existsSync(cdsPath)) { require('fs').unlinkSync(cdsPath); console.log('[Instances] AppCDS archive invalidated') }
      if (existsSync(clsPath)) { require('fs').unlinkSync(clsPath) }
    } catch { /* non-critical */ }
  }
}
