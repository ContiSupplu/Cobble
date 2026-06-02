import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
  readdirSync,
  cpSync,
  rmSync
} from 'fs'
import { join, relative } from 'path'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SyncableItem {
  id: string
  type: 'file' | 'directory'
  relativePath: string
  label: string
  category: 'settings' | 'worlds' | 'resources'
  versionSensitive: boolean
}

export interface SyncGroup {
  id: string
  name: string
  items: string[]
  instanceIds: string[]
  conflictStrategy: 'newest' | 'manual'
  createdAt: number
}

export interface SyncConfig {
  version: 1
  groups: SyncGroup[]
}

export interface SyncMeta {
  files: Record<string, { hash: string; mtime: number; size: number }>
}

export interface SyncResult {
  synced: number
  skipped: number
  errors: string[]
}

export interface SyncGroupStats {
  files: number
  totalSize: number
  instances: number
}

// ---------------------------------------------------------------------------
// Predefined Syncable Items
// ---------------------------------------------------------------------------

const SYNCABLE_ITEMS: SyncableItem[] = [
  {
    id: 'options',
    type: 'file',
    relativePath: 'options.txt',
    label: 'Video & Controls',
    category: 'settings',
    versionSensitive: true
  },
  {
    id: 'servers',
    type: 'file',
    relativePath: 'servers.dat',
    label: 'Server List',
    category: 'settings',
    versionSensitive: false
  },
  {
    id: 'saves',
    type: 'directory',
    relativePath: 'saves',
    label: 'Worlds',
    category: 'worlds',
    versionSensitive: false
  },
  {
    id: 'config',
    type: 'directory',
    relativePath: 'config',
    label: 'Mod Configs',
    category: 'settings',
    versionSensitive: false
  },
  {
    id: 'resourcepacks',
    type: 'directory',
    relativePath: 'resourcepacks',
    label: 'Resource Packs',
    category: 'resources',
    versionSensitive: false
  },
  {
    id: 'shaderpacks',
    type: 'directory',
    relativePath: 'shaderpacks',
    label: 'Shader Packs',
    category: 'resources',
    versionSensitive: false
  }
]

// ---------------------------------------------------------------------------
// Path Helpers
// ---------------------------------------------------------------------------

function getSyncStorePath(): string {
  return join(app.getPath('userData'), 'sync-store')
}

function getConfigPath(): string {
  return join(getSyncStorePath(), 'sync-config.json')
}

function getGroupPath(groupId: string): string {
  return join(getSyncStorePath(), 'groups', groupId)
}

function getGroupMetaPath(groupId: string): string {
  return join(getGroupPath(groupId), '.sync-meta.json')
}

function getInstancePath(instanceId: string): string {
  return join(app.getPath('userData'), 'instances', instanceId)
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function hashFile(filePath: string): string {
  const data = readFileSync(filePath)
  return createHash('sha256').update(data).digest('hex')
}

function hashDirectory(dirPath: string): string {
  const hash = createHash('sha256')
  const entries = getAllFiles(dirPath)
  // Sort for deterministic hashing
  entries.sort()
  for (const entry of entries) {
    const rel = relative(dirPath, entry)
    hash.update(rel)
    hash.update(readFileSync(entry))
  }
  return hash.digest('hex')
}

function getAllFiles(dirPath: string): string[] {
  const results: string[] = []
  if (!existsSync(dirPath)) return results
  const entries = readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath))
    } else {
      results.push(fullPath)
    }
  }
  return results
}

function getDirectorySize(dirPath: string): number {
  let total = 0
  const files = getAllFiles(dirPath)
  for (const f of files) {
    try {
      total += statSync(f).size
    } catch {
      // skip inaccessible files
    }
  }
  return total
}

function computeHash(fullPath: string, type: 'file' | 'directory'): string {
  if (type === 'directory') {
    return hashDirectory(fullPath)
  }
  return hashFile(fullPath)
}

// ---------------------------------------------------------------------------
// Sync Meta
// ---------------------------------------------------------------------------

function loadSyncMeta(groupId: string): SyncMeta {
  const metaPath = getGroupMetaPath(groupId)
  if (existsSync(metaPath)) {
    try {
      return JSON.parse(readFileSync(metaPath, 'utf-8')) as SyncMeta
    } catch (err) {
      console.error(`[FileSync] Failed to load sync meta for group ${groupId}:`, err)
    }
  }
  return { files: {} }
}

