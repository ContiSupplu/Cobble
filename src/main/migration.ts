/**
 * Launcher Migration for Loom Launcher
 *
 * Features:
 * - Detect installed Minecraft launchers
 * - List importable data (worlds, mods, resource packs, settings)
 * - Import data from detected launchers into Loom instances
 *
 * Supported launchers:
 * - Official Minecraft Launcher (%APPDATA%/.minecraft)
 * - Prism Launcher (%APPDATA%/PrismLauncher/instances)
 * - MultiMC (common install locations)
 * - CurseForge (%USERPROFILE%/curseforge/minecraft/Instances)
 * - ATLauncher (%APPDATA%/ATLauncher/instances)
 */
import { app } from 'electron'
import { join, basename } from 'path'
import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  cpSync,
  statSync,
} from 'fs'
import { createInstance, getInstancePath, scaffoldInstanceDirs } from './instances'

// ============================================================
// Types
// ============================================================

export type LauncherType =
  | 'official'
  | 'prism'
  | 'multimc'
  | 'curseforge'
  | 'atlauncher'

export interface DetectedLauncher {
  name: string
  path: string
  type: LauncherType
  instanceCount: number
}

export interface ImportableInstance {
  name: string
  path: string
  version: string
  loader: string
  loaderVersion?: string
  hasWorlds: boolean
  hasMods: boolean
  hasResourcePacks: boolean
  hasShaderPacks: boolean
  hasSettings: boolean
  worldCount: number
  modCount: number
  resourcePackCount: number
}

export interface ImportableData {
  launcherName: string
  launcherType: LauncherType
  instances: ImportableInstance[]
}

export interface ImportOptions {
  worlds: boolean
  mods: boolean
  resourcePacks: boolean
  settings: boolean
  shaderPacks?: boolean
  specificInstances?: string[]  // Instance names/paths to import (all if empty)
}

export interface ImportResult {
  success: boolean
  importedInstances: string[]
  errors: string[]
  totalFiles: number
}

// ============================================================
// Helpers
// ============================================================

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function countItemsInDir(dir: string, extension?: string): number {
  try {
    if (!existsSync(dir)) return 0
    const items = readdirSync(dir)
    if (extension) {
      return items.filter((f) => f.toLowerCase().endsWith(extension)).length
    }
    return items.length
  } catch {
    return 0
  }
}

function countDirsInDir(dir: string): number {
  try {
    if (!existsSync(dir)) return 0
    return readdirSync(dir, { withFileTypes: true }).filter((d) =>
      d.isDirectory()
    ).length
  } catch {
    return 0
  }
}

function safeReadJson(filePath: string): any | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Safely copy a directory, logging errors but not throwing
 */
function safeCopyDir(src: string, dest: string): number {
  let fileCount = 0
  try {
    if (!existsSync(src)) return 0
    ensureDir(dest)
    cpSync(src, dest, { recursive: true })
    // Count files copied
    fileCount = countFilesRecursive(dest)
  } catch (err) {
    console.error(`[Migration] Failed to copy ${src} -> ${dest}:`, err)
  }
  return fileCount
}

function countFilesRecursive(dir: string): number {
  let count = 0
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) count++
      else if (entry.isDirectory()) {
        count += countFilesRecursive(join(dir, entry.name))
      }
    }
  } catch { /* ignore */ }
  return count
}

// ============================================================
// Launcher Paths
// ============================================================

function getAppData(): string {
  return process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
}

function getUserProfile(): string {
  return process.env.USERPROFILE || ''
}

function getLocalAppData(): string {
  return (
    process.env.LOCALAPPDATA ||
    join(process.env.USERPROFILE || '', 'AppData', 'Local')
  )
}

/**
 * Get candidate paths for each launcher type
 */
