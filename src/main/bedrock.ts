import { app, shell } from 'electron'
import { exec } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, createReadStream } from 'fs'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ============================================================
// Bedrock Edition — Detection
// ============================================================

export async function detectBedrock(): Promise<{ installed: boolean; version: string | null }> {
  try {
    console.log('[Bedrock] Detecting Bedrock Edition installation...')
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-AppxPackage -Name 'Microsoft.MinecraftUWP' | Select-Object -Property Version | ConvertTo-Json"`
    )
    const trimmed = stdout.trim()
    if (!trimmed || trimmed === 'null' || trimmed === '') {
      console.log('[Bedrock] Bedrock Edition not found')
      return { installed: false, version: null }
    }
    const parsed = JSON.parse(trimmed)
    const version = parsed?.Version || null
    console.log('[Bedrock] Found Bedrock Edition version:', version)
    return { installed: !!version, version }
  } catch (err: any) {
    console.log('[Bedrock] Detection failed:', err.message)
    return { installed: false, version: null }
  }
}

// ============================================================
// Bedrock Edition — Launch
// ============================================================

export async function launchBedrock(serverUrl?: string, serverPort?: number): Promise<void> {
  try {
    if (serverUrl) {
      const port = serverPort || 19132
      const uri = `minecraft://connect?serverUrl=${serverUrl}&serverPort=${port}`
      console.log(`[Bedrock] Launching Bedrock and connecting to ${serverUrl}:${port}`)
      await shell.openExternal(uri)
    } else {
      console.log('[Bedrock] Launching Bedrock Edition...')
      await shell.openExternal('minecraft:')
    }
    console.log('[Bedrock] Launch command executed successfully')
  } catch (err: any) {
    console.log('[Bedrock] Launch failed:', err.message)
    throw err
  }
}

// ============================================================
// Bedrock Edition — Data Path
// ============================================================

export function getBedrockDataPath(): string | null {
  // Check GDK path first (newer Bedrock installations)
  const gdkPath = join(
    app.getPath('appData'),
    'Minecraft Bedrock',
    'users',
    'shared',
    'games',
    'com.mojang'
  )
  if (existsSync(gdkPath)) {
    console.log('[Bedrock] Found GDK data path:', gdkPath)
    return gdkPath
  }

  // Check UWP path (Microsoft Store / legacy)
  const localAppData = process.env.LOCALAPPDATA || ''
  if (localAppData) {
    const uwpPath = join(
      localAppData,
      'Packages',
      'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
      'LocalState',
      'games',
      'com.mojang'
    )
    if (existsSync(uwpPath)) {
      console.log('[Bedrock] Found UWP data path:', uwpPath)
      return uwpPath
    }
  }

  console.log('[Bedrock] No Bedrock data path found')
  return null
}

// ============================================================
// Bedrock Edition — Worlds
// ============================================================

interface BedrockWorld {
  id: string
  name: string
  icon: string | null
  lastPlayed: number
  sizeMB: number
}

function calculateDirSize(dirPath: string): number {
  let totalSize = 0
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          totalSize += calculateDirSize(fullPath)
        } else {
          totalSize += statSync(fullPath).size
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return totalSize
}

export async function getBedrockWorlds(): Promise<BedrockWorld[]> {
  try {
    const dataPath = getBedrockDataPath()
    if (!dataPath) {
      console.log('[Bedrock] Cannot list worlds: no data path found')
      return []
    }

    const worldsDir = join(dataPath, 'minecraftWorlds')
    if (!existsSync(worldsDir)) {
      console.log('[Bedrock] Worlds directory does not exist:', worldsDir)
      return []
    }

    const entries = readdirSync(worldsDir, { withFileTypes: true })
    const worlds: BedrockWorld[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const worldDir = join(worldsDir, entry.name)
      const levelnameFile = join(worldDir, 'levelname.txt')

      // Read world name from levelname.txt
      let name = entry.name
      try {
        if (existsSync(levelnameFile)) {
          name = readFileSync(levelnameFile, 'utf-8').trim() || entry.name
        }
      } catch {
        // Use folder name as fallback
      }

      // Check for world icon
      let icon: string | null = null
      const iconPath = join(worldDir, 'world_icon.jpeg')
      try {
        if (existsSync(iconPath)) {
          const iconData = readFileSync(iconPath)
          icon = `data:image/jpeg;base64,${iconData.toString('base64')}`
        }
      } catch {
        // No icon available
      }

      // Get last modified time
      let lastPlayed = 0
      try {
        const stats = statSync(worldDir)
        lastPlayed = stats.mtimeMs
      } catch {
        // Default to 0
      }

      // Calculate world size in MB
      const sizeBytes = calculateDirSize(worldDir)
      const sizeMB = Math.round((sizeBytes / (1024 * 1024)) * 100) / 100

      worlds.push({
        id: entry.name,
        name,
        icon,
        lastPlayed,
        sizeMB
      })
    }

    // Sort by last played (most recent first)
    worlds.sort((a, b) => b.lastPlayed - a.lastPlayed)

    console.log(`[Bedrock] Found ${worlds.length} worlds`)
    return worlds
  } catch (err: any) {
    console.log('[Bedrock] Failed to list worlds:', err.message)
    return []
  }
}