function saveSyncMeta(groupId: string, meta: SyncMeta): void {
  const metaPath = getGroupMetaPath(groupId)
  ensureDir(getGroupPath(groupId))
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// Sync Config Management
// ---------------------------------------------------------------------------

export function getSyncConfig(): SyncConfig {
  const configPath = getConfigPath()
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as SyncConfig
    } catch (err) {
      console.error('[FileSync] Failed to load sync config:', err)
    }
  }
  return { version: 1, groups: [] }
}

export function saveSyncConfig(config: SyncConfig): void {
  const storePath = getSyncStorePath()
  ensureDir(storePath)
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
  console.log('[FileSync] Sync config saved')
}

export function createSyncGroup(
  name: string,
  items: string[],
  instanceIds: string[]
): SyncGroup {
  const config = getSyncConfig()
  const group: SyncGroup = {
    id: randomUUID(),
    name,
    items,
    instanceIds,
    conflictStrategy: 'newest',
    createdAt: Date.now()
  }
  config.groups.push(group)
  saveSyncConfig(config)

  // Create group directory
  ensureDir(getGroupPath(group.id))
  console.log(`[FileSync] Created sync group "${name}" (${group.id}) with items [${items.join(', ')}]`)
  return group
}

export function deleteSyncGroup(groupId: string): void {
  const config = getSyncConfig()
  const idx = config.groups.findIndex((g) => g.id === groupId)
  if (idx === -1) {
    console.warn(`[FileSync] Sync group ${groupId} not found, nothing to delete`)
    return
  }
  config.groups.splice(idx, 1)
  saveSyncConfig(config)

  // Remove canonical files
  const groupDir = getGroupPath(groupId)
  if (existsSync(groupDir)) {
    try {
      rmSync(groupDir, { recursive: true, force: true })
    } catch (err) {
      console.error(`[FileSync] Failed to remove group directory ${groupDir}:`, err)
    }
  }
  console.log(`[FileSync] Deleted sync group ${groupId}`)
}

export function addInstanceToGroup(groupId: string, instanceId: string): void {
  const config = getSyncConfig()
  const group = config.groups.find((g) => g.id === groupId)
  if (!group) {
    console.warn(`[FileSync] Sync group ${groupId} not found`)
    return
  }
  if (!group.instanceIds.includes(instanceId)) {
    group.instanceIds.push(instanceId)
    saveSyncConfig(config)
    console.log(`[FileSync] Added instance ${instanceId} to group "${group.name}"`)
  }
}

export function removeInstanceFromGroup(groupId: string, instanceId: string): void {
  const config = getSyncConfig()
  const group = config.groups.find((g) => g.id === groupId)
  if (!group) {
    console.warn(`[FileSync] Sync group ${groupId} not found`)
    return
  }
  const idx = group.instanceIds.indexOf(instanceId)
  if (idx !== -1) {
    group.instanceIds.splice(idx, 1)
    saveSyncConfig(config)
    console.log(`[FileSync] Removed instance ${instanceId} from group "${group.name}"`)
  }
}

export function getSyncableItems(): SyncableItem[] {
  return SYNCABLE_ITEMS
}

// ---------------------------------------------------------------------------
// Backup Helper
// ---------------------------------------------------------------------------

function backupInstanceFile(
  instanceDir: string,
  relativePath: string,
  type: 'file' | 'directory'
): void {
  const sourcePath = join(instanceDir, relativePath)
  if (!existsSync(sourcePath)) return

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(instanceDir, '.sync-backup', timestamp)
  const backupTarget = join(backupDir, relativePath)

  try {
    if (type === 'directory') {
      ensureDir(backupTarget)
      cpSync(sourcePath, backupTarget, { recursive: true })
    } else {
      ensureDir(join(backupDir, relative(instanceDir, join(instanceDir, relativePath, '..'))))
      copyFileSync(sourcePath, backupTarget)
    }
    console.log(`[FileSync] Backed up ${relativePath} to ${backupDir}`)
  } catch (err) {
    console.error(`[FileSync] Failed to backup ${relativePath}:`, err)
  }
}

// ---------------------------------------------------------------------------
// Copy Helpers
// ---------------------------------------------------------------------------