function getLauncherPaths(): Array<{
  name: string
  type: LauncherType
  paths: string[]
}> {
  const appData = getAppData()
  const userProfile = getUserProfile()
  const localAppData = getLocalAppData()

  return [
    {
      name: 'Official Minecraft',
      type: 'official' as LauncherType,
      paths: [join(appData, '.minecraft')],
    },
    {
      name: 'Prism Launcher',
      type: 'prism' as LauncherType,
      paths: [
        join(appData, 'PrismLauncher', 'instances'),
        join(localAppData, 'PrismLauncher', 'instances'),
      ],
    },
    {
      name: 'MultiMC',
      type: 'multimc' as LauncherType,
      paths: [
        join(appData, 'MultiMC', 'instances'),
        join(localAppData, 'MultiMC', 'instances'),
        // Common install directories
        'C:\\MultiMC\\instances',
        join(userProfile, 'MultiMC', 'instances'),
        join(userProfile, 'Desktop', 'MultiMC', 'instances'),
        join(userProfile, 'Downloads', 'MultiMC', 'instances'),
        'D:\\MultiMC\\instances',
      ],
    },
    {
      name: 'CurseForge',
      type: 'curseforge' as LauncherType,
      paths: [
        join(userProfile, 'curseforge', 'minecraft', 'Instances'),
      ],
    },
    {
      name: 'ATLauncher',
      type: 'atlauncher' as LauncherType,
      paths: [
        join(appData, 'ATLauncher', 'instances'),
        join(appData, '.atlauncher', 'instances'),
      ],
    },
  ]
}

// ============================================================
// Detection
// ============================================================

/**
 * Detect installed launchers on the system.
 * Returns an array of detected launchers with instance counts.
 */
export function detectLaunchers(): DetectedLauncher[] {
  console.log('[Migration] Scanning for installed launchers...')
  const detected: DetectedLauncher[] = []
  const launcherDefs = getLauncherPaths()

  for (const launcher of launcherDefs) {
    for (const candidatePath of launcher.paths) {
      try {
        if (!existsSync(candidatePath)) continue

        let instanceCount = 0

        if (launcher.type === 'official') {
          // Official launcher doesn't have "instances", count profiles
          const versionsDir = join(candidatePath, 'versions')
          instanceCount = existsSync(versionsDir) ? 1 : 0
        } else {
          // Count instance directories
          instanceCount = countDirsInDir(candidatePath)
        }

        if (instanceCount >= 0) {
          detected.push({
            name: launcher.name,
            path: candidatePath,
            type: launcher.type,
            instanceCount: Math.max(instanceCount, 1),
          })
          console.log(
            `[Migration] Found ${launcher.name} at ${candidatePath} (${instanceCount} instances)`
          )
          break // Found this launcher, don't check other paths
        }
      } catch (err) {
        // Path doesn't exist or can't be read — skip
      }
    }
  }

  console.log(`[Migration] Detected ${detected.length} launcher(s)`)
  return detected
}

// ============================================================
// Importable Data Inspection
// ============================================================

/**
 * Get importable data (instances, worlds, mods, etc.) from a launcher path.
 */
export function getImportableData(
  launcherPath: string,
  launcherType?: LauncherType
): ImportableData {
  // Infer launcher type from path if not provided
  const type = launcherType || inferLauncherType(launcherPath)
  const launcherName = getLauncherDisplayName(type)

  console.log(`[Migration] Scanning ${launcherName} at ${launcherPath}...`)

  let instances: ImportableInstance[] = []

  switch (type) {
    case 'official':
      instances = scanOfficialLauncher(launcherPath)
      break
    case 'prism':
    case 'multimc':
      instances = scanPrismMultiMC(launcherPath)
      break
    case 'curseforge':
      instances = scanCurseForge(launcherPath)
      break
    case 'atlauncher':
      instances = scanATLauncher(launcherPath)
      break
    default:
      console.warn(`[Migration] Unknown launcher type: ${type}`)
  }

  console.log(`[Migration] Found ${instances.length} importable instance(s)`)
  return { launcherName, launcherType: type, instances }
}

function inferLauncherType(path: string): LauncherType {
  const lower = path.toLowerCase()
  if (lower.includes('.minecraft')) return 'official'
  if (lower.includes('prismlauncher')) return 'prism'
  if (lower.includes('multimc')) return 'multimc'
  if (lower.includes('curseforge')) return 'curseforge'
  if (lower.includes('atlauncher')) return 'atlauncher'
  return 'official'
}

function getLauncherDisplayName(type: LauncherType): string {
  switch (type) {
    case 'official': return 'Official Minecraft'
    case 'prism': return 'Prism Launcher'
    case 'multimc': return 'MultiMC'
    case 'curseforge': return 'CurseForge'
    case 'atlauncher': return 'ATLauncher'
  }
}

// ============================================================
// Launcher-Specific Scanners
// ============================================================

