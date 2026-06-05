// ============================================================
// Loom Cards — Card Engine
// ============================================================
// Core card engine for generating, publishing, querying, updating,
// and deleting Loom Cards. A Loom Card is a shareable snapshot of
// a Minecraft instance (mods, shaders, resource packs, settings)
// that other players can clone into their own launcher.

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, parse as parsePath } from 'path'
import { db, storage } from './firebase-config'
import { getInstancePath } from './instances'
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp
} from 'firebase/firestore'
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'firebase/storage'

// ============================================================
// Types
// ============================================================

export interface ModEntry {
  id: string
  name: string
  description: string
  version: string
  icon_url?: string
  slug: string
  fileName: string
  projectId: string | null
  installedAt: number
  isDependency?: boolean
  isPerfMod?: boolean
  manuallyAdded?: boolean
}

export interface LoomCard {
  cardId: string
  createdAt: number
  updatedAt: number
  author: {
    username: string
    uuid: string
  }
  name: string
  description: string
  coverImageUrl: string | null
  tags: string[]
  edition: 'java' | 'bedrock'
  java: {
    version: string
    loader: string
    loaderVersion?: string
    mods: Array<{
      slug: string
      name: string
      version: string
      projectId: string | null
      source: 'modrinth' | 'curseforge' | 'local'
      category: 'performance' | 'content' | 'visual' | 'utility' | 'library' | 'other'
      required: boolean
    }>
    shaderPacks: Array<{ name: string; fileName: string }>
    resourcePacks: Array<{ name: string; fileName: string }>
    server?: { name: string; ip: string }
    memory?: number
  }
  sharing: {
    includeMods: boolean
    includeShaders: boolean
    includeResourcePacks: boolean
    includeServer: boolean
    includeVersion: boolean
  }
  stats: {
    opens: number
    clones: number
  }
}

export interface CardManifest {
  instanceId: string
  name: string
  version: string
  loader: string
  loaderVersion?: string
  memory?: number
  mods: Array<{
    slug: string
    name: string
    description?: string
    icon_url?: string
    version: string
    projectId: string | null
    source: 'modrinth' | 'curseforge' | 'local'
    category: 'performance' | 'content' | 'visual' | 'utility' | 'library' | 'other'
    required: boolean
  }>
  shaderPacks: Array<{ name: string; fileName: string }>
  resourcePacks: Array<{ name: string; fileName: string }>
}

export interface PublishOptions {
  author: { username: string; uuid: string }
  name: string
  description: string
  tags: string[]
  coverImage?: string   // Absolute file path to the cover image
  server?: { name: string; ip: string }
  sharing?: Partial<LoomCard['sharing']>
}

export interface PublishResult {
  cardId: string
  url: string
}

// ============================================================
// Firestore collection ref
// ============================================================

const CARDS_COLLECTION = 'cards'
const STORAGE_COVERS_PATH = 'card-covers'

// ============================================================
// Helpers
// ============================================================

