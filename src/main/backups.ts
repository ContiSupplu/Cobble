import { app } from 'electron'
import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync
} from 'fs'
import * as AdmZip from 'adm-zip'

// ============================================================
// Types
// ============================================================

export interface BackupInfo {
  id: string           // Timestamp-based ID like '2026-05-30_17-24-30'
  instanceId: string
  createdAt: number    // Unix timestamp
  sizeBytes: number    // Total size of the backup zip
  worldCount: number   // Number of worlds in the backup
  worlds: string[]     // World folder names
}

// ============================================================
// Paths
// ============================================================

const INSTANCES_DIR = join(app.getPath('userData'), 'instances')
const BACKUPS_DIR = join(app.getPath('userData'), 'backups')

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function getBackupDir(instanceId: string): string {
  return join(BACKUPS_DIR, instanceId)
}

function getSavesDir(instanceId: string): string {
  return join(INSTANCES_DIR, instanceId, 'saves')
}

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a timestamp-based backup ID: '2026-05-30_17-24-30'
 */
function generateBackupId(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return [
    now.getFullYear(),
    '-', pad(now.getMonth() + 1),
    '-', pad(now.getDate()),
    '_', pad(now.getHours()),
    '-', pad(now.getMinutes()),
    '-', pad(now.getSeconds())
  ].join('')
}

/**
 * List world folder names inside the saves/ directory.
 * A "world" is any subdirectory that contains a level.dat file.
 */
function getWorldFolders(savesDir: string): string[] {
  if (!existsSync(savesDir)) return []

  return readdirSync(savesDir, { withFileTypes: true })
    .filter(entry => {
      if (!entry.isDirectory()) return false
      // Valid Minecraft world must have a level.dat
      return existsSync(join(savesDir, entry.name, 'level.dat'))
    })
    .map(entry => entry.name)
}

/**
 * Recursively calculate directory size in bytes.
 */
function getDirSize(dir: string): number {
  let total = 0
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        total += getDirSize(fullPath)
      } else {
        try {
          total += statSync(fullPath).size
        } catch { /* skip inaccessible files */ }
      }
    }
  } catch { /* skip inaccessible dirs */ }
  return total
}

/**
 * Read a backup metadata JSON file, returning null if invalid.
 */
function readBackupMeta(metaPath: string): BackupInfo | null {
  try {
    if (existsSync(metaPath)) {
      return JSON.parse(readFileSync(metaPath, 'utf-8'))
    }
  } catch {
    // Corrupted metadata, skip
  }
  return null
}

// ============================================================
// Public API
// ============================================================

/**
 * Create a backup of all worlds in an instance's saves/ folder.
 * Zips the entire saves/ directory and writes metadata alongside.
 */
export async function createBackup(instanceId: string): Promise<BackupInfo> {
  const savesDir = getSavesDir(instanceId)
  const worlds = getWorldFolders(savesDir)

  if (worlds.length === 0) {
    throw new Error(`No worlds found in saves/ for instance "${instanceId}"`)
  }

  const backupDir = getBackupDir(instanceId)
  ensureDir(backupDir)

  const backupId = generateBackupId()
  const zipPath = join(backupDir, `backup_${backupId}.zip`)
  const metaPath = join(backupDir, `backup_${backupId}.json`)

  // Create zip of the entire saves/ directory
  console.log(`[Backups] Creating backup ${backupId} for instance ${instanceId} (${worlds.length} worlds)`)
  const zip = new AdmZip()
  zip.addLocalFolder(savesDir, 'saves')
  zip.writeZip(zipPath)

  // Get the size of the written zip
  const sizeBytes = statSync(zipPath).size

  const info: BackupInfo = {
    id: backupId,
    instanceId,
    createdAt: Date.now(),
    sizeBytes,
    worldCount: worlds.length,
    worlds
  }

  // Write metadata alongside the zip
  writeFileSync(metaPath, JSON.stringify(info, null, 2), 'utf-8')
  console.log(`[Backups] Backup complete: ${zipPath} (${(sizeBytes / 1048576).toFixed(1)} MB)`)

  return info
}

/**
 * List all backups for an instance, sorted newest first.
 */