function scanOfficialLauncher(mcDir: string): ImportableInstance[] {
  // Official launcher has a single ".minecraft" directory
  const savesDir = join(mcDir, 'saves')
  const modsDir = join(mcDir, 'mods')
  const rpDir = join(mcDir, 'resourcepacks')
  const spDir = join(mcDir, 'shaderpacks')
  const optionsFile = join(mcDir, 'options.txt')

  // Try to detect version from launcher_profiles.json
  let version = 'Unknown'
  const profilesFile = join(mcDir, 'launcher_profiles.json')
  const profiles = safeReadJson(profilesFile)
  if (profiles?.profiles) {
    const profileValues = Object.values(profiles.profiles) as any[]
    if (profileValues.length > 0) {
      version = profileValues[0]?.lastVersionId || 'Unknown'
    }
  }

  return [
    {
      name: 'Default Profile',
      path: mcDir,
      version,
      loader: 'vanilla',
      hasWorlds: existsSync(savesDir) && countDirsInDir(savesDir) > 0,
      hasMods: existsSync(modsDir) && countItemsInDir(modsDir, '.jar') > 0,
      hasResourcePacks: existsSync(rpDir) && countItemsInDir(rpDir) > 0,
      hasShaderPacks: existsSync(spDir) && countItemsInDir(spDir) > 0,
      hasSettings: existsSync(optionsFile),
      worldCount: countDirsInDir(savesDir),
      modCount: countItemsInDir(modsDir, '.jar'),
      resourcePackCount: countItemsInDir(rpDir),
    },
  ]
}

function scanPrismMultiMC(instancesDir: string): ImportableInstance[] {
  const instances: ImportableInstance[] = []

  try {
    const dirs = readdirSync(instancesDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory() || dir.name.startsWith('.')) continue

      const instDir = join(instancesDir, dir.name)
      const mcDir = join(instDir, '.minecraft')
      const actualMcDir = existsSync(mcDir) ? mcDir : instDir

      // Read instance.cfg or mmc-pack.json for metadata
      let name = dir.name
      let version = 'Unknown'
      let loader = 'vanilla'
      let loaderVersion: string | undefined

      // Parse instance.cfg
      const cfgPath = join(instDir, 'instance.cfg')
      if (existsSync(cfgPath)) {
        try {
          const cfg = readFileSync(cfgPath, 'utf-8')
          const nameMatch = cfg.match(/^name=(.+)$/m)
          if (nameMatch) name = nameMatch[1].trim()
        } catch { /* ignore */ }
      }

      // Parse mmc-pack.json for version/loader info
      const mmcPack = safeReadJson(join(instDir, 'mmc-pack.json'))
      if (mmcPack?.components) {
        for (const comp of mmcPack.components) {
          if (comp.uid === 'net.minecraft') {
            version = comp.version || version
          }
          if (comp.uid === 'net.fabricmc.fabric-loader') {
            loader = 'fabric'
            loaderVersion = comp.version
          }
          if (comp.uid === 'org.quiltmc.quilt-loader') {
            loader = 'quilt'
            loaderVersion = comp.version
          }
          if (comp.uid === 'net.minecraftforge') {
            loader = 'forge'
            loaderVersion = comp.version
          }
          if (comp.uid === 'net.neoforged') {
            loader = 'neoforge'
            loaderVersion = comp.version
          }
        }
      }

      const savesDir = join(actualMcDir, 'saves')
      const modsDir = join(actualMcDir, 'mods')
      const rpDir = join(actualMcDir, 'resourcepacks')
      const spDir = join(actualMcDir, 'shaderpacks')
      const optionsFile = join(actualMcDir, 'options.txt')

      instances.push({
        name,
        path: instDir,
        version,
        loader,
        loaderVersion,
        hasWorlds: existsSync(savesDir) && countDirsInDir(savesDir) > 0,
        hasMods: existsSync(modsDir) && countItemsInDir(modsDir, '.jar') > 0,
        hasResourcePacks: existsSync(rpDir) && countItemsInDir(rpDir) > 0,
        hasShaderPacks: existsSync(spDir) && countItemsInDir(spDir) > 0,
        hasSettings: existsSync(optionsFile),
        worldCount: countDirsInDir(savesDir),
        modCount: countItemsInDir(modsDir, '.jar'),
        resourcePackCount: countItemsInDir(rpDir),
      })
    }
  } catch (err) {
    console.error('[Migration] Error scanning Prism/MultiMC:', err)
  }

  return instances
}