function slugify(text: string): string {
  return text
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

function generateCardId(name: string): string {
  const slug = slugify(name) || 'card'
  return `${slug}-${randomChars(6)}`
}

/**
 * Determine the mod source based on available identifiers.
 * - If it has a projectId, assume Modrinth (the launcher's primary source)
 * - If manually added or no project ID, mark as local
 */
function inferModSource(mod: ModEntry): 'modrinth' | 'curseforge' | 'local' {
  if (mod.manuallyAdded) return 'local'
  if (mod.projectId) return 'modrinth'
  return 'local'
}

/**
 * Categorize a mod based on its flags.
 */
function categorizeMod(mod: ModEntry): 'performance' | 'content' | 'visual' | 'utility' | 'library' | 'other' {
  if (mod.isPerfMod) return 'performance'
  if (mod.isDependency) return 'library'
  return 'content'
}

/**
 * Scan a directory for files matching given extensions.
 * Returns an array of { name, fileName } objects.
 */
function scanPackDirectory(
  dirPath: string,
  extensions: string[]
): Array<{ name: string; fileName: string }> {
  if (!existsSync(dirPath)) return []

  try {
    const entries = readdirSync(dirPath)
    return entries
      .filter(fileName => {
        const ext = parsePath(fileName).ext.toLowerCase()
        return extensions.includes(ext)
      })
      .map(fileName => {
        // Use the filename without extension as the display name
        const parsed = parsePath(fileName)
        return {
          name: parsed.name,
          fileName
        }
      })
  } catch (err) {
    console.warn('[LoomCards] Failed to scan directory:', dirPath, err)
    return []
  }
}

// ============================================================
// Core API
// ============================================================

/**
 * Generate a card manifest from an instance.
 * Reads instance config, mods list, shader packs, and resource packs.
 */
export function generateCardManifest(instanceId: string): CardManifest {
  const instanceDir = getInstancePath(instanceId)

  // -- Read instance.json --
  const instanceJsonPath = join(instanceDir, 'instance.json')
  if (!existsSync(instanceJsonPath)) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  const instanceConfig = JSON.parse(readFileSync(instanceJsonPath, 'utf-8'))

  // -- Read mods.json --
  let mods: ModEntry[] = []
  const modsJsonPath = join(instanceDir, 'mods.json')
  if (existsSync(modsJsonPath)) {
    try {
      mods = JSON.parse(readFileSync(modsJsonPath, 'utf-8'))
    } catch (err) {
      console.warn('[LoomCards] Failed to parse mods.json:', err)
    }
  }

  // -- Scan shader packs --
  const shaderPacks = scanPackDirectory(
    join(instanceDir, 'shaderpacks'),
    ['.zip', '.txt']  // .txt for optifine shader config
  ).filter(sp => sp.fileName.endsWith('.zip')) // Only include actual shader zip files

  // -- Scan resource packs --
  const resourcePacks = scanPackDirectory(
    join(instanceDir, 'resourcepacks'),
    ['.zip']
  )

  // -- Build mod entries --
  const cardMods = mods.map(mod => ({
    slug: mod.slug,
    name: mod.name,
    description: mod.description || '',
    icon_url: mod.icon_url || '',
    version: mod.version,
    projectId: mod.projectId,
    source: inferModSource(mod),
    category: categorizeMod(mod),
    required: !mod.isDependency  // Dependencies are not "required" by the user — they're auto-resolved
  }))

  return {
    instanceId,
    name: instanceConfig.name,
    version: instanceConfig.version,
    loader: instanceConfig.loader,
    loaderVersion: instanceConfig.loaderVersion,
    memory: instanceConfig.memoryMax,
    mods: cardMods,
    shaderPacks,
    resourcePacks
  }
}

/**
 * Publish a Loom Card to Firebase.
 * Uploads cover image to Storage, saves card document to Firestore.
 */
export async function publishCard(
  manifest: CardManifest,
  options: PublishOptions
): Promise<PublishResult> {
  const cardId = generateCardId(options.name)
  const now = Date.now()

  // -- Upload cover image if provided --
  let coverImageUrl: string | null = null
  if (options.coverImage && existsSync(options.coverImage)) {
    try {
      const imageBuffer = readFileSync(options.coverImage)
      const ext = parsePath(options.coverImage).ext.toLowerCase() || '.png'
      const storagePath = `${STORAGE_COVERS_PATH}/${cardId}${ext}`
      const storageRef = ref(storage, storagePath)

      // Determine content type
      const contentTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif'
      }
      const contentType = contentTypes[ext] || 'image/png'

      await uploadBytes(storageRef, imageBuffer, { contentType })
      coverImageUrl = await getDownloadURL(storageRef)
      console.log('[LoomCards] Cover image uploaded:', storagePath)
    } catch (err) {
      console.error('[LoomCards] Failed to upload cover image:', err)
      // Continue without cover image — not a fatal error
    }
  }

  // -- Build sharing defaults --
  const sharing: LoomCard['sharing'] = {
    includeMods: true,
    includeShaders: true,
    includeResourcePacks: true,
    includeServer: false,
    includeVersion: true,
    ...options.sharing
  }

  // -- Build the card document --
  const card: LoomCard = {
    cardId,
    createdAt: now,
    updatedAt: now,
    author: options.author,
    name: options.name,
    description: options.description,
    coverImageUrl,
    tags: options.tags,
    edition: 'java',
    java: {
      version: manifest.version,
      loader: manifest.loader,
      loaderVersion: manifest.loaderVersion,
      mods: sharing.includeMods ? manifest.mods : [],
      shaderPacks: sharing.includeShaders ? manifest.shaderPacks : [],
      resourcePacks: sharing.includeResourcePacks ? manifest.resourcePacks : [],
      server: sharing.includeServer ? options.server : undefined,
      memory: manifest.memory
    },
    sharing,
    stats: {
      opens: 0,
      clones: 0
    }
  }

  // -- Strip undefined values (Firestore rejects them) --
  const stripUndefined = (obj: any): any => {
    if (Array.isArray(obj)) return obj.map(stripUndefined)
    if (obj && typeof obj === 'object') {
      const clean: any = {}
      for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) clean[k] = stripUndefined(v)
      }
      return clean
    }
    return obj
  }

  // -- Save to Firestore --
  const docRef = doc(collection(db, CARDS_COLLECTION), cardId)
  await setDoc(docRef, stripUndefined(card))
  console.log('[LoomCards] Card published:', cardId)

  return {
    cardId,
    url: `https://loommc.com/card/${cardId}`
  }
}