export function listBackups(instanceId: string): BackupInfo[] {
  const backupDir = getBackupDir(instanceId)
  if (!existsSync(backupDir)) return []

  const entries = readdirSync(backupDir).filter(f => f.endsWith('.json'))
  const backups: BackupInfo[] = []

  for (const file of entries) {
    const meta = readBackupMeta(join(backupDir, file))
    if (meta) {
      // Verify the corresponding zip still exists
      const zipPath = join(backupDir, `backup_${meta.id}.zip`)
      if (existsSync(zipPath)) {
        backups.push(meta)
      }
    }
  }

  // Sort newest first
  backups.sort((a, b) => b.createdAt - a.createdAt)
  return backups
}

/**
 * Restore a specific backup by extracting its zip into the instance's saves/ folder.
 * Overwrites existing world folders that match names in the backup.
 */
export async function restoreBackup(instanceId: string, backupId: string): Promise<void> {
  const backupDir = getBackupDir(instanceId)
  const zipPath = join(backupDir, `backup_${backupId}.zip`)
  const metaPath = join(backupDir, `backup_${backupId}.json`)

  if (!existsSync(zipPath)) {
    throw new Error(`Backup zip not found: ${backupId}`)
  }

  const meta = readBackupMeta(metaPath)
  const savesDir = getSavesDir(instanceId)
  ensureDir(savesDir)

  console.log(`[Backups] Restoring backup ${backupId} for instance ${instanceId}`)

  const zip = new AdmZip(zipPath)
  const zipEntries = zip.getEntries()

  // Figure out which world folders are in this backup
  const worldsInBackup = new Set<string>()
  for (const entry of zipEntries) {
    // Entries are like 'saves/WorldName/...'
    const parts = entry.entryName.split('/')
    if (parts[0] === 'saves' && parts.length >= 2 && parts[1]) {
      worldsInBackup.add(parts[1])
    }
  }

  // Remove existing world folders that will be overwritten
  for (const worldName of Array.from(worldsInBackup)) {
    const worldDir = join(savesDir, worldName)
    if (existsSync(worldDir)) {
      console.log(`[Backups] Removing existing world "${worldName}" before restore`)
      rmSync(worldDir, { recursive: true, force: true })
    }
  }

  // Extract — the zip contains 'saves/...' so extract to the instance dir
  const instanceDir = join(INSTANCES_DIR, instanceId)
  zip.extractAllTo(instanceDir, true)

  const worldNames = Array.from(worldsInBackup)
  console.log(`[Backups] Restored ${worldNames.length} worlds: ${worldNames.join(', ')}`)
  if (meta) {
    console.log(`[Backups] Backup was from: ${new Date(meta.createdAt).toLocaleString()}`)
  }
}

/**
 * Delete a specific backup (removes both zip and metadata json).
 */
export function deleteBackup(instanceId: string, backupId: string): void {
  const backupDir = getBackupDir(instanceId)
  const zipPath = join(backupDir, `backup_${backupId}.zip`)
  const metaPath = join(backupDir, `backup_${backupId}.json`)

  if (existsSync(zipPath)) {
    rmSync(zipPath)
    console.log(`[Backups] Deleted zip: ${zipPath}`)
  }
  if (existsSync(metaPath)) {
    rmSync(metaPath)
    console.log(`[Backups] Deleted metadata: ${metaPath}`)
  }
}

/**
 * Auto-backup before launch. Skips silently if no worlds exist.
 * Enforces retention by deleting oldest backups beyond maxBackups.
 */
export async function autoBackup(instanceId: string, maxBackups: number = 5): Promise<BackupInfo | null> {
  const savesDir = getSavesDir(instanceId)
  const worlds = getWorldFolders(savesDir)

  // No worlds to back up — skip silently
  if (worlds.length === 0) {
    console.log(`[Backups] Auto-backup skipped for ${instanceId}: no worlds found`)
    return null
  }

  // Create the backup
  const backup = await createBackup(instanceId)
  console.log(`[Backups] Auto-backup created: ${backup.id}`)

  // Enforce retention — delete oldest backups beyond the limit
  const allBackups = listBackups(instanceId) // already sorted newest first
  if (allBackups.length > maxBackups) {
    const toDelete = allBackups.slice(maxBackups)
    for (const old of toDelete) {
      console.log(`[Backups] Retention: deleting old backup ${old.id} (${new Date(old.createdAt).toLocaleString()})`)
      deleteBackup(instanceId, old.id)
    }
    console.log(`[Backups] Retention: kept ${maxBackups}, deleted ${toDelete.length} old backups`)
  }

  return backup
}