function scanCurseForge(instancesDir: string): ImportableInstance[] {
  const instances: ImportableInstance[] = []

  try {
    const dirs = readdirSync(instancesDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory() || dir.name.startsWith('.')) continue

      const instDir = join(instancesDir, dir.name)

      let name = dir.name
      let version = 'Unknown'
      let loader = 'vanilla'
      let loaderVersion: string | undefined

      // CurseForge uses minecraftinstance.json
      const cfMeta = safeReadJson(join(instDir, 'minecraftinstance.json'))
      if (cfMeta) {
        name = cfMeta.name || name
        version = cfMeta.gameVersion || cfMeta.baseModLoader?.minecraftVersion || version
        if (cfMeta.baseModLoader) {
          const modLoaderName = (cfMeta.baseModLoader.name || '').toLowerCase()
          if (modLoaderName.includes('forge')) {
            loader = 'forge'
            loaderVersion = cfMeta.baseModLoader.forgeVersion || cfMeta.baseModLoader.name
          } else if (modLoaderName.includes('fabric')) {
            loader = 'fabric'
            loaderVersion = cfMeta.baseModLoader.name
          } else if (modLoaderName.includes('neoforge')) {
            loader = 'neoforge'
            loaderVersion = cfMeta.baseModLoader.name
          }
        }
      }

      const savesDir = join(instDir, 'saves')
      const modsDir = join(instDir, 'mods')
      const rpDir = join(instDir, 'resourcepacks')
      const spDir = join(instDir, 'shaderpacks')
      const optionsFile = join(instDir, 'options.txt')

      instances.push({
        name,
        path: instDir,
        version,
        loader,
        loaderVersion,
        hasWorlds: existsSync(savesDir) && countDirsInDir(savesDir) > 0,
        hasMods: existsSync(modsDir) && countItemsInDir(modsDir, '.jar') > 0,
        hasResourcePacks: existsSync(rpDir) && countItemsInDir(rpDir) > 0,
        hasShaderPacks: existsSync(spDir) && countItemsInDir(spDir) > 0,
        hasSettings: existsSync(optionsFile),
        worldCount: countDirsInDir(savesDir),
        modCount: countItemsInDir(modsDir, '.jar'),
        resourcePackCount: countItemsInDir(rpDir),
      })
    }
  } catch (err) {
    console.error('[Migration] Error scanning CurseForge:', err)
  }

  return instances
}

function scanATLauncher(instancesDir: string): ImportableInstance[] {
  const instances: ImportableInstance[] = []

  try {
    const dirs = readdirSync(instancesDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory() || dir.name.startsWith('.')) continue

      const instDir = join(instancesDir, dir.name)

      let name = dir.name
      let version = 'Unknown'
      let loader = 'vanilla'
      let loaderVersion: string | undefined

      // ATLauncher uses instance.json
      const atlMeta = safeReadJson(join(instDir, 'instance.json'))
      if (atlMeta) {
        name = atlMeta.launcher?.name || atlMeta.name || name
        version = atlMeta.id || atlMeta.launcher?.version || version
        if (atlMeta.launcher?.loaderVersion) {
          const lv = atlMeta.launcher.loaderVersion
          if (lv.type === 'FORGE' || lv.type?.toLowerCase() === 'forge') {
            loader = 'forge'
            loaderVersion = lv.version
          } else if (lv.type === 'FABRIC' || lv.type?.toLowerCase() === 'fabric') {
            loader = 'fabric'
            loaderVersion = lv.version
          } else if (lv.type === 'QUILT' || lv.type?.toLowerCase() === 'quilt') {
            loader = 'quilt'
            loaderVersion = lv.version
          } else if (lv.type?.toLowerCase().includes('neoforge')) {
            loader = 'neoforge'
            loaderVersion = lv.version
          }
        }
      }

      const savesDir = join(instDir, 'saves')
      const modsDir = join(instDir, 'mods')
      const rpDir = join(instDir, 'resourcepacks')
      const spDir = join(instDir, 'shaderpacks')
      const optionsFile = join(instDir, 'options.txt')

      instances.push({
        name,
        path: instDir,
        version,
        loader,
        loaderVersion,
        hasWorlds: existsSync(savesDir) && countDirsInDir(savesDir) > 0,
        hasMods: existsSync(modsDir) && countItemsInDir(modsDir, '.jar') > 0,
        hasResourcePacks: existsSync(rpDir) && countItemsInDir(rpDir) > 0,
        hasShaderPacks: existsSync(spDir) && countItemsInDir(spDir) > 0,
        hasSettings: existsSync(optionsFile),
        worldCount: countDirsInDir(savesDir),
        modCount: countItemsInDir(modsDir, '.jar'),
        resourcePackCount: countItemsInDir(rpDir),
      })
    }
  } catch (err) {
    console.error('[Migration] Error scanning ATLauncher:', err)
  }

  return instances
}

// ============================================================
// Import
// ============================================================