function copyItem(
  src: string,
  dest: string,
  type: 'file' | 'directory'
): void {
  if (type === 'directory') {
    ensureDir(dest)
    cpSync(src, dest, { recursive: true })
  } else {
    // Ensure parent directory exists
    const parentDir = join(dest, '..')
    ensureDir(parentDir)
    copyFileSync(src, dest)
  }
}

// ---------------------------------------------------------------------------
// Pre-Launch Sync: canonical → instance
// ---------------------------------------------------------------------------

export function syncToInstance(instanceId: string): SyncResult {
  const result: SyncResult = { synced: 0, skipped: 0, errors: [] }

  try {
    const config = getSyncConfig()
    const instanceDir = getInstancePath(instanceId)
    const groups = config.groups.filter((g) => g.instanceIds.includes(instanceId))

    if (groups.length === 0) {
      console.log(`[FileSync] No sync groups for instance ${instanceId}, skipping pre-launch sync`)
      return result
    }

    console.log(
      `[FileSync] Pre-launch sync for instance ${instanceId} — ${groups.length} group(s)`
    )

    for (const group of groups) {
      const meta = loadSyncMeta(group.id)

      for (const itemId of group.items) {
        const item = SYNCABLE_ITEMS.find((i) => i.id === itemId)
        if (!item) {
          result.errors.push(`Unknown syncable item: ${itemId}`)
          continue
        }

        try {
          const canonicalPath = join(getGroupPath(group.id), item.relativePath)
          const instancePath = join(instanceDir, item.relativePath)

          // If canonical doesn't exist yet, try to seed from this instance
          if (!existsSync(canonicalPath)) {
            if (existsSync(instancePath)) {
              console.log(
                `[FileSync] Seeding canonical ${item.relativePath} from instance ${instanceId}`
              )
              copyItem(instancePath, canonicalPath, item.type)
              // Update meta
              const hash = computeHash(canonicalPath, item.type)
              const stat = statSync(canonicalPath)
              meta.files[item.relativePath] = {
                hash,
                mtime: stat.mtimeMs,
                size: item.type === 'directory' ? getDirectorySize(canonicalPath) : stat.size
              }
              saveSyncMeta(group.id, meta)
              result.skipped++
            } else {
              result.skipped++
            }
            continue
          }

          const canonicalHash = computeHash(canonicalPath, item.type)

          // If instance doesn't have the file yet → first sync, copy canonical to instance
          if (!existsSync(instancePath)) {
            console.log(
              `[FileSync] First sync: copying ${item.relativePath} to instance ${instanceId}`
            )
            copyItem(canonicalPath, instancePath, item.type)
            result.synced++
            continue
          }

          const instanceHash = computeHash(instancePath, item.type)

          if (canonicalHash !== instanceHash) {
            console.log(
              `[FileSync] Syncing ${item.relativePath} → instance ${instanceId} (hashes differ)`
            )
            backupInstanceFile(instanceDir, item.relativePath, item.type)
            copyItem(canonicalPath, instancePath, item.type)
            result.synced++
          } else {
            result.skipped++
          }
        } catch (err) {
          const msg = `Failed to sync ${item.relativePath} to instance ${instanceId}: ${err}`
          console.error(`[FileSync] ${msg}`)
          result.errors.push(msg)
        }
      }
    }
  } catch (err) {
    const msg = `Pre-launch sync failed for instance ${instanceId}: ${err}`
    console.error(`[FileSync] ${msg}`)
    result.errors.push(msg)
  }

  console.log(
    `[FileSync] Pre-launch sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} error(s)`
  )
  return result
}

// ---------------------------------------------------------------------------
// Post-Close Sync: instance → canonical
// ---------------------------------------------------------------------------

