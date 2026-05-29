import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

// ============================================================
// Simple file-based config store (shared across main process)
// ============================================================

interface StoreData {
  [key: string]: unknown
}

const configDir = () => join(app.getPath('userData'), 'config')
const configFile = () => join(configDir(), 'settings.json')

function loadConfig(): StoreData {
  try {
    const dir = configDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const file = configFile()
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, 'utf8'))
    }
  } catch {
    // ignore corrupt config
  }
  return {}
}

function saveConfig(data: StoreData): void {
  try {
    const dir = configDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(configFile(), JSON.stringify(data, null, 2), 'utf8')
  } catch (err) {
    console.warn('[Store] Failed to save config:', err)
  }
}

let config = loadConfig()

export function storeGet(key: string): unknown {
  return config[key]
}

export function storeSet(key: string, value: unknown): void {
  config[key] = value
  saveConfig(config)
}

// Reload config from disk (for when index.ts also writes)
export function reloadConfig(): void {
  config = loadConfig()
}