/**
 * Import data from a detected launcher into new Loom instances.
 *
 * @param launcherType   Type of launcher to import from
 * @param launcherPath   Base path to the launcher's instances/data
 * @param options        What to import (worlds, mods, resource packs, settings)
 * @param profileId      Optional profile UUID to assign imported instances to
 */
export function importFromLauncher(
  launcherType: LauncherType,
  launcherPath: string,
  options: ImportOptions,
  profileId?: string
): ImportResult {
  console.log(`[Migration] Starting import from ${getLauncherDisplayName(launcherType)}...`)

  const result: ImportResult = {
    success: false,
    importedInstances: [],
    errors: [],
    totalFiles: 0,
  }

  try {
    const importableData = getImportableData(launcherPath, launcherType)

    if (importableData.instances.length === 0) {
      result.errors.push('No instances found to import')
      return result
    }

    // Filter instances if specific ones were selected
    let instancesToImport = importableData.instances
    if (options.specificInstances && options.specificInstances.length > 0) {
      instancesToImport = importableData.instances.filter((inst) =>
        options.specificInstances!.includes(inst.name) ||
        options.specificInstances!.includes(inst.path)
      )
    }

    for (const sourceInstance of instancesToImport) {
      try {
        const importedName = `${sourceInstance.name} (Imported)`

        // Create a new Loom instance
        const newInstance = createInstance(
          importedName,
          sourceInstance.version,
          sourceInstance.loader,
          profileId,
          sourceInstance.loaderVersion
        )

        const destDir = getInstancePath(newInstance.id)
        scaffoldInstanceDirs(destDir)

        // Determine source .minecraft directory
        let mcDir = sourceInstance.path
        if (launcherType === 'prism' || launcherType === 'multimc') {
          const dotMc = join(sourceInstance.path, '.minecraft')
          if (existsSync(dotMc)) mcDir = dotMc
        }

        // Import selected data
        if (options.worlds && sourceInstance.hasWorlds) {
          const copied = safeCopyDir(
            join(mcDir, 'saves'),
            join(destDir, 'saves')
          )
          result.totalFiles += copied
          console.log(`[Migration]   Imported ${sourceInstance.worldCount} world(s)`)
        }

        if (options.mods && sourceInstance.hasMods) {
          const copied = safeCopyDir(
            join(mcDir, 'mods'),
            join(destDir, 'mods')
          )
          result.totalFiles += copied
          console.log(`[Migration]   Imported ${sourceInstance.modCount} mod(s)`)
        }

        if (options.resourcePacks && sourceInstance.hasResourcePacks) {
          const copied = safeCopyDir(
            join(mcDir, 'resourcepacks'),
            join(destDir, 'resourcepacks')
          )
          result.totalFiles += copied
          console.log(`[Migration]   Imported resource packs`)
        }

        if (options.shaderPacks && sourceInstance.hasShaderPacks) {
          const copied = safeCopyDir(
            join(mcDir, 'shaderpacks'),
            join(destDir, 'shaderpacks')
          )
          result.totalFiles += copied
          console.log(`[Migration]   Imported shader packs`)
        }

        if (options.settings && sourceInstance.hasSettings) {
          // Copy options.txt (Minecraft settings)
          const optionsSrc = join(mcDir, 'options.txt')
          if (existsSync(optionsSrc)) {
            try {
              const { copyFileSync } = require('fs')
              copyFileSync(optionsSrc, join(destDir, 'options.txt'))
              result.totalFiles++
            } catch { /* ignore */ }
          }

          // Copy config directory (mod configs)
          const configSrc = join(mcDir, 'config')
          if (existsSync(configSrc)) {
            const copied = safeCopyDir(configSrc, join(destDir, 'config'))
            result.totalFiles += copied
          }

          console.log(`[Migration]   Imported settings/config`)
        }

        result.importedInstances.push(importedName)
        console.log(`[Migration] Imported instance: ${importedName}`)
      } catch (err: any) {
        const errMsg = `Failed to import '${sourceInstance.name}': ${err.message}`
        console.error(`[Migration] ${errMsg}`)
        result.errors.push(errMsg)
      }
    }

    result.success = result.importedInstances.length > 0
    console.log(
      `[Migration] Import complete: ${result.importedInstances.length} instance(s), ` +
      `${result.totalFiles} file(s), ${result.errors.length} error(s)`
    )
  } catch (err: any) {
    result.errors.push(`Import failed: ${err.message}`)
    console.error('[Migration] Import failed:', err)
  }

  return result
}