export function syncFromInstance(instanceId: string): SyncResult {
  const result: SyncResult = { synced: 0, skipped: 0, errors: [] }

  try {
    const config = getSyncConfig()
    const instanceDir = getInstancePath(instanceId)
    const groups = config.groups.filter((g) => g.instanceIds.includes(instanceId))

    if (groups.length === 0) {
      console.log(`[FileSync] No sync groups for instance ${instanceId}, skipping post-close sync`)
      return result
    }

    // Check if instance directory still exists (may have been deleted)
    if (!existsSync(instanceDir)) {
      console.warn(
        `[FileSync] Instance directory ${instanceDir} does not exist — removing from all groups`
      )
      for (const group of groups) {
        const idx = group.instanceIds.indexOf(instanceId)
        if (idx !== -1) {
          group.instanceIds.splice(idx, 1)
        }
      }
      saveSyncConfig(config)
      return result
    }

    console.log(
      `[FileSync] Post-close sync for instance ${instanceId} — ${groups.length} group(s)`
    )

    for (const group of groups) {
      const meta = loadSyncMeta(group.id)

      for (const itemId of group.items) {
        const item = SYNCABLE_ITEMS.find((i) => i.id === itemId)
        if (!item) {
          result.errors.push(`Unknown syncable item: ${itemId}`)
          continue
        }

        try {
          const canonicalPath = join(getGroupPath(group.id), item.relativePath)
          const instancePath = join(instanceDir, item.relativePath)

          // Instance doesn't have this file — nothing to sync back
          if (!existsSync(instancePath)) {
            result.skipped++
            continue
          }

          const instanceHash = computeHash(instancePath, item.type)
          const instanceStat = statSync(instancePath)
          const instanceMtime = instanceStat.mtimeMs

          // Canonical doesn't exist yet → seed from instance
          if (!existsSync(canonicalPath)) {
            console.log(
              `[FileSync] Seeding canonical ${item.relativePath} from instance ${instanceId}`
            )
            copyItem(instancePath, canonicalPath, item.type)
            meta.files[item.relativePath] = {
              hash: instanceHash,
              mtime: instanceMtime,
              size: item.type === 'directory' ? getDirectorySize(instancePath) : instanceStat.size
            }
            saveSyncMeta(group.id, meta)
            result.synced++
            continue
          }

          const canonicalHash = computeHash(canonicalPath, item.type)

          if (instanceHash === canonicalHash) {
            result.skipped++
            continue
          }

          // Instance differs from canonical — check if instance is newer
          const metaEntry = meta.files[item.relativePath]
          const canonicalMtime = metaEntry ? metaEntry.mtime : statSync(canonicalPath).mtimeMs

          if (instanceMtime >= canonicalMtime) {
            console.log(
              `[FileSync] Updating canonical ${item.relativePath} from instance ${instanceId} (instance is newer)`
            )
            copyItem(instancePath, canonicalPath, item.type)
            meta.files[item.relativePath] = {
              hash: instanceHash,
              mtime: instanceMtime,
              size: item.type === 'directory' ? getDirectorySize(instancePath) : instanceStat.size
            }
            saveSyncMeta(group.id, meta)
            result.synced++
          } else {
            console.log(
              `[FileSync] Skipping ${item.relativePath} — canonical is newer than instance`
            )
            result.skipped++
          }
        } catch (err) {
          const msg = `Failed to sync ${item.relativePath} from instance ${instanceId}: ${err}`
          console.error(`[FileSync] ${msg}`)
          result.errors.push(msg)
        }
      }
    }
  } catch (err) {
    const msg = `Post-close sync failed for instance ${instanceId}: ${err}`
    console.error(`[FileSync] ${msg}`)
    result.errors.push(msg)
  }

  console.log(
    `[FileSync] Post-close sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} error(s)`
  )
  return result
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function getInstanceSyncGroups(instanceId: string): SyncGroup[] {
  const config = getSyncConfig()
  return config.groups.filter((g) => g.instanceIds.includes(instanceId))
}

export function getSyncGroupStats(groupId: string): SyncGroupStats {
  const config = getSyncConfig()
  const group = config.groups.find((g) => g.id === groupId)

  if (!group) {
    return { files: 0, totalSize: 0, instances: 0 }
  }

  let fileCount = 0
  let totalSize = 0
  const groupDir = getGroupPath(groupId)

  for (const itemId of group.items) {
    const item = SYNCABLE_ITEMS.find((i) => i.id === itemId)
    if (!item) continue

    const canonicalPath = join(groupDir, item.relativePath)
    if (!existsSync(canonicalPath)) continue

    try {
      if (item.type === 'directory') {
        const files = getAllFiles(canonicalPath)
        fileCount += files.length
        totalSize += getDirectorySize(canonicalPath)
      } else {
        fileCount += 1
        totalSize += statSync(canonicalPath).size
      }
    } catch {
      // Skip inaccessible items
    }
  }

  return {
    files: fileCount,
    totalSize,
    instances: group.instanceIds.length
  }
}