// ============================================================
// Bedrock Edition — Resource & Behavior Packs
// ============================================================

interface BedrockPack {
  id: string
  name: string
  description: string
  version: string
}

export async function getBedrockPacks(type: 'resource' | 'behavior'): Promise<BedrockPack[]> {
  try {
    const dataPath = getBedrockDataPath()
    if (!dataPath) {
      console.log('[Bedrock] Cannot list packs: no data path found')
      return []
    }

    const packsDir = join(dataPath, type === 'resource' ? 'resource_packs' : 'behavior_packs')
    if (!existsSync(packsDir)) {
      console.log(`[Bedrock] ${type} packs directory does not exist:`, packsDir)
      return []
    }

    const entries = readdirSync(packsDir, { withFileTypes: true })
    const packs: BedrockPack[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const manifestPath = join(packsDir, entry.name, 'manifest.json')
      if (!existsSync(manifestPath)) continue

      try {
        const manifestRaw = readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(manifestRaw)
        const header = manifest.header

        if (!header) continue

        packs.push({
          id: header.uuid || entry.name,
          name: header.name || entry.name,
          description: header.description || '',
          version: Array.isArray(header.version) ? header.version.join('.') : String(header.version || '0.0.0')
        })
      } catch {
        // Skip packs with invalid manifests
        console.log(`[Bedrock] Skipping pack with invalid manifest: ${entry.name}`)
      }
    }

    console.log(`[Bedrock] Found ${packs.length} ${type} packs`)
    return packs
  } catch (err: any) {
    console.log(`[Bedrock] Failed to list ${type} packs:`, err.message)
    return []
  }
}

// ============================================================
// Bedrock Edition — Addon Installation
// ============================================================

export async function installAddon(filePath: string): Promise<{ success: boolean; message: string; type: string }> {
  try {
    const ext = filePath.toLowerCase().split('.').pop() || ''
    const validExtensions = ['mcaddon', 'mcpack', 'mcworld']

    if (!validExtensions.includes(ext)) {
      console.log('[Bedrock] Invalid addon file type:', ext)
      return {
        success: false,
        message: `Invalid file type ".${ext}". Expected .mcaddon, .mcpack, or .mcworld`,
        type: ext
      }
    }

    if (!existsSync(filePath)) {
      console.log('[Bedrock] Addon file not found:', filePath)
      return {
        success: false,
        message: 'File not found: ' + filePath,
        type: ext
      }
    }

    // Use shell.openPath to let Minecraft handle the import natively
    // This triggers the game's built-in importer which handles all file types correctly
    console.log(`[Bedrock] Installing addon via shell: ${filePath} (type: .${ext})`)
    const errorMessage = await shell.openPath(filePath)

    if (errorMessage) {
      console.log('[Bedrock] shell.openPath returned error:', errorMessage)
      return {
        success: false,
        message: `Failed to open addon: ${errorMessage}`,
        type: ext
      }
    }

    console.log('[Bedrock] Addon opened successfully, Minecraft will handle import')
    return {
      success: true,
      message: `Successfully opened .${ext} file. Minecraft will import it automatically.`,
      type: ext
    }
  } catch (err: any) {
    console.log('[Bedrock] Addon installation failed:', err.message)
    return {
      success: false,
      message: err.message || 'Unknown error during addon installation',
      type: 'unknown'
    }
  }
}

// ============================================================
// Bedrock Edition — Open Folder
// ============================================================

export async function openBedrockFolder(type: 'worlds' | 'resource_packs' | 'behavior_packs' | 'root'): Promise<void> {
  const dataPath = getBedrockDataPath()
  if (!dataPath) {
    throw new Error('Bedrock data path not found. Is Minecraft Bedrock Edition installed?')
  }

  let targetPath: string
  switch (type) {
    case 'worlds':
      targetPath = join(dataPath, 'minecraftWorlds')
      break
    case 'resource_packs':
      targetPath = join(dataPath, 'resource_packs')
      break
    case 'behavior_packs':
      targetPath = join(dataPath, 'behavior_packs')
      break
    case 'root':
    default:
      targetPath = dataPath
      break
  }

  // Create the directory if it doesn't exist
  if (!existsSync(targetPath)) {
    console.log('[Bedrock] Creating directory:', targetPath)
    mkdirSync(targetPath, { recursive: true })
  }

  console.log('[Bedrock] Opening folder:', targetPath)
  await shell.openPath(targetPath)
}
