import { app, shell } from 'electron'
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

export function getAllInstances(): InstanceConfig[] {
  ensureDir(INSTANCES_DIR)

  const entries = readdirSync(INSTANCES_DIR, { withFileTypes: true })
  const instances: InstanceConfig[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const config = readInstanceJson(join(INSTANCES_DIR, entry.name))
      if (config) {
        // Dynamically count .jar files in the mods directory
        try {
          const modsDir = join(INSTANCES_DIR, entry.name, 'mods')
          if (existsSync(modsDir)) {
            const jarCount = readdirSync(modsDir).filter(f => f.endsWith('.jar')).length
            config.mods = jarCount
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
export function scaffoldInstanceDirs(instanceDir: string): void {
  for (const dir of STANDARD_DIRS) {
    ensureDir(join(instanceDir, dir))
  }
}

export function createInstance(
  name: string,
  version: string,
  loader: string,
  createdBy?: string,
  loaderVersion?: string
): InstanceConfig {
  ensureDir(INSTANCES_DIR)

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
  scaffoldInstanceDirs(instanceDir)
  return config
}

export function deleteInstance(id: string): boolean {
  const instanceDir = join(INSTANCES_DIR, id)

  if (!existsSync(instanceDir)) {
    return false
  }

  // Move to trash instead of permanent delete
  ensureDir(TRASH_DIR)
  const trashDest = join(TRASH_DIR, id)
  // If already in trash, remove old one first
  if (existsSync(trashDest)) rmSync(trashDest, { recursive: true, force: true })
  cpSync(instanceDir, trashDest, { recursive: true })

  // Write trash metadata
  const meta = { deletedAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }
  writeFileSync(join(trashDest, '.trash-meta.json'), JSON.stringify(meta), 'utf-8')

  // Remove from instances
  rmSync(instanceDir, { recursive: true, force: true })
  return true
}

/** Get all trashed instances */
export function getTrashedInstances(): (InstanceConfig & { deletedAt: number; expiresAt: number })[] {
  ensureDir(TRASH_DIR)
  const entries = readdirSync(TRASH_DIR, { withFileTypes: true })
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
      rmSync(dir, { recursive: true, force: true })
      continue
    }

    results.push({ ...config, deletedAt, expiresAt })
  }

  return results
}

/** Recover an instance from trash */
export function recoverInstance(id: string): InstanceConfig | null {
  const trashDir = join(TRASH_DIR, id)
  if (!existsSync(trashDir)) return null

  const config = readInstanceJson(trashDir)
  if (!config) return null

  ensureDir(INSTANCES_DIR)
  const destDir = join(INSTANCES_DIR, id)
  cpSync(trashDir, destDir, { recursive: true })

  // Remove trash metadata
  const metaPath = join(destDir, '.trash-meta.json')
  if (existsSync(metaPath)) rmSync(metaPath)

  // Remove from trash
  rmSync(trashDir, { recursive: true, force: true })
  return config
}

/** Permanently delete from trash */
export function permanentlyDeleteInstance(id: string): boolean {
  const trashDir = join(TRASH_DIR, id)
  if (!existsSync(trashDir)) return false
  rmSync(trashDir, { recursive: true, force: true })
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

export function cloneInstance(id: string, newName: string, targetProfileId?: string): InstanceConfig | null {
  const sourceDir = join(INSTANCES_DIR, id)
  const sourceConfig = readInstanceJson(sourceDir)

  if (!sourceConfig) return null

  const newId = generateId(newName)
  const destDir = join(INSTANCES_DIR, newId)

  // Copy entire instance directory (mods, configs, worlds, etc.)
  cpSync(sourceDir, destDir, { recursive: true })

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
export function listInstanceDir(id: string, relativePath: string = ''): FileEntry[] {
  const instanceDir = join(INSTANCES_DIR, id)
  assertWithin(instanceDir, relativePath)

  // Auto-scaffold standard folders if browsing root
  if (!relativePath || relativePath === '') {
    scaffoldInstanceDirs(instanceDir)
  }

  const targetDir = join(instanceDir, relativePath)

  if (!existsSync(targetDir)) return []

  const entries = readdirSync(targetDir, { withFileTypes: true })
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
      const stat = statSync(fullPath)
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
export function deleteInstanceFile(id: string, relativePath: string): boolean {
  const instanceDir = join(INSTANCES_DIR, id)
  assertWithin(instanceDir, relativePath)
  const target = join(instanceDir, relativePath)

  if (!existsSync(target)) return false
  rmSync(target, { recursive: true, force: true })
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
export function copyFilesToInstance(
  id: string,
  relativeDest: string,
  filePaths: string[]
): { copied: number; errors: string[] } {
  const instanceDir = join(INSTANCES_DIR, id)
  assertWithin(instanceDir, relativeDest)

  const destDir = join(instanceDir, relativeDest)
  ensureDir(destDir)

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
      copyFileSync(srcPath, destPath)
      copied++
    } catch (err: any) {
      errors.push(`Failed to copy ${srcPath}: ${err.message}`)
    }
  }

  return { copied, errors }
}
