import { app } from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { exec, execSync } from 'child_process'

// ============================================================
// Windows Defender Exclusion
// ============================================================

export async function addDefenderExclusion(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  const mcDataPath = join(app.getPath('userData'), 'minecraft_data')
  const instancesPath = join(app.getPath('userData'), 'instances')

  try {
    // Requires admin — will prompt UAC
    const cmd = `powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-Command','Add-MpPreference -ExclusionPath \\\"${mcDataPath}\\\" -ExclusionPath \\\"${instancesPath}\\\"' -Wait"`
    await new Promise<void>((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    console.log('[Perf] Windows Defender exclusion applied:', mcDataPath, instancesPath)
    return true
  } catch (err: any) {
    console.warn('[Perf] Defender exclusion failed (may need admin):', err.message)
    return false
  }
}

// ============================================================
// Power Plan Management
// ============================================================

let savedPowerPlanGuid: string | null = null
const HIGH_PERF_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

export function setHighPerformancePowerPlan(): void {
  if (process.platform !== 'win32') return

  try {
    // Save current power plan
    const output = execSync('powercfg /getactivescheme', { encoding: 'utf8' })
    const match = output.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/)
    if (match) {
      savedPowerPlanGuid = match[1]
    }

    // Switch to High Performance
    execSync(`powercfg /setactive ${HIGH_PERF_GUID}`, { stdio: 'ignore' })
    console.log('[Perf] Power plan set to High Performance')
  } catch (err: any) {
    console.warn('[Perf] Power plan switch failed:', err.message)
  }
}

export function restoreDefaultPowerPlan(): void {
  if (process.platform !== 'win32' || !savedPowerPlanGuid) return

  try {
    execSync(`powercfg /setactive ${savedPowerPlanGuid}`, { stdio: 'ignore' })
    console.log(`[Perf] Power plan restored to ${savedPowerPlanGuid}`)
    savedPowerPlanGuid = null
  } catch (err: any) {
    console.warn('[Perf] Power plan restore failed:', err.message)
  }
}

// ============================================================
// Optimized Game Settings (options.txt)
// ============================================================

const OPTIMIZED_OPTIONS: Record<string, string> = {
  'renderDistance': '12',
  'simulationDistance': '8',
  'maxFps': '0',                  // unlimited
  'enableVsync': 'false',
  'graphicsMode': '1',            // fast
  'ao': 'false',                  // ambient occlusion off
  'renderClouds': '"false"',
  'particles': '1',               // decreased
  'entityShadows': 'false',
  'biomeBlendRadius': '1',
  'guiScale': '3',
  'gamma': '1.0',                 // full bright
  'fov': '0.0',                   // default 70
  'autoJump': 'false',
  'entityDistanceScaling': '1.0',
  'lang': 'en_us',
  'soundCategory_master': '1.0',
  'soundCategory_music': '0.5',
  'mipmapLevels': '4',
  'chatVisibility': '0',
  'reducedDebugInfo': 'false',
}

export function writeOptimizedGameSettings(instancePath: string): void {
  const optionsPath = join(instancePath, 'options.txt')

  // Only write if options.txt doesn't exist (don't overwrite user settings)
  if (existsSync(optionsPath)) {
    console.log('[Perf] options.txt already exists, skipping optimization')
    return
  }

  try {
    const lines = Object.entries(OPTIMIZED_OPTIONS)
      .map(([key, value]) => `${key}:${value}`)
      .join('\n')
    writeFileSync(optionsPath, lines + '\n', 'utf8')
    console.log('[Perf] Optimized options.txt written to', instancePath)
  } catch (err: any) {
    console.warn('[Perf] Failed to write options.txt:', err.message)
  }
}
