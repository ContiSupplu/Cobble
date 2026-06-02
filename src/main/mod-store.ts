import { app } from 'electron'
import { createHash } from 'crypto'
import {
  linkSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
  readdirSync
} from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface StoreEntry {
  hash: string           // SHA-256 hex
  fileName: string       // Original filename (e.g., 'sodium-0.5.8.jar')
  size: number           // File size in bytes
  slug?: string          // Modrinth slug if known
  refCount: number       // How many instances link to this
  storedAt: number       // Timestamp
}

interface StoreIndex {
  version: 1
  entries: Record<string, StoreEntry>  // keyed by hash
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

let storePath: string
let objectsPath: string
let indexPath: string

function getPaths() {
  if (!storePath) {
    storePath = join(app.getPath('userData'), 'mod-store')
    objectsPath = join(storePath, 'objects')
    indexPath = join(storePath, 'store-index.json')
  }
  return { storePath, objectsPath, indexPath }
}

// ---------------------------------------------------------------------------
// Index management (lazy, cached in memory)
// ---------------------------------------------------------------------------

let cachedIndex: StoreIndex | null = null

function ensureDirectories(): void {
  const { storePath, objectsPath } = getPaths()
  if (!existsSync(storePath)) {
    mkdirSync(storePath, { recursive: true })
    console.log('[ModStore] Created store directory:', storePath)
  }
  if (!existsSync(objectsPath)) {
    mkdirSync(objectsPath, { recursive: true })
    console.log('[ModStore] Created objects directory:', objectsPath)
  }
}

function loadIndex(): StoreIndex {
  if (cachedIndex) return cachedIndex

  const { indexPath } = getPaths()
  ensureDirectories()

  if (existsSync(indexPath)) {
    try {
      const raw = readFileSync(indexPath, 'utf-8')
      const parsed = JSON.parse(raw) as StoreIndex
      if (parsed.version === 1 && parsed.entries) {
        cachedIndex = parsed
        console.log('[ModStore] Loaded index with', Object.keys(parsed.entries).length, 'entries')
        return cachedIndex
      }
    } catch (err) {
      console.warn('[ModStore] Index corrupted, rebuilding from objects directory:', err)
    }
  }

  // Build fresh index (or rebuild from objects)
  cachedIndex = rebuildIndex()
  return cachedIndex
}

function saveIndex(): void {
  const { indexPath } = getPaths()
  ensureDirectories()

  if (!cachedIndex) return

  try {
    writeFileSync(indexPath, JSON.stringify(cachedIndex, null, 2), 'utf-8')
  } catch (err) {
    console.error('[ModStore] Failed to save index:', err)
  }
}

function rebuildIndex(): StoreIndex {
  const { objectsPath } = getPaths()
  const index: StoreIndex = { version: 1, entries: {} }

  console.log('[ModStore] Rebuilding index from objects directory...')

  if (!existsSync(objectsPath)) {
    saveIndexDirect(index)
    return index
  }

  const prefixDirs = readdirSync(objectsPath)
  for (const prefix of prefixDirs) {
    const prefixPath = join(objectsPath, prefix)
    try {
      const stat = statSync(prefixPath)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }

    const files = readdirSync(prefixPath)
    for (const file of files) {
      const filePath = join(prefixPath, file)
      try {
        const stat = statSync(filePath)
        if (!stat.isFile()) continue

        const hash = file // filename is the full hash
        index.entries[hash] = {
          hash,
          fileName: file,
          size: stat.size,
          refCount: Math.max(stat.nlink - 1, 0), // nlink includes the store copy
          storedAt: stat.birthtimeMs || stat.ctimeMs
        }
      } catch {
        continue
      }
    }
  }

  console.log('[ModStore] Rebuilt index with', Object.keys(index.entries).length, 'entries')
  saveIndexDirect(index)
  return index
}

function saveIndexDirect(index: StoreIndex): void {
  const { indexPath } = getPaths()
  ensureDirectories()
  try {
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  } catch (err) {
    console.error('[ModStore] Failed to save index:', err)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function objectDir(hash: string): string {
  const { objectsPath } = getPaths()
  return join(objectsPath, hash.slice(0, 2))
}

function objectPath(hash: string): string {
  return join(objectDir(hash), hash)
}

function ensureObjectDir(hash: string): void {
  const dir = objectDir(hash)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function hardLinkOrCopy(src: string, dest: string): void {
  try {
    // Remove destination if it already exists (stale file)
    if (existsSync(dest)) {
      unlinkSync(dest)
    }
    linkSync(src, dest)
  } catch (err: any) {
    // EXDEV = cross-device link, fall back to copy
    console.warn(
      `[ModStore] Hard link failed (${err.code || err.message}), falling back to copy: ${dest}`
    )
    try {
      copyFileSync(src, dest)
    } catch (copyErr) {
      console.error('[ModStore] Copy fallback also failed:', copyErr)
    }
  }
}

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------

export function computeBufferHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function computeFileHash(filePath: string): string {
  const data = readFileSync(filePath)
  return computeBufferHash(data)
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export function storeAndLink(
  buffer: Buffer,
  fileName: string,
  instanceModsDir: string,
  slug?: string
): { hash: string; alreadyExisted: boolean } {
  const hash = computeBufferHash(buffer)
  const index = loadIndex()
  let alreadyExisted = false

  if (index.entries[hash]) {
    // Object already in store — just bump refCount
    alreadyExisted = true
    index.entries[hash].refCount++
    console.log(`[ModStore] Object already exists: ${hash} (refCount → ${index.entries[hash].refCount})`)
  } else {
    // Write new object to store
    ensureObjectDir(hash)
    const objPath = objectPath(hash)
    try {
      writeFileSync(objPath, buffer)
      console.log(`[ModStore] Stored new object: ${hash} (${buffer.length} bytes)`)
    } catch (err) {
      console.error('[ModStore] Failed to write object file:', err)
      throw err
    }

    index.entries[hash] = {
      hash,
      fileName,
      size: buffer.length,
      slug,
      refCount: 1,
      storedAt: Date.now()
    }
  }

  // Ensure instance mods directory exists
  if (!existsSync(instanceModsDir)) {
    mkdirSync(instanceModsDir, { recursive: true })
  }

  // Create hard link (or copy) into instance mods folder
  const destPath = join(instanceModsDir, fileName)
  const srcPath = objectPath(hash)
  hardLinkOrCopy(srcPath, destPath)

  saveIndex()
  return { hash, alreadyExisted }
}

export function linkExisting(
  hash: string,
  fileName: string,
  instanceModsDir: string
): boolean {
  const index = loadIndex()
  const entry = index.entries[hash]

  if (!entry) {
    console.warn(`[ModStore] Hash not found in store: ${hash}`)
    return false
  }

  // Verify the object file actually exists
  const srcPath = objectPath(hash)
  if (!existsSync(srcPath)) {
    console.warn(`[ModStore] Object file missing for hash ${hash}, removing from index`)
    delete index.entries[hash]
    saveIndex()
    return false
  }

  // Ensure instance mods directory exists
  if (!existsSync(instanceModsDir)) {
    mkdirSync(instanceModsDir, { recursive: true })
  }

  const destPath = join(instanceModsDir, fileName)
  hardLinkOrCopy(srcPath, destPath)

  entry.refCount++
  console.log(`[ModStore] Linked existing object: ${hash} → ${destPath} (refCount → ${entry.refCount})`)
  saveIndex()
  return true
}

export function removeRef(hash: string): void {
  const index = loadIndex()
  const entry = index.entries[hash]

  if (!entry) {
    console.warn(`[ModStore] removeRef: hash not found: ${hash}`)
    return
  }

  entry.refCount--
  console.log(`[ModStore] Decremented refCount for ${hash} → ${entry.refCount}`)

  if (entry.refCount <= 0) {
    // Delete the object file
    const objPath = objectPath(hash)
    try {
      if (existsSync(objPath)) {
        unlinkSync(objPath)
        console.log(`[ModStore] Deleted object file: ${objPath}`)
      }
    } catch (err) {
      console.error(`[ModStore] Failed to delete object file ${objPath}:`, err)
    }

    // Remove from index
    delete index.entries[hash]
    console.log(`[ModStore] Removed entry from index: ${hash}`)
  }

  saveIndex()
}

export function removeInstanceRefs(instanceModsDir: string): void {
  if (!existsSync(instanceModsDir)) {
    console.warn(`[ModStore] Instance mods directory does not exist: ${instanceModsDir}`)
    return
  }

  const files = readdirSync(instanceModsDir)
  console.log(`[ModStore] Removing refs for ${files.length} files in: ${instanceModsDir}`)

  for (const file of files) {
    const filePath = join(instanceModsDir, file)
    try {
      const stat = statSync(filePath)
      if (!stat.isFile()) continue

      const hash = computeFileHash(filePath)
      removeRef(hash)
    } catch (err) {
      console.warn(`[ModStore] Failed to process file ${file} during removeInstanceRefs:`, err)
    }
  }
}

export function migrateExistingMods(
  instanceModsDir: string
): { migrated: number; savedBytes: number } {
  if (!existsSync(instanceModsDir)) {
    console.warn(`[ModStore] Instance mods directory does not exist: ${instanceModsDir}`)
    return { migrated: 0, savedBytes: 0 }
  }

  const files = readdirSync(instanceModsDir)
  let migrated = 0
  let savedBytes = 0

  console.log(`[ModStore] Migrating existing mods in: ${instanceModsDir}`)

  for (const file of files) {
    // Only process JAR files
    if (!file.toLowerCase().endsWith('.jar')) continue

    const filePath = join(instanceModsDir, file)
    try {
      const stat = statSync(filePath)
      if (!stat.isFile()) continue

      const buffer = readFileSync(filePath)
      const hash = computeBufferHash(buffer)
      const index = loadIndex()

      if (index.entries[hash]) {
        // Already in store — delete original, create hard link, bump refCount
        unlinkSync(filePath)
        hardLinkOrCopy(objectPath(hash), filePath)
        index.entries[hash].refCount++
        savedBytes += stat.size
        console.log(`[ModStore] Deduplicated: ${file} (saved ${stat.size} bytes)`)
      } else {
        // New to store — write object, replace original with hard link
        ensureObjectDir(hash)
        writeFileSync(objectPath(hash), buffer)
        unlinkSync(filePath)
        hardLinkOrCopy(objectPath(hash), filePath)

        index.entries[hash] = {
          hash,
          fileName: file,
          size: buffer.length,
          refCount: 1,
          storedAt: Date.now()
        }
        console.log(`[ModStore] Migrated to store: ${file} (${buffer.length} bytes)`)
      }

      migrated++
      saveIndex()
    } catch (err) {
      console.warn(`[ModStore] Failed to migrate ${file}:`, err)
    }
  }

  console.log(`[ModStore] Migration complete: ${migrated} mods migrated, ${savedBytes} bytes saved`)
  return { migrated, savedBytes }
}

export function getDiskSavings(): {
  totalStored: number
  totalLinked: number
  savedBytes: number
} {
  const index = loadIndex()
  const entries = Object.values(index.entries)

  let totalStored = 0
  let totalLinked = 0
  let totalStoredSize = 0
  let totalLinkedSize = 0

  for (const entry of entries) {
    totalStored++
    totalLinked += entry.refCount
    totalStoredSize += entry.size
    totalLinkedSize += entry.size * entry.refCount
  }

  // savedBytes = what all links would cost without dedup minus actual stored size
  const savedBytes = totalLinkedSize - totalStoredSize

  return { totalStored, totalLinked, savedBytes }
}

export function getStoreStats(): {
  totalMods: number
  totalSize: number
  totalRefs: number
} {
  const index = loadIndex()
  const entries = Object.values(index.entries)

  let totalSize = 0
  let totalRefs = 0

  for (const entry of entries) {
    totalSize += entry.size
    totalRefs += entry.refCount
  }

  return {
    totalMods: entries.length,
    totalSize,
    totalRefs
  }
}