/**
 * Get all cards published by a specific user.
 */
export async function getMyCards(uuid: string): Promise<LoomCard[]> {
  const cardsRef = collection(db, CARDS_COLLECTION)
  const q = query(
    cardsRef,
    where('author.uuid', '==', uuid),
    orderBy('createdAt', 'desc')
  )

  const snapshot = await getDocs(q)
  const cards: LoomCard[] = []

  snapshot.forEach(docSnap => {
    if (docSnap.exists()) {
      cards.push(docSnap.data() as LoomCard)
    }
  })

  return cards
}

/**
 * Get a single card by ID.
 */
export async function getCard(cardId: string): Promise<LoomCard | null> {
  const docRef = doc(db, CARDS_COLLECTION, cardId)
  const docSnap = await getDoc(docRef)

  if (!docSnap.exists()) return null
  return docSnap.data() as LoomCard
}

/**
 * Delete a card and its associated cover image from Firebase.
 */
export async function deleteCard(cardId: string): Promise<boolean> {
  try {
    // -- Fetch the card first to find the cover image --
    const card = await getCard(cardId)

    if (!card) {
      console.warn('[LoomCards] Card not found for deletion:', cardId)
      return false
    }

    // -- Delete cover image from Storage if it exists --
    if (card.coverImageUrl) {
      try {
        // Try common image extensions
        const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
        for (const ext of extensions) {
          const storagePath = `${STORAGE_COVERS_PATH}/${cardId}${ext}`
          const storageRef = ref(storage, storagePath)
          try {
            await deleteObject(storageRef)
            console.log('[LoomCards] Cover image deleted:', storagePath)
            break
          } catch {
            // Try next extension
          }
        }
      } catch (err) {
        console.warn('[LoomCards] Failed to delete cover image (non-fatal):', err)
      }
    }

    // -- Delete the Firestore document --
    const docRef = doc(db, CARDS_COLLECTION, cardId)
    await deleteDoc(docRef)
    console.log('[LoomCards] Card deleted:', cardId)

    return true
  } catch (err) {
    console.error('[LoomCards] Failed to delete card:', err)
    return false
  }
}

/**
 * Update a card document in Firestore with a partial patch.
 * Automatically sets updatedAt to the current timestamp.
 */
export async function updateCard(
  cardId: string,
  patch: Partial<Omit<LoomCard, 'cardId' | 'createdAt'>>
): Promise<boolean> {
  try {
    const docRef = doc(db, CARDS_COLLECTION, cardId)
    const docSnap = await getDoc(docRef)

    if (!docSnap.exists()) {
      console.warn('[LoomCards] Card not found for update:', cardId)
      return false
    }

    // -- Handle cover image update --
    let coverImageUrl = patch.coverImageUrl
    if (patch.coverImageUrl && existsSync(patch.coverImageUrl)) {
      // The patch contains a local file path — upload it
      try {
        const imageBuffer = readFileSync(patch.coverImageUrl)
        const ext = parsePath(patch.coverImageUrl).ext.toLowerCase() || '.png'
        const storagePath = `${STORAGE_COVERS_PATH}/${cardId}${ext}`
        const storageRef = ref(storage, storagePath)

        const contentTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif'
        }
        const contentType = contentTypes[ext] || 'image/png'

        await uploadBytes(storageRef, imageBuffer, { contentType })
        coverImageUrl = await getDownloadURL(storageRef)
      } catch (err) {
        console.error('[LoomCards] Failed to upload updated cover image:', err)
        // Don't update coverImageUrl if upload failed
        delete patch.coverImageUrl
      }
    }

    await updateDoc(docRef, {
      ...patch,
      ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
      updatedAt: Date.now()
    })

    console.log('[LoomCards] Card updated:', cardId)
    return true
  } catch (err) {
    console.error('[LoomCards] Failed to update card:', err)
    return false
  }
}
