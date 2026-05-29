import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, net, session } from 'electron'
import { join } from 'path'
// Spotify auth is handled inline below
import { setLauncherWindow, launchInstance, killInstance, getLaunchStatus, preloadEssentials } from './launcher'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { getAllInstances, createInstance, deleteInstance, updateInstance, cloneInstance, openInstanceFolder, listInstanceDir, deleteInstanceFile, renameInstanceFile, openInstanceFile, copyFilesToInstance, getInstancePath, getTrashedInstances, recoverInstance, permanentlyDeleteInstance, migrateOrphanInstances } from './instances'
import { microsoftLogin, getCachedAccount, clearCachedAccount, restoreSession, getAllAccounts, getActiveUuid, switchAccount, removeAccount, updateDisplayName, updateIncognitoPrefs } from './auth'
import { getAllRegions } from './proxy-config'
import { connectDiscord, disconnectDiscord, isDiscordConnected, isDiscordEnabled, getDiscordAppId, destroyDiscord } from './discord'
import { createChat, saveChat, loadChat, listChats, deleteChat, renameChat } from './chat-store'
import { setStateProvider, setLoomieHandler, setSpotifyCommandHandler, DynamicIslandState } from './dynamic-island-server'
import { autoUpdater } from 'electron-updater'
import { addDefenderExclusion, setHighPerformancePowerPlan, restoreDefaultPowerPlan } from './system-optimizations'

// ============================================================
// Simple file-based config store (replaces electron-store)
// ============================================================

interface StoreData {
  theme: string
  windowBounds: { width: number; height: number }
  maximized: boolean
  [key: string]: unknown
}

const CONFIG_DIR = join(app.getPath('userData'), 'config')
const CONFIG_FILE = join(CONFIG_DIR, 'settings.json')

function loadConfig(): StoreData {
  const defaults: StoreData = {
    theme: 'dark',
    windowBounds: { width: 1280, height: 800 },
    maximized: false
  }

  try {
    if (existsSync(CONFIG_FILE)) {
      const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
      return { ...defaults, ...data }
    }
  } catch {
    // Corrupted config, use defaults
  }
  return defaults
}

function saveConfig(data: StoreData): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // Silently fail
  }
}

let config = loadConfig()

function storeGet(key: string): unknown {
  return config[key]
}

function storeSet(key: string, value: unknown): void {
  config[key] = value
  saveConfig(config)
}

// ============================================================
// Window & App
// ============================================================

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): void {
  const bounds = config.windowBounds

  const iconPath = join(__dirname, '../../resources/icon.ico')

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    icon: iconPath,
    backgroundColor: config.theme === 'dark' ? '#1a1a17' : '#ffffff',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false
    }
  })

  setLauncherWindow(mainWindow)

  if (config.maximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', () => {
    if (mainWindow) {
      const isMaximized = mainWindow.isMaximized()
      storeSet('maximized', isMaximized)
      if (!isMaximized) {
        const b = mainWindow.getBounds()
        storeSet('windowBounds', { width: b.width, height: b.height })
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Remove all Content-Security-Policy headers — desktop app doesn't need CSP
  // and it blocks external images (Crafatar skins, Modrinth icons)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    delete headers['Content-Security-Policy']
    delete headers['content-security-policy']
    delete headers['X-Content-Security-Policy']
    delete headers['x-content-security-policy']
    callback({ responseHeaders: headers })
  })

  // Auto-grant microphone permissions for Loomie Live voice mode
  // Need ALL THREE handlers for Electron to fully allow mic access:

  // 1) Permission request handler — when renderer calls getUserMedia
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(true) // Grant all permissions (media, notifications, etc.)
  })

  // 2) Permission check handler — Electron checks this BEFORE the request
  mainWindow.webContents.session.setPermissionCheckHandler(() => {
    return true // All permission checks pass
  })

  // 3) Device permission handler — required for media device enumeration/access in newer Electron
  mainWindow.webContents.session.setDevicePermissionHandler(() => {
    return true // Allow all device access (microphone, camera, etc.)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ============================================================
// Auto-Updater (GitHub Releases)
// ============================================================

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

function sendUpdateStatus(status: string, info?: any) {
  mainWindow?.webContents.send('updater:status', { status, ...info })
}

autoUpdater.on('checking-for-update', () => {
  console.log('[Updater] Checking for update...')
  sendUpdateStatus('checking')
})

autoUpdater.on('update-available', (info) => {
  console.log('[Updater] Update available:', info.version)
  sendUpdateStatus('available', { version: info.version })
})

autoUpdater.on('update-not-available', () => {
  console.log('[Updater] App is up to date')
  sendUpdateStatus('up-to-date')
})

autoUpdater.on('download-progress', (progress) => {
  sendUpdateStatus('downloading', {
    percent: Math.round(progress.percent),
    transferred: progress.transferred,
    total: progress.total,
  })
})

autoUpdater.on('update-downloaded', (info) => {
  console.log('[Updater] Update downloaded:', info.version)
  sendUpdateStatus('ready', { version: info.version })
})

autoUpdater.on('error', (err) => {
  console.error('[Updater] Error:', err.message)
  sendUpdateStatus('error', { message: err.message })
})

// IPC: manually check for updates
ipcMain.handle('updater:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    return { version: result?.updateInfo?.version || null }
  } catch (err: any) {
    return { error: err.message }
  }
})

// IPC: install the downloaded update (restarts app)
ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall(false, true)
})

// IPC: get current app version
ipcMain.handle('updater:getVersion', () => {
  return app.getVersion()
})

// ============================================================
// IPC Handlers — Window Controls
// ============================================================

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

// ============================================================
// IPC Handlers — Theme
// ============================================================

ipcMain.handle('theme:get', () => storeGet('theme'))
ipcMain.handle('theme:set', (_event, theme: string) => {
  storeSet('theme', theme)
  mainWindow?.setBackgroundColor(theme === 'dark' ? '#191919' : '#ffffff')
})

// ============================================================
// IPC Handlers — Store
// ============================================================

ipcMain.handle('store:get', (_event, key: string) => storeGet(key))
ipcMain.handle('store:set', (_event, key: string, value: unknown) => storeSet(key, value))

// ============================================================
// IPC Handlers — Performance Optimizations
// ============================================================

ipcMain.handle('perf:applyDefenderExclusion', async () => {
  return addDefenderExclusion()
})

ipcMain.handle('perf:setPowerPlan', () => {
  setHighPerformancePowerPlan()
})

ipcMain.handle('perf:restorePowerPlan', () => {
  restoreDefaultPowerPlan()
})

// ============================================================
// IPC Handlers — Changing Room (Skin Management)
// ============================================================

// Get current skin info for the active account
ipcMain.handle('skins:getCurrent', async () => {
  const account = getCachedAccount()
  if (!account) return null
  try {
    const resp = await net.fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${account.accessToken}` }
    })
    if (!resp.ok) return null
    const data = await resp.json() as { skins?: { url: string; variant: string; state: string }[] }
    const activeSkin = data.skins?.find((s: { state: string }) => s.state === 'ACTIVE')
    return activeSkin ? { url: activeSkin.url, variant: activeSkin.variant } : null
  } catch {
    return null
  }
})

// Upload a custom skin PNG
ipcMain.handle('skins:upload', async (_event, filePath: string, variant: 'classic' | 'slim') => {
  const account = getCachedAccount()
  if (!account) return { success: false, error: 'Not logged in' }
  try {
    const skinData = readFileSync(filePath)
    const boundary = `----SkinUpload${Date.now()}`
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\n${variant}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n`),
      skinData,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const resp = await net.fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })
    if (!resp.ok) {
      const text = await resp.text()
      return { success: false, error: `Upload failed: ${resp.status} ${text}` }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Upload failed' }
  }
})

// Upload a skin from a URL (for default skins)
ipcMain.handle('skins:uploadUrl', async (_event, skinUrl: string, variant: 'classic' | 'slim') => {
  const account = getCachedAccount()
  if (!account) return { success: false, error: 'Not logged in' }
  try {
    const resp = await net.fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ variant, url: skinUrl }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      return { success: false, error: `Upload failed: ${resp.status} ${text}` }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Upload failed' }
  }
})

// Reset skin to default
ipcMain.handle('skins:reset', async () => {
  const account = getCachedAccount()
  if (!account) return { success: false, error: 'Not logged in' }
  try {
    const resp = await net.fetch('https://api.minecraftservices.com/minecraft/profile/skins/active', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${account.accessToken}` },
    })
    if (!resp.ok && resp.status !== 204) {
      return { success: false, error: `Reset failed: ${resp.status}` }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Reset failed' }
  }
})

// Pick a skin file via native dialog
ipcMain.handle('skins:pickFile', async () => {
  const { dialog } = await import('electron')
  const result = await dialog.showOpenDialog({
    title: 'Select Skin PNG',
    filters: [{ name: 'PNG Images', extensions: ['png'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ============================================================
// IPC Handlers — Skin URL Resolver (direct from Mojang)
// ============================================================

ipcMain.handle('skins:resolve', async (_event, uuid: string, size = 120) => {
  try {
    // 1. Get skin texture URL from Mojang session server
    const cleanUuid = uuid.replace(/-/g, '')
    const profileResp = await net.fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${cleanUuid}`)
    if (!profileResp.ok) return null
    const profileData = await profileResp.json() as { properties?: { name: string; value: string }[] }
    const texProp = profileData.properties?.find((p: { name: string }) => p.name === 'textures')
    if (!texProp) return null
    const decoded = JSON.parse(Buffer.from(texProp.value, 'base64').toString('utf-8'))
    const skinTextureUrl = decoded.textures?.SKIN?.url as string | undefined
    if (!skinTextureUrl) return null

    // 2. Fetch the raw skin PNG
    const texResp = await net.fetch(skinTextureUrl)
    if (!texResp.ok) return null
    const texBuffer = Buffer.from(await texResp.arrayBuffer())

    // 3. Decode with nativeImage
    const fullImage = nativeImage.createFromBuffer(texBuffer)
    const fullSize = fullImage.getSize()
    if (fullSize.width < 64 || fullSize.height < 32) return null
    const bitmap = fullImage.toBitmap()
    const w = fullSize.width // 64
    const stride = w * 4 // bytes per row (RGBA)

    // 4. Extract 8x8 face (pixels 8,8 → 16,16) and overlay hat (40,8 → 48,16)
    const faceSize = 8
    const facePixels = Buffer.alloc(faceSize * faceSize * 4)

    for (let y = 0; y < faceSize; y++) {
      for (let x = 0; x < faceSize; x++) {
        const srcIdx = ((y + 8) * stride) + ((x + 8) * 4)
        const dstIdx = (y * faceSize + x) * 4
        // Copy face base
        facePixels[dstIdx] = bitmap[srcIdx]       // R
        facePixels[dstIdx + 1] = bitmap[srcIdx + 1] // G
        facePixels[dstIdx + 2] = bitmap[srcIdx + 2] // B
        facePixels[dstIdx + 3] = bitmap[srcIdx + 3] // A

        // Overlay hat layer (40,8) on top if not fully transparent
        const hatIdx = ((y + 8) * stride) + ((x + 40) * 4)
        const hatA = bitmap[hatIdx + 3]
        if (hatA > 0) {
          const alpha = hatA / 255
          const invAlpha = 1 - alpha
          facePixels[dstIdx] = Math.round(bitmap[hatIdx] * alpha + facePixels[dstIdx] * invAlpha)
          facePixels[dstIdx + 1] = Math.round(bitmap[hatIdx + 1] * alpha + facePixels[dstIdx + 1] * invAlpha)
          facePixels[dstIdx + 2] = Math.round(bitmap[hatIdx + 2] * alpha + facePixels[dstIdx + 2] * invAlpha)
          facePixels[dstIdx + 3] = 255
        }
      }
    }

    // 5. Scale up the 8x8 face to requested size using nearest-neighbor (pixelated)
    const scale = Math.max(1, Math.round(size / faceSize))
    const outSize = faceSize * scale
    const scaledPixels = Buffer.alloc(outSize * outSize * 4)

    for (let y = 0; y < outSize; y++) {
      for (let x = 0; x < outSize; x++) {
        const srcX = Math.floor(x / scale)
        const srcY = Math.floor(y / scale)
        const srcIdx = (srcY * faceSize + srcX) * 4
        const dstIdx = (y * outSize + x) * 4
        scaledPixels[dstIdx] = facePixels[srcIdx]
        scaledPixels[dstIdx + 1] = facePixels[srcIdx + 1]
        scaledPixels[dstIdx + 2] = facePixels[srcIdx + 2]
        scaledPixels[dstIdx + 3] = facePixels[srcIdx + 3]
      }
    }

    // 6. Create nativeImage from scaled bitmap and return as data URL
    const resultImage = nativeImage.createFromBitmap(scaledPixels, { width: outSize, height: outSize })
    return resultImage.toDataURL()
  } catch {
    return null
  }
})

// Helper: blit a region from skin bitmap onto an output buffer with alpha compositing
function blitSkinRegion(
  src: Buffer, srcStride: number,
  dst: Buffer, dstW: number,
  srcX: number, srcY: number, w: number, h: number,
  dstX: number, dstY: number
) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((srcY + y) * srcStride) + ((srcX + x) * 4)
      const di = ((dstY + y) * dstW + (dstX + x)) * 4
      const a = src[si + 3]
      if (a === 0) continue
      if (a === 255 || dst[di + 3] === 0) {
        dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255
      } else {
        const alpha = a / 255, inv = 1 - alpha
        dst[di] = Math.round(src[si] * alpha + dst[di] * inv)
        dst[di + 1] = Math.round(src[si + 1] * alpha + dst[di + 1] * inv)
        dst[di + 2] = Math.round(src[si + 2] * alpha + dst[di + 2] * inv)
        dst[di + 3] = 255
      }
    }
  }
}

ipcMain.handle('skins:resolveBody', async (_event, uuid: string, height = 256) => {
  try {
    const cleanUuid = uuid.replace(/-/g, '')
    const profileResp = await net.fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${cleanUuid}`)
    if (!profileResp.ok) return null
    const profileData = await profileResp.json() as { properties?: { name: string; value: string }[] }
    const texProp = profileData.properties?.find((p: { name: string }) => p.name === 'textures')
    if (!texProp) return null
    const decoded = JSON.parse(Buffer.from(texProp.value, 'base64').toString('utf-8'))
    const skinTextureUrl = decoded.textures?.SKIN?.url as string | undefined
    if (!skinTextureUrl) return null

    const texResp = await net.fetch(skinTextureUrl)
    if (!texResp.ok) return null
    const texBuffer = Buffer.from(await texResp.arrayBuffer())
    const fullImage = nativeImage.createFromBuffer(texBuffer)
    const fullSize = fullImage.getSize()
    if (fullSize.width < 64 || fullSize.height < 32) return null
    const bitmap = fullImage.toBitmap()
    const stride = fullSize.width * 4

    // Body layout: 16px wide x 32px tall
    // Head: 8x8 at (4,0), Body: 8x12 at (4,8), Arms: 4x12 at (0,8) and (12,8), Legs: 4x12 at (4,20) and (8,20)
    const bw = 16, bh = 32
    const body = Buffer.alloc(bw * bh * 4)

    // Base layers
    blitSkinRegion(bitmap, stride, body, bw, 8, 8, 8, 8, 4, 0)      // Head
    blitSkinRegion(bitmap, stride, body, bw, 20, 20, 8, 12, 4, 8)   // Body/torso
    blitSkinRegion(bitmap, stride, body, bw, 44, 20, 4, 12, 0, 8)   // Right arm
    blitSkinRegion(bitmap, stride, body, bw, 4, 20, 4, 12, 4, 20)   // Right leg

    // New format (64x64) has separate left arm/leg
    if (fullSize.height >= 64) {
      blitSkinRegion(bitmap, stride, body, bw, 36, 52, 4, 12, 12, 8)  // Left arm
      blitSkinRegion(bitmap, stride, body, bw, 20, 52, 4, 12, 8, 20)  // Left leg
    } else {
      // Old format: mirror right arm/leg
      blitSkinRegion(bitmap, stride, body, bw, 44, 20, 4, 12, 12, 8)
      blitSkinRegion(bitmap, stride, body, bw, 4, 20, 4, 12, 8, 20)
    }

    // Overlay layers
    blitSkinRegion(bitmap, stride, body, bw, 40, 8, 8, 8, 4, 0)     // Head overlay
    if (fullSize.height >= 64) {
      blitSkinRegion(bitmap, stride, body, bw, 20, 36, 8, 12, 4, 8)   // Body overlay
      blitSkinRegion(bitmap, stride, body, bw, 44, 36, 4, 12, 0, 8)   // Right arm overlay
      blitSkinRegion(bitmap, stride, body, bw, 52, 52, 4, 12, 12, 8)  // Left arm overlay
      blitSkinRegion(bitmap, stride, body, bw, 4, 36, 4, 12, 4, 20)   // Right leg overlay
      blitSkinRegion(bitmap, stride, body, bw, 4, 52, 4, 12, 8, 20)   // Left leg overlay
    }

    // Scale up with nearest-neighbor
    const scale = Math.max(1, Math.round(height / bh))
    const outW = bw * scale, outH = bh * scale
    const scaled = Buffer.alloc(outW * outH * 4)
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const si = (Math.floor(y / scale) * bw + Math.floor(x / scale)) * 4
        const di = (y * outW + x) * 4
        scaled[di] = body[si]; scaled[di + 1] = body[si + 1]; scaled[di + 2] = body[si + 2]; scaled[di + 3] = body[si + 3]
      }
    }

    return nativeImage.createFromBitmap(scaled, { width: outW, height: outH }).toDataURL()
  } catch {
    return null
  }
})

// ============================================================
// IPC Handlers — Instances
// ============================================================

ipcMain.handle('instances:getAll', () => getAllInstances())
ipcMain.handle('instances:create', (_event, config: { name: string; version: string; loader: string; createdBy?: string }) => {
  return createInstance(config.name, config.version, config.loader, config.createdBy)
})
ipcMain.handle('instances:delete', (_event, id: string) => deleteInstance(id))
ipcMain.handle('instances:getTrash', () => getTrashedInstances())
ipcMain.handle('instances:recover', (_event, id: string) => recoverInstance(id))
ipcMain.handle('instances:permanentDelete', (_event, id: string) => permanentlyDeleteInstance(id))
ipcMain.handle('instances:update', (_event, id: string, config: Record<string, unknown>) => {
  return updateInstance(id, config)
})
ipcMain.handle('instances:clone', (_event, id: string, newName: string, targetProfileId?: string) => {
  return cloneInstance(id, newName, targetProfileId)
})
ipcMain.handle('instances:openFolder', (_event, id: string) => {
  return openInstanceFolder(id)
})
ipcMain.handle('instances:getPath', (_event, id: string) => {
  return getInstancePath(id)
})

// File Explorer
ipcMain.handle('instances:listDir', (_event, id: string, relativePath: string) => {
  return listInstanceDir(id, relativePath || '')
})
ipcMain.handle('instances:deleteFile', (_event, id: string, relativePath: string) => {
  return deleteInstanceFile(id, relativePath)
})
ipcMain.handle('instances:renameFile', (_event, id: string, relativePath: string, newName: string) => {
  return renameInstanceFile(id, relativePath, newName)
})
ipcMain.handle('instances:openFile', (_event, id: string, relativePath: string) => {
  return openInstanceFile(id, relativePath)
})
ipcMain.handle('instances:copyFiles', (_event, id: string, relativeDest: string, filePaths: string[]) => {
  return copyFilesToInstance(id, relativeDest, filePaths)
})
ipcMain.handle('instances:setIcon', async (_event, id: string, imagePath: string) => {
  const instanceDir = getInstancePath(id)
  const ext = imagePath.split('.').pop()?.toLowerCase() || 'png'
  const iconName = `icon.${ext}`
  const dest = join(instanceDir, iconName)
  copyFileSync(imagePath, dest)
  return updateInstance(id, { customIcon: iconName })
})
// ============================================================
// IPC Handlers — Version Lists (Mojang / Fabric / Forge)
// ============================================================

interface VersionCache {
  versions: string[]
  timestamp: number
}

const versionCache: Record<string, VersionCache> = {}
const VERSION_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

ipcMain.handle('versions:getAll', async (_event, loader: string) => {
  const cacheKey = loader.toLowerCase()
  const cached = versionCache[cacheKey]
  if (cached && Date.now() - cached.timestamp < VERSION_CACHE_TTL) {
    return cached.versions
  }

  try {
    let versions: string[] = []

    if (cacheKey === 'vanilla' || cacheKey === '') {
      // Fetch all release versions from Mojang
      const res = await net.fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')
      if (res.ok) {
        const data = await res.json() as { versions: { id: string; type: string }[] }
        versions = data.versions
          .filter((v) => v.type === 'release')
          .map((v) => v.id)
      }
    } else if (cacheKey === 'fabric') {
      // Fetch Fabric-supported game versions
      const res = await net.fetch('https://meta.fabricmc.net/v2/versions/game')
      if (res.ok) {
        const data = await res.json() as { version: string; stable: boolean }[]
        versions = data
          .filter((v) => v.stable)
          .map((v) => v.version)
      }
    } else if (cacheKey === 'forge') {
      let allReleases: string[] = []
      // First get all vanilla releases
      const mojRes = await net.fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')
      if (mojRes.ok) {
        const mojData = await mojRes.json() as { versions: { id: string; type: string }[] }
        allReleases = mojData.versions.filter((v) => v.type === 'release').map((v) => v.id)
      }
      // Then check which ones Forge supports via Forge promotions
      try {
        const forgeRes = await net.fetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')
        if (forgeRes.ok) {
          const forgeData = await forgeRes.json() as { promos: Record<string, string> }
          const forgeVersions = new Set<string>()
          for (const key of Object.keys(forgeData.promos)) {
            // Keys are like "1.20.1-latest", "1.20.1-recommended"
            const mcVer = key.split('-')[0]
            if (mcVer) forgeVersions.add(mcVer)
          }
          versions = allReleases.filter((v) => forgeVersions.has(v))
        }
      } catch {
        // If Forge API fails, return all releases as fallback
        versions = allReleases
      }
    }

    if (versions.length > 0) {
      versionCache[cacheKey] = { versions, timestamp: Date.now() }
    }
    return versions
  } catch (err) {
    console.error('Failed to fetch versions:', err)
    return []
  }
})

// ============================================================
// IPC Handlers — Mojang API
// ============================================================

ipcMain.handle('mojang:lookupPlayer', async (_event, username: string) => {
  try {
    const response = await net.fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`)
    if (!response.ok) return null
    const data = await response.json()
    return { name: data.name, id: data.id }
  } catch {
    return null
  }
})

// ============================================================
// IPC Handlers — Image Proxy (bypass CSP/CORS for Crafatar etc.)
// ============================================================

const imageCache = new Map<string, { data: string; expires: number }>()

ipcMain.handle('image:proxy', async (_event, url: string) => {
  // Check cache (5 min TTL)
  const cached = imageCache.get(url)
  if (cached && Date.now() < cached.expires) return cached.data

  try {
    const response = await net.fetch(url)
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || 'image/png'
    const buffer = Buffer.from(await response.arrayBuffer())
    const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`
    imageCache.set(url, { data: dataUri, expires: Date.now() + 300_000 })
    return dataUri
  } catch {
    return null
  }
})

// ============================================================
// IPC Handlers — Modrinth Mod Search
// ============================================================

ipcMain.handle('mods:search', async (_event, query: string, page: number) => {
  try {
    const offset = page * 20
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=20&offset=${offset}&facets=[["project_type:mod"]]`
    const response = await net.fetch(url, {
      headers: { 'User-Agent': 'loom-launcher/1.0.0' }
    })
    if (!response.ok) return { hits: [], total_hits: 0 }
    return await response.json()
  } catch {
    return { hits: [], total_hits: 0 }
  }
})

// ============================================================
// IPC Handlers — Tools Config (persisted via store)
// ============================================================

ipcMain.handle('tools:getConfig', (_event, tool: string) => {
  return storeGet(`tool_${tool}`) || { enabled: false }
})

ipcMain.handle('tools:setConfig', (_event, tool: string, toolConfig: unknown) => {
  storeSet(`tool_${tool}`, toolConfig)
})

ipcMain.handle('tools:toggle', (_event, tool: string, enabled: boolean) => {
  const current = (storeGet(`tool_${tool}`) as Record<string, unknown>) || {}
  storeSet(`tool_${tool}`, { ...current, enabled })
})

ipcMain.handle('tools:killAll', () => {
  // Future: kill running tool processes
})

// ============================================================
// IPC Handlers — Spotify (real implementation with PKCE)
// ============================================================

import crypto from 'crypto'

const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state'

function getSpotifyConfig(): { clientId: string; redirectUri: string } {
  const cfg = (storeGet('spotify_config') as any) || {}
  return {
    clientId: cfg.clientId || '',
    redirectUri: cfg.redirectUri || 'https://127.0.0.1:18492/callback',
  }
}

let spotifyAccessToken: string | null = null
let spotifyRefreshToken: string | null = (storeGet('spotify_refresh_token') as string) || null
let spotifyTokenExpiry = 0

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

// Save/load spotify config
ipcMain.handle('spotify:setConfig', (_event, config: { clientId: string; redirectUri: string }) => {
  storeSet('spotify_config', config)
  // Reset tokens on config change
  spotifyAccessToken = null
  spotifyRefreshToken = null
  spotifyTokenExpiry = 0
  return true
})

ipcMain.handle('spotify:getConfig', () => {
  return getSpotifyConfig()
})

async function refreshSpotifyToken(): Promise<boolean> {
  const { clientId } = getSpotifyConfig()
  if (!spotifyRefreshToken || !clientId) return false
  try {
    const response = await net.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: spotifyRefreshToken,
        client_id: clientId,
      }).toString(),
    })
    if (!response.ok) return false
    const data = await response.json()
    spotifyAccessToken = data.access_token
    if (data.refresh_token) {
      spotifyRefreshToken = data.refresh_token
      storeSet('spotify_refresh_token', data.refresh_token)
    }
    spotifyTokenExpiry = Date.now() + data.expires_in * 1000
    return true
  } catch {
    return false
  }
}

async function getSpotifyToken(): Promise<string | null> {
  if (spotifyAccessToken && Date.now() < spotifyTokenExpiry - 60000) {
    return spotifyAccessToken
  }
  if (spotifyRefreshToken) {
    const ok = await refreshSpotifyToken()
    if (ok) return spotifyAccessToken
  }
  return null
}

ipcMain.handle('spotify:login', async () => {
  const { clientId, redirectUri } = getSpotifyConfig()
  if (!clientId) return { connected: false, error: 'No Client ID configured' }

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  return new Promise((resolve) => {
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SPOTIFY_SCOPES)}&code_challenge_method=S256&code_challenge=${codeChallenge}`

    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      parent: mainWindow || undefined,
      modal: !!mainWindow,
      show: false,
      title: 'Connect Spotify',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    authWindow.setMenuBarVisibility(false)
    let resolved = false

    const handleUrl = async (url: string) => {
      if (!url.startsWith(redirectUri) || resolved) return
      resolved = true
      const urlObj = new URL(url)
      const code = urlObj.searchParams.get('code')
      const error = urlObj.searchParams.get('error')

      if (!authWindow.isDestroyed()) authWindow.destroy()

      if (error || !code) {
        resolve({ connected: false, error: error || 'No code received' })
        return
      }

      // Exchange code for token
      try {
        const response = await net.fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: codeVerifier,
          }).toString(),
        })

        if (!response.ok) {
          resolve({ connected: false, error: 'Token exchange failed' })
          return
        }

        const data = await response.json()
        spotifyAccessToken = data.access_token
        spotifyRefreshToken = data.refresh_token
        spotifyTokenExpiry = Date.now() + data.expires_in * 1000
        // Persist refresh token so Spotify stays connected across restarts
        storeSet('spotify_refresh_token', data.refresh_token)
        resolve({ connected: true })
      } catch (err: any) {
        resolve({ connected: false, error: err.message })
      }
    }

    authWindow.webContents.on('will-redirect', (_e, url) => handleUrl(url))
    authWindow.webContents.on('will-navigate', (_e, url) => handleUrl(url))
    authWindow.webContents.on('did-navigate', (_e, url) => handleUrl(url))
    // Capture redirect even if page fails to load (HTTPS with no server)
    authWindow.webContents.on('did-fail-load', (_e, _code, _desc, url) => {
      if (url) handleUrl(url)
    })

    authWindow.on('closed', () => {
      if (!resolved) { resolved = true; resolve({ connected: false, error: 'Window closed' }) }
    })

    authWindow.loadURL(authUrl)
    authWindow.once('ready-to-show', () => { if (!resolved) authWindow.show() })
  })
})

ipcMain.handle('spotify:logout', async () => {
  spotifyAccessToken = null
  spotifyRefreshToken = null
  spotifyTokenExpiry = 0
  storeSet('spotify_refresh_token', null)

  // Clear Spotify auth cookies so reconnecting prompts a fresh account login
  try {
    const { session: ses } = require('electron')
    const cookies = ses.defaultSession.cookies
    const spotifyCookies = await cookies.get({ domain: '.spotify.com' })
    for (const cookie of spotifyCookies) {
      const url = `https://${cookie.domain?.replace(/^\./, '')}${cookie.path}`
      await cookies.remove(url, cookie.name)
    }
    const accountsCookies = await cookies.get({ domain: '.accounts.spotify.com' })
    for (const cookie of accountsCookies) {
      const url = `https://${cookie.domain?.replace(/^\./, '')}${cookie.path}`
      await cookies.remove(url, cookie.name)
    }
  } catch (e) {
    console.warn('[Spotify] Failed to clear cookies:', e)
  }

  return true
})

ipcMain.handle('spotify:status', async () => {
  const token = await getSpotifyToken()
  if (!token) return { connected: false }

  try {
    const response = await net.fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.status === 204) return { connected: true, playing: false }
    if (!response.ok) return { connected: true, playing: false }
    const data = await response.json()
    if (!data?.item) return { connected: true, playing: false }

    return {
      connected: true,
      playing: data.is_playing,
      volume: data.device?.volume_percent || 0,
      track: {
        title: data.item.name,
        artist: data.item.artists?.map((a: any) => a.name).join(', ') || '',
        albumArt: data.item.album?.images?.[0]?.url || '',
        albumArtSmall: data.item.album?.images?.[2]?.url || data.item.album?.images?.[0]?.url || '',
        progress: data.progress_ms || 0,
        duration: data.item.duration_ms || 0,
      },
    }
  } catch {
    return { connected: true, playing: false }
  }
})

ipcMain.handle('spotify:play', async () => {
  const token = await getSpotifyToken()
  if (!token) return
  await net.fetch('https://api.spotify.com/v1/me/player/play', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {})
})

ipcMain.handle('spotify:pause', async () => {
  const token = await getSpotifyToken()
  if (!token) return
  await net.fetch('https://api.spotify.com/v1/me/player/pause', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {})
})

ipcMain.handle('spotify:next', async () => {
  const token = await getSpotifyToken()
  if (!token) return
  await net.fetch('https://api.spotify.com/v1/me/player/next', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {})
})

ipcMain.handle('spotify:previous', async () => {
  const token = await getSpotifyToken()
  if (!token) return
  await net.fetch('https://api.spotify.com/v1/me/player/previous', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
})

ipcMain.handle('spotify:setVolume', async (_event, volumePercent: number) => {
  const token = await getSpotifyToken()
  if (!token) return
  await net.fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volumePercent}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  })
})

ipcMain.handle('spotify:lyrics', async (_event, trackName: string, artistName: string, durationMs: number) => {
  try {
    const durationSec = Math.round(durationMs / 1000)
    // Try exact match first
    const query = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
      duration: durationSec.toString()
    }).toString()
    const response = await net.fetch(`https://lrclib.net/api/get?${query}`)
    if (response.ok) {
      const data = await response.json()
      if (data.syncedLyrics || data.plainLyrics) {
        return data.syncedLyrics || data.plainLyrics
      }
    }
    // Fallback: search without strict duration
    const searchQuery = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
    }).toString()
    const searchResp = await net.fetch(`https://lrclib.net/api/search?${searchQuery}`)
    if (searchResp.ok) {
      const results = await searchResp.json()
      if (Array.isArray(results) && results.length > 0) {
        return results[0].syncedLyrics || results[0].plainLyrics || null
      }
    }
    return null
  } catch {
    return null
  }
})

// ============================================================
// Dynamic Island — State Provider & Loomie Handler
// ============================================================

// Cache latest Spotify state for the Dynamic Island broadcast
let cachedSpotifyState: DynamicIslandState['spotify'] = null

// Poll Spotify in background for Dynamic Island (reuses existing token logic)
let spotifyPollFailCount = 0
let spotifyBackoffUntil = 0
let spotifyBackoffMultiplier = 1
async function pollSpotify() {
  try {
    // Skip if we're in a backoff period
    if (Date.now() < spotifyBackoffUntil) return

    const token = await getSpotifyToken()
    if (!token) {
      if (spotifyPollFailCount++ % 20 === 0) console.log('[DynamicIsland] Spotify: no token available')
      cachedSpotifyState = null; return
    }
    spotifyPollFailCount = 0
    const response = await net.fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.status === 429) {
      // Rate limited — exponential backoff: 60s, 120s, 240s, ... up to 30min
      const backoffSeconds = Math.min(60 * spotifyBackoffMultiplier, 1800)
      spotifyBackoffMultiplier = Math.min(spotifyBackoffMultiplier * 2, 30)
      spotifyBackoffUntil = Date.now() + backoffSeconds * 1000
      console.log(`[DynamicIsland] Spotify rate limited, backing off ${backoffSeconds}s (multiplier: ${spotifyBackoffMultiplier})`)
      return // keep cachedSpotifyState as-is so music doesn't disappear
    }
    // Success or non-429 — reset backoff multiplier
    spotifyBackoffMultiplier = 1
    if (response.status === 204) {
      cachedSpotifyState = null; return
    }
    if (!response.ok) {
      console.log('[DynamicIsland] Spotify API error:', response.status, response.statusText)
      cachedSpotifyState = null; return
    }
    const data = await response.json() as any
    if (!data?.item) { cachedSpotifyState = null; return }
    cachedSpotifyState = {
      playing: data.is_playing,
      title: data.item.name,
      artist: data.item.artists?.map((a: any) => a.name).join(', ') || '',
      progress: (data.progress_ms || 0) / (data.item.duration_ms || 1),
      duration: data.item.duration_ms || 0,
      albumArt: data.item.album?.images?.[2]?.url || data.item.album?.images?.[0]?.url || null,
    }
  } catch (e: any) {
    if (spotifyPollFailCount++ % 20 === 0) console.log('[DynamicIsland] Spotify poll error:', e?.message)
    cachedSpotifyState = null
  }
}
setInterval(pollSpotify, 5000) // Poll every 5s to stay well under Spotify's rate limit

// ── Lyrics from LRCLIB ──────────────────────────
interface LyricsLine { time: number; text: string }
let cachedLyrics: LyricsLine[] | null = null
let cachedLyricsKey: string | null = null

async function fetchLyrics(title: string, artist: string): Promise<LyricsLine[] | null> {
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist })
    const res = await net.fetch(`https://lrclib.net/api/get?${params}`)
    if (!res.ok) return null
    const data = await res.json() as any
    if (!data?.syncedLyrics) return null

    // Parse LRC format: [mm:ss.xx] text
    const lines: LyricsLine[] = []
    for (const line of (data.syncedLyrics as string).split('\n')) {
      const match = line.match(/^\[(\d+):(\d+)\.(\d+)\]\s*(.*)$/)
      if (match) {
        const mins = parseInt(match[1])
        const secs = parseInt(match[2])
        const ms = parseInt(match[3]) * 10
        const text = match[4].trim()
        if (text) lines.push({ time: mins * 60000 + secs * 1000 + ms, text })
      }
    }
    return lines.length > 0 ? lines : null
  } catch {
    return null
  }
}

// Provide state to the WebSocket server
setStateProvider(() => {
  const now = new Date()

  // Auto-fetch lyrics when song changes
  if (cachedSpotifyState?.title && cachedSpotifyState?.artist) {
    const key = `${cachedSpotifyState.title}|${cachedSpotifyState.artist}`
    if (key !== cachedLyricsKey) {
      cachedLyricsKey = key
      cachedLyrics = null
      fetchLyrics(cachedSpotifyState.title, cachedSpotifyState.artist).then(l => {
        if (cachedLyricsKey === key) cachedLyrics = l
      })
    }
  }

  return {
    type: 'state',
    spotify: cachedSpotifyState ? {
      ...cachedSpotifyState,
      lyrics: cachedLyrics,
    } : null,
    time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    notification: null,
  }
})


// Handle Spotify commands from in-game keybinds
let preDuckVolume: number | null = null
let duckTimers: ReturnType<typeof setTimeout>[] = []

async function setSpotifyVolume(token: string, vol: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(vol)))
  await net.fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${clamped}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }
  })
}

setSpotifyCommandHandler(async (command: string) => {
  try {
    const token = await getSpotifyToken()
    if (!token) return

    if (command === 'spotify_toggle') {
      const statusRes = await net.fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (statusRes.ok && statusRes.status !== 204) {
        const data = await statusRes.json() as any
        const endpoint = data?.is_playing ? 'pause' : 'play'
        await net.fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${token}` }
        })
      }
    } else if (command === 'spotify_next') {
      await net.fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      })
    } else if (command === 'spotify_previous') {
      await net.fetch('https://api.spotify.com/v1/me/player/previous', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      })
    } else if (command === 'spotify_duck') {
      // Clear any pending restore timers
      duckTimers.forEach(t => clearTimeout(t))
      duckTimers = []

      // Get current volume if not already ducked
      if (preDuckVolume === null) {
        const statusRes = await net.fetch('https://api.spotify.com/v1/me/player', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (statusRes.ok && statusRes.status !== 204) {
          const data = await statusRes.json() as any
          preDuckVolume = data?.device?.volume_percent ?? 70
        } else {
          preDuckVolume = 70
        }
      }

      // Ease down: 90% → 80% → 70% → 60% of original over ~400ms
      const v = preDuckVolume
      await setSpotifyVolume(token, v * 0.90)
      duckTimers.push(setTimeout(async () => {
        try { const t = await getSpotifyToken(); if (t) await setSpotifyVolume(t, v * 0.80) } catch {}
      }, 120))
      duckTimers.push(setTimeout(async () => {
        try { const t = await getSpotifyToken(); if (t) await setSpotifyVolume(t, v * 0.70) } catch {}
      }, 240))
      duckTimers.push(setTimeout(async () => {
        try { const t = await getSpotifyToken(); if (t) await setSpotifyVolume(t, v * 0.60) } catch {}
      }, 360))

    } else if (command === 'spotify_unduck') {
      // Ease back up: 70% → 80% → 90% → 100% of original over ~500ms
      duckTimers.forEach(t => clearTimeout(t))
      duckTimers = []

      const original = preDuckVolume ?? 70
      preDuckVolume = null

      await setSpotifyVolume(token, original * 0.70)
      duckTimers.push(setTimeout(async () => {
        try { const t = await getSpotifyToken(); if (t) await setSpotifyVolume(t, original * 0.80) } catch {}
      }, 150))
      duckTimers.push(setTimeout(async () => {
        try { const t = await getSpotifyToken(); if (t) await setSpotifyVolume(t, original * 0.90) } catch {}
      }, 300))
      duckTimers.push(setTimeout(async () => {
        try { const t = await getSpotifyToken(); if (t) await setSpotifyVolume(t, original) } catch {}
      }, 450))
    }
  } catch (e) {
    console.error('[DynamicIsland] Spotify command error:', e)
  }
})

// Forward in-game Loomie questions to Gemini
setLoomieHandler(async (text: string, reply: (answer: string) => void) => {
  try {
    const apiKey = storeGet('geminiApiKey') as string
    if (!apiKey) {
      reply('Error: No Gemini API key found in Loom Launcher settings.')
      return
    }

    const systemText = GEMINI_SYSTEM_PROMPT
    const contents = [{ role: 'user', parts: [{ text }] }]

    const response = await net.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemText }] },
          contents,
          tools: LOOMIE_TOOLS,
        })
      }
    )

    if (!response.ok) {
      reply('Loomie is having trouble connecting to the network.')
      return
    }

    const data = await response.json()
    const content = data.candidates?.[0]?.content
    
    // Quick handle of simple text response
    if (content?.parts?.[0]?.text) {
      reply(content.parts[0].text)
    } else if (content?.parts?.[0]?.functionCall) {
      // Loomie wants to run a tool, but we don't have multi-turn loop here for simplicity yet.
      // So just tell the user what it did.
      const name = content.parts[0].functionCall.name
      reply(`Executing launcher action: ${name}... Check the launcher!`)
      executeLoomieTool(name, content.parts[0].functionCall.args || {})
    } else {
      reply('I did not understand that.')
    }

  } catch (err: any) {
    reply(`Error: ${err.message}`)
  }
})



// ============================================================
// IPC Handlers — Auth (Microsoft OAuth — Multi-Account)
// ============================================================

ipcMain.handle('auth:login', async () => {
  try {
    const account = await microsoftLogin(mainWindow)
    return { username: account.username, uuid: account.uuid, displayName: account.displayName }
  } catch (err: any) {
    return { error: err?.message || 'Authentication failed' }
  }
})

ipcMain.handle('auth:logout', () => {
  clearCachedAccount()
  return true
})

ipcMain.handle('auth:getAccount', async () => {
  let account = getCachedAccount()
  if (!account) {
    account = await restoreSession()
  }
  if (!account) return null
  return { username: account.username, uuid: account.uuid, displayName: account.displayName }
})

ipcMain.handle('auth:getAccounts', () => {
  return getAllAccounts()
})

ipcMain.handle('auth:getActiveUuid', () => {
  return getActiveUuid()
})

ipcMain.handle('auth:switchAccount', async (_event, uuid: string) => {
  const account = await switchAccount(uuid)
  if (!account) return null
  return { username: account.username, uuid: account.uuid, displayName: account.displayName }
})

ipcMain.handle('auth:removeAccount', (_event, uuid: string) => {
  removeAccount(uuid)
  return true
})

ipcMain.handle('auth:updateDisplayName', (_event, uuid: string, displayName: string) => {
  updateDisplayName(uuid, displayName)
  return true
})

// ============================================================
// IPC Handlers — Incognito
// ============================================================

ipcMain.handle('incognito:getRegions', () => {
  return getAllRegions()
})

ipcMain.handle('incognito:updatePrefs', (_event, uuid: string, region?: string, enabled?: boolean) => {
  updateIncognitoPrefs(uuid, region, enabled)
  return true
})

// ============================================================
// IPC Handlers — Launch (stubs to prevent errors)
// ============================================================

ipcMain.handle('launch:start', async (_event, id: string) => launchInstance(id))
ipcMain.handle('launch:kill', () => killInstance())
ipcMain.handle('launch:status', () => getLaunchStatus())

// ============================================================
// IPC Handlers — Stats (stubs)
// ============================================================

ipcMain.handle('stats:getPlayer', () => null)
ipcMain.handle('stats:getHistory', () => [])
ipcMain.handle('stats:snapshot', () => null)

// ============================================================
// IPC Handlers — Instance Clone (stub)
// ============================================================

// instances:clone is registered above with the other instance handlers

// ============================================================
// IPC Handlers — Mods Management (per-instance, real downloads)
// ============================================================

import { createWriteStream, unlinkSync, readdirSync } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const INSTANCES_DIR = join(app.getPath('userData'), 'instances')
const MODRINTH_UA = 'loom-launcher/1.0.0'

function getInstanceModsPath(instanceId: string): string {
  return join(INSTANCES_DIR, instanceId, 'mods.json')
}

function getInstanceModsDir(instanceId: string): string {
  const dir = join(INSTANCES_DIR, instanceId, 'mods')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getInstanceResourcePacksDir(instanceId: string): string {
  const dir = join(INSTANCES_DIR, instanceId, 'resourcepacks')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function readInstanceMods(instanceId: string): any[] {
  // Read tracked mods from mods.json
  let tracked: any[] = []
  try {
    const modsPath = getInstanceModsPath(instanceId)
    if (existsSync(modsPath)) {
      tracked = JSON.parse(readFileSync(modsPath, 'utf-8'))
    }
  } catch { /* ignore */ }

  // Scan actual mods directory for .jar files
  try {
    const modsDir = join(INSTANCES_DIR, instanceId, 'mods')
    if (existsSync(modsDir)) {
      const trackedFiles = new Set(tracked.map((m: any) => m.fileName))
      const jarFiles = readdirSync(modsDir).filter(f => f.endsWith('.jar'))
      for (const jar of jarFiles) {
        if (!trackedFiles.has(jar)) {
          // Discovered mod not in mods.json — add it
          const name = jar.replace(/\.jar$/, '').replace(/[-_]\d+\..*$/, '').replace(/[-_]/g, ' ')
          tracked.push({
            id: `local-${jar}`,
            name,
            description: 'Manually added mod',
            version: '',
            slug: jar,
            fileName: jar,
            projectId: null,
            installedAt: Date.now(),
            manuallyAdded: true,
          })
        }
      }
    }
  } catch { /* ignore */ }

  return tracked
}

function writeInstanceMods(instanceId: string, mods: any[]): void {
  const modsPath = getInstanceModsPath(instanceId)
  const dir = join(INSTANCES_DIR, instanceId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(modsPath, JSON.stringify(mods, null, 2), 'utf-8')
}

// Download a file from URL to disk
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await net.fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(destPath, buffer)
}

// Get the best version of a mod for a specific game version + loader
async function getCompatibleVersion(
  projectId: string,
  gameVersion: string,
  loader: string
): Promise<any | null> {
  try {
    // Try with loader filter first (for mods)
    if (loader && loader.toLowerCase() !== 'vanilla') {
      const url = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=["${gameVersion}"]&loaders=["${loader.toLowerCase()}"]`
      const response = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
      if (response.ok) {
        const versions = await response.json()
        if (versions.length > 0) return versions[0]
      }
    }
    // Fallback: try without loader filter (for resource packs, vanilla, etc.)
    const url2 = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=["${gameVersion}"]`
    const response2 = await net.fetch(url2, { headers: { 'User-Agent': MODRINTH_UA } })
    if (!response2.ok) return null
    const versions2 = await response2.json()
    return versions2.length > 0 ? versions2[0] : null
  } catch {
    return null
  }
}

// Get project details (for in-app view)
ipcMain.handle('mods:getProject', async (_event, slugOrId: string) => {
  try {
    const url = `https://api.modrinth.com/v2/project/${slugOrId}`
    const response = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
})

// Check if a mod has a version compatible with a given game version
ipcMain.handle('mods:checkVersion', async (_event, projectId: string, gameVersion: string, loader: string) => {
  const ver = await getCompatibleVersion(projectId, gameVersion, loader)
  return ver ? { available: true, versionNumber: ver.version_number } : { available: false }
})

ipcMain.handle('mods:getInstalled', (_event, instanceId: string) => {
  return readInstanceMods(instanceId)
})

// Install mod: find compatible version, download .jar, resolve dependencies
ipcMain.handle('mods:install', async (_event, instanceId: string, mod: any, gameVersion: string, loader: string) => {
  const modsDir = getInstanceModsDir(instanceId)

  // Find compatible version
  const version = await getCompatibleVersion(mod.slug || mod.id, gameVersion, loader)
  if (!version || !version.files || version.files.length === 0) {
    return { error: 'No compatible version found' }
  }

  const primaryFile = version.files.find((f: any) => f.primary) || version.files[0]
  const fileName = primaryFile.filename
  const destPath = join(modsDir, fileName)

  // Download the file
  try {
    await downloadFile(primaryFile.url, destPath)
  } catch (err: any) {
    return { error: `Download failed: ${err.message}` }
  }

  // Save to mods.json
  const mods = readInstanceMods(instanceId)
  if (!mods.find((m: any) => m.id === mod.id)) {
    mods.push({
      id: mod.id || mod.slug,
      name: mod.name || mod.title,
      description: mod.description || '',
      version: version.version_number,
      icon_url: mod.icon_url,
      slug: mod.slug,
      fileName,
      projectId: version.project_id,
      installedAt: Date.now(),
    })
    writeInstanceMods(instanceId, mods)
  }

  // Resolve dependencies
  const deps = version.dependencies || []
  const requiredDeps = deps.filter((d: any) => d.dependency_type === 'required')

  for (const dep of requiredDeps) {
    const depProjectId = dep.project_id
    if (!depProjectId) continue

    // Check if already installed
    if (mods.find((m: any) => m.projectId === depProjectId || m.id === depProjectId)) continue

    try {
      // Get dep project info
      const depInfoRes = await net.fetch(`https://api.modrinth.com/v2/project/${depProjectId}`, {
        headers: { 'User-Agent': MODRINTH_UA }
      })
      if (!depInfoRes.ok) continue
      const depInfo = await depInfoRes.json()

      // Find compatible dep version
      const depVersion = dep.version_id
        ? await (async () => {
            const r = await net.fetch(`https://api.modrinth.com/v2/version/${dep.version_id}`, {
              headers: { 'User-Agent': MODRINTH_UA }
            })
            return r.ok ? r.json() : null
          })()
        : await getCompatibleVersion(depProjectId, gameVersion, loader)

      if (!depVersion || !depVersion.files?.length) continue

      const depFile = depVersion.files.find((f: any) => f.primary) || depVersion.files[0]
      const depDest = join(modsDir, depFile.filename)
      await downloadFile(depFile.url, depDest)

      const updatedMods = readInstanceMods(instanceId)
      updatedMods.push({
        id: depInfo.slug,
        name: depInfo.title,
        description: depInfo.description || '',
        version: depVersion.version_number,
        icon_url: depInfo.icon_url,
        slug: depInfo.slug,
        fileName: depFile.filename,
        projectId: depProjectId,
        isDependency: true,
        installedAt: Date.now(),
      })
      writeInstanceMods(instanceId, updatedMods)
    } catch {
      // Skip failed deps silently
    }
  }

  return { mods: readInstanceMods(instanceId) }
})

// Uninstall: remove .jar file and entry from mods.json
ipcMain.handle('mods:uninstall', (_event, instanceId: string, modId: string) => {
  let mods = readInstanceMods(instanceId)
  const mod = mods.find((m: any) => m.id === modId)

  // Delete the .jar file
  if (mod?.fileName) {
    const filePath = join(getInstanceModsDir(instanceId), mod.fileName)
    try { if (existsSync(filePath)) unlinkSync(filePath) } catch { /* ignore */ }
  }

  mods = mods.filter((m: any) => m.id !== modId)
  writeInstanceMods(instanceId, mods)
  return mods
})

ipcMain.handle('mods:toggle', () => null)

// Install performance mods on demand (also called automatically before launch)
import { installPerformanceMods } from './performance-mods'
ipcMain.handle('mods:installEssentials', async (_event, instanceId: string, gameVersion: string, loader: string) => {
  try {
    const perfEnabled = !!storeGet('perf_modpack')
    await installPerformanceMods(instanceId, gameVersion, loader, perfEnabled)
    return { success: true, mods: readInstanceMods(instanceId) }
  } catch (err: any) {
    return { error: err.message }
  }
})

// ============================================================
// IPC Handlers — Resource Pack Search + Install
// ============================================================

ipcMain.handle('resourcepacks:search', async (_event, query: string, page: number) => {
  try {
    const offset = page * 20
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=20&offset=${offset}&facets=[["project_type:resourcepack"]]`
    const response = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
    if (!response.ok) return { hits: [], total_hits: 0 }
    return await response.json()
  } catch {
    return { hits: [], total_hits: 0 }
  }
})

ipcMain.handle('resourcepacks:install', async (_event, instanceId: string, pack: any, gameVersion: string) => {
  const rpDir = getInstanceResourcePacksDir(instanceId)
  const projectId = pack.slug || pack.id

  // Resource packs are version-agnostic — get the latest version without filtering
  let version: any = null
  try {
    // Try with game version first
    const url1 = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=["${gameVersion}"]`
    const res1 = await net.fetch(url1, { headers: { 'User-Agent': MODRINTH_UA } })
    if (res1.ok) {
      const versions1 = await res1.json()
      if (versions1.length > 0) version = versions1[0]
    }
    // If no version-specific match, get ANY latest version
    if (!version) {
      const url2 = `https://api.modrinth.com/v2/project/${projectId}/version`
      const res2 = await net.fetch(url2, { headers: { 'User-Agent': MODRINTH_UA } })
      if (res2.ok) {
        const versions2 = await res2.json()
        if (versions2.length > 0) version = versions2[0]
      }
    }
  } catch {
    return { error: 'Failed to fetch resource pack versions' }
  }

  if (!version || !version.files?.length) return { error: 'No downloadable version found' }
  const file = version.files.find((f: any) => f.primary) || version.files[0]
  try {
    await downloadFile(file.url, join(rpDir, file.filename))
    return { success: true }
  } catch (err: any) {
    return { error: err.message }
  }
})

// ============================================================
// IPC Handlers — Open External URL
// ============================================================

ipcMain.handle('shell:openExternal', (_event, url: string) => {
  shell.openExternal(url)
})

// ============================================================
// System Tray
// ============================================================

function createTray(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Loom', enabled: false },
    { type: 'separator' },
    { label: 'Show', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setToolTip('Loom Launcher')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
}

// ============================================================
// App Lifecycle
// ============================================================

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // Restore saved login session before creating window
    await restoreSession().catch(err => console.error('[Auth] Session restore failed:', err))
    // Migrate any instances without a profile owner to the active account
    const activeUuid = getActiveUuid()
    if (activeUuid) {
      const migrated = migrateOrphanInstances(activeUuid)
      if (migrated > 0) console.log(`[Instances] Migrated ${migrated} orphan instance(s) to profile ${activeUuid}`)
    }
    createWindow()
    createTray()
    // Preload essentials in background — don't block window
    preloadEssentials().catch(err => console.error('[Preload] Failed:', err))
    // Check for updates after a short delay
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => console.warn('[Updater] Check failed:', err))
    }, 5000)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ============================================================
// IPC Handlers — Discord Rich Presence
// ============================================================

ipcMain.handle('discord:connect', async (_event, appId: string) => {
  storeSet('discord_app_id', appId)
  return connectDiscord(appId)
})

ipcMain.handle('discord:disconnect', () => {
  disconnectDiscord()
  return true
})

ipcMain.handle('discord:status', () => {
  return {
    connected: isDiscordConnected(),
    enabled: isDiscordEnabled(),
    appId: getDiscordAppId(),
  }
})

ipcMain.handle('discord:getConfig', () => {
  return {
    appId: (storeGet('discord_app_id') as string) || '',
  }
})

// Auto-connect Discord if previously configured
app.whenReady().then(async () => {
  const savedAppId = storeGet('discord_app_id') as string
  if (savedAppId) {
    connectDiscord(savedAppId).catch(err => console.warn('[Discord] Auto-connect failed:', err))
  }
})

app.on('before-quit', () => {
  destroyDiscord()
})

// ============================================================
// IPC Handlers — Friends
// ============================================================

import { getAllFriends, addFriend, removeFriend, updateFriendNote } from './friends'

ipcMain.handle('friends:getAll', () => getAllFriends())
ipcMain.handle('friends:add', (_event, username: string) => addFriend(username))
ipcMain.handle('friends:remove', (_event, uuid: string) => removeFriend(uuid))
ipcMain.handle('friends:updateNote', (_event, uuid: string, note: string) => updateFriendNote(uuid, note))

// ============================================================
// IPC Handlers — Gemini AI Chatbot
// ============================================================

const GEMINI_SYSTEM_PROMPT = `You are Loomie, a friendly and knowledgeable Minecraft companion built into the Loom Launcher (powered by Gemini). You know everything about Minecraft — every recipe, every mob, every mechanic — and you share that knowledge with warmth and enthusiasm.

## Your Personality
- Your name is Loomie. If someone asks, say "Hey! I'm Loomie, your Minecraft companion in the Loom Launcher."
- You're warm, encouraging, and genuinely excited about Minecraft. You love helping players learn and improve.
- You're precise when it matters — you give exact numbers, exact recipes, exact stats — but you deliver them conversationally, not robotically.
- You're concise by default but happy to go deep when someone wants details.
- You use light, natural language. You might say "Nice question!" or "Oh, that's a classic." You're a friend who happens to know everything about Minecraft.
- You can use emojis sparingly when they feel natural (✨ 🎯 ⚔️) but don't overdo it.
- You ONLY discuss Minecraft-related topics. If someone asks about something unrelated, gently redirect: "I'm all about Minecraft! Got a crafting question or need some build inspiration?"

## Knowledge — You are an expert in ALL of these:

### Crafting & Items
- Every crafting recipe (shaped, shapeless, smithing, stonecutting)
- Smelting, blasting, smoking, campfire cooking
- All item stats: durability, stack size, damage, tool tiers
- Smithing table upgrades, armor trims, netherite conversion
- Banner patterns, dye combinations, firework crafting

### Combat & PvP
- Every mob's exact HP, damage, drops, and spawn conditions
- Boss strategies: Ender Dragon, Wither, Elder Guardian, Warden
- Exact weapon damage values, critical hits, enchantment bonuses
- Armor protection, toughness, knockback resistance
- Shield mechanics, invulnerability frames, attack cooldowns
- **Bedwars**: strategies, rush techniques, bridging methods (speed bridge, ninja bridge, god bridge), resource management, team coordination, bed defense layouts, trap usage
- **PvP techniques**: W-tapping, S-tapping, strafing, block-hitting (1.8), crit chains, rod combos, bow spam
- **Hypixel**: game modes, stats, leveling, guilds, housing
- Raid mechanics, wave composition, Hero of the Village

### Enchantments
- Every enchantment, max level, applicable items, exact effects per level
- Compatibility and mutual exclusions
- Optimal enchantment combos for every gear piece
- Anvil mechanics: XP costs, prior work penalty, "Too Expensive" at 40 levels
- Enchanting table setup: 15 bookshelves, level 30 enchanting layout

### Brewing & Potions
- Every potion recipe and brewing chain
- Exact durations and effect strengths per tier
- Splash, lingering, tipped arrows
- Suspicious stew effects by flower type

### Redstone Engineering
- Every component's behavior, delay, and signal strength
- Comparator modes, observer chains, hopper clocks
- Classic circuits: T-flip-flops, pulse extenders, BUD switches
- Piston mechanics, quasi-connectivity (Java), 0-tick pulses
- Flying machines, item sorters, auto-farms
- Java vs Bedrock redstone differences

### World Generation & Biomes
- All biomes, features, exclusive mobs, structures
- Structure generation: villages, temples, bastions, strongholds, ancient cities, trial chambers
- Ore distribution by Y-level (1.18+ changes)
- Nether, End, dimension travel mechanics
- Seeds, coordinates, chunk math

### Farming & Automation
- Crop mechanics: growth, tick rates, hydration, light
- Every auto-farm design: iron, gold, mob, crop, tree, wool, honey, sculk XP
- Villager breeding, trading halls, curing for discounts
- Animal breeding, food, growth timers
- XP farms: enderman, guardian, blaze, pigman, sculk

### Technical Mechanics
- Tick rate, random tick speed, chunk loading, spawn chunks
- Simulation distance vs render distance
- Entity cramming, mob cap, despawn mechanics
- Light levels (block light vs sky light)
- Explosion mechanics, TNT, blast resistance
- Falling blocks, sand duping, chunk manipulation

### Building & Design
- Block palettes for different aesthetics (medieval, modern, fantasy, rustic)
- Interior design tips, furniture builds, landscaping
- Gradient techniques, depth and texture in walls
- Scale and proportion guidelines
- Popular building styles and how to achieve them

### Modding & Modpacks
- Mod loaders: Fabric, Forge, NeoForge, Quilt — differences and compatibility
- Performance mods: Sodium, Lithium, Iris, FerriteCore, ModernFix
- Popular content mods by category (tech, magic, exploration, QoL)
- Shader recommendations and compatibility
- Modpack suggestions for different playstyles
- Datapack creation and resource pack structure

### Server Administration
- server.properties and their effects
- Performance: Paper, Purpur, view-distance, mob caps
- Plugin recommendations by server type
- Security, whitelist, permissions
- Common server errors and fixes

### Crash Log Analysis
- Java crash log structure: stack traces, mod conflicts, memory errors
- Common causes: OutOfMemoryError, mod conflicts, driver issues
- Reading hs_err_pid files and latest.log
- JVM argument recommendations

### Java vs Bedrock Edition
- Clarify when mechanics differ between editions
- Combat differences, redstone differences, world gen differences
- Feature parity status
- Marketplace vs mods ecosystem

### Speedrunning & Advanced Play
- Current speedrun strategies and world records
- Nether portal math and navigation
- Eye of Ender triangulation and stronghold patterns
- Advanced movement: MLG water, boat clutch, pearl stasis

### Minecraft History & Updates
- Every major update and what it added (from Alpha to current)
- Upcoming features in snapshots/previews
- Removed features and legacy mechanics
- Version differences that affect gameplay

## Response Format
1. Use **bold** for item names, mob names, and key terms
2. Use \`code\` for commands, coordinates, and file paths
3. Use numbered lists for step-by-step instructions
4. Use tables when comparing items, enchantments, or stats
5. Use code blocks for command syntax, JSON, or configs
6. Keep answers focused — be helpful, not paddy
7. Describe crafting grid layouts clearly
8. Specify the version when mechanics differ
9. If asked a non-Minecraft question, warmly redirect to Minecraft topics

## Launcher Actions
You can perform actions in the Loom Launcher. When someone asks you to do something (skip a song, download a mod, create an instance, etc.), use the available tools. Always confirm what you did afterward.`

ipcMain.handle('gemini:chat', async (_event, apiKey: string, messages: Array<{ role: string; parts: Array<{ text: string }> }>) => {
  if (!apiKey) return { error: 'No API key configured. Go to Settings → Connected Apps → Gemini to add one.' }

  try {
    const response = await net.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: GEMINI_SYSTEM_PROMPT }],
          },
          contents: messages,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096,
          },
        }),
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      console.error('[Gemini] API error:', response.status, errText)
      if (response.status === 400) return { error: 'Invalid API key. Check Settings → Connected Apps → Gemini.' }
      if (response.status === 429) return { error: 'Rate limit reached. Wait a moment and try again.' }
      return { error: `API error (${response.status}): ${errText.slice(0, 200)}` }
    }

    const data = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return { error: 'No response from Gemini. Try again.' }

    return { text }
  } catch (err: any) {
    console.error('[Gemini] Fetch error:', err)
    return { error: err.message || 'Failed to reach Gemini API' }
  }
})

// ============================================================
// IPC Handlers — Chat History
// ============================================================

ipcMain.handle('chat:create', () => createChat())
ipcMain.handle('chat:save', (_e, id: string, messages: any[], title?: string) => saveChat(id, messages, title))
ipcMain.handle('chat:load', (_e, id: string) => loadChat(id))
ipcMain.handle('chat:list', () => listChats())
ipcMain.handle('chat:delete', (_e, id: string) => deleteChat(id))
ipcMain.handle('chat:rename', (_e, id: string, title: string) => renameChat(id, title))

// ============================================================
// IPC Handlers — Screen Capture (for screen awareness)
// ============================================================

ipcMain.handle('screen:capture', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) return { error: 'No window' }
    const image = await win.webContents.capturePage()
    const base64 = image.toPNG().toString('base64')
    return { image: base64 }
  } catch (err: any) {
    return { error: err.message }
  }
})

// Gemini multimodal chat (with optional screenshot)
ipcMain.handle('gemini:chat-vision', async (_event, apiKey: string, textPrompt: string, imageBase64: string, history: Array<{ role: string; parts: Array<any> }>) => {
  if (!apiKey) return { error: 'No API key configured.' }

  try {
    // Build contents: history + new multimodal message
    const contents = [
      ...history,
      {
        role: 'user',
        parts: [
          { text: textPrompt },
          { inlineData: { mimeType: 'image/png', data: imageBase64 } },
        ],
      },
    ]

    const response = await net.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT + '\n\nThe user has shared a screenshot of the Loom Launcher. Describe what you see and answer their question about it. The launcher has pages: Library (game instances), Browse (mods), Players (lookup), Settings, and Gemini AI (this chat).' }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        }),
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      return { error: `API error (${response.status}): ${errText.slice(0, 200)}` }
    }

    const data = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    return text ? { text } : { error: 'No response from Gemini.' }
  } catch (err: any) {
    return { error: err.message || 'Failed to reach Gemini API' }
  }
})

// Gemini audio chat — sends recorded audio for transcription + response
ipcMain.handle('gemini:chat-audio', async (_event, apiKey: string, audioBase64: string, mimeType: string, history: Array<{ role: string; parts: Array<any> }>) => {
  if (!apiKey) return { error: 'No API key configured.' }

  try {
    const contents = [
      ...history,
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: mimeType || 'audio/webm', data: audioBase64 } },
          { text: 'The user sent a voice message. Transcribe what they said and respond to it. You are Loomie, the Minecraft AI companion. Keep your response concise (1-3 sentences) since it will be read aloud.' },
        ],
      },
    ]

    const response = await net.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT + '\n\nIMPORTANT: The user is speaking via voice. First, transcribe exactly what they said in quotes. Then respond concisely (1-3 sentences). Format: "[transcription]"\n\nYour response here.' }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
        }),
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      console.error('[Loomie] Audio API error:', response.status, errText.slice(0, 200))
      return { error: `API error (${response.status})` }
    }

    const data = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    return text ? { text } : { error: 'No response from Loomie.' }
  } catch (err: any) {
    console.error('[Loomie] Audio fetch error:', err)
    return { error: err.message || 'Failed to reach Loomie' }
  }
})

// ============================================================
// Gemini Function Calling — Loomie AI Tools
// ============================================================

const LOOMIE_TOOLS = [{
  functionDeclarations: [
    {
      name: 'search_mods',
      description: 'Search for Minecraft mods on Modrinth',
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Search query' } }, required: ['query'] }
    },
    {
      name: 'install_mod',
      description: 'Install a mod to a Minecraft instance. Requires instanceId, projectId, gameVersion, and loader.',
      parameters: { type: 'OBJECT', properties: {
        instanceId: { type: 'STRING' },
        projectId: { type: 'STRING' },
        gameVersion: { type: 'STRING' },
        loader: { type: 'STRING' }
      }, required: ['instanceId', 'projectId', 'gameVersion', 'loader'] }
    },
    {
      name: 'get_instances',
      description: 'Get all Minecraft instances/profiles the user has created',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'get_installed_mods',
      description: 'Get list of mods installed in a specific instance',
      parameters: { type: 'OBJECT', properties: { instanceId: { type: 'STRING' } }, required: ['instanceId'] }
    },
    {
      name: 'create_instance',
      description: 'Create a new Minecraft instance',
      parameters: { type: 'OBJECT', properties: {
        name: { type: 'STRING' },
        version: { type: 'STRING', description: 'Minecraft version like 1.21.1' },
        loader: { type: 'STRING', description: 'Vanilla, Fabric, or Forge' }
      }, required: ['name', 'version', 'loader'] }
    },
    {
      name: 'launch_instance',
      description: 'Launch/start a Minecraft instance',
      parameters: { type: 'OBJECT', properties: { instanceId: { type: 'STRING' } }, required: ['instanceId'] }
    },
    {
      name: 'spotify_play',
      description: 'Resume Spotify playback',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'spotify_pause',
      description: 'Pause Spotify playback',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'spotify_next',
      description: 'Skip to next Spotify track',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'spotify_previous',
      description: 'Go to previous Spotify track',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'search_resource_packs',
      description: 'Search for Minecraft resource/texture packs on Modrinth',
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] }
    },
    {
      name: 'get_mod_details',
      description: 'Get detailed info about a specific mod by slug or ID',
      parameters: { type: 'OBJECT', properties: { slugOrId: { type: 'STRING' } }, required: ['slugOrId'] }
    }
  ]
}]

// Execute a Loomie tool function using existing launcher logic
async function executeLoomieTool(name: string, args: Record<string, any>): Promise<any> {
  try {
    switch (name) {
      case 'search_mods': {
        const query = args.query || ''
        const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=20&offset=0&facets=[["project_type:mod"]]`
        const response = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
        if (!response.ok) return { hits: [], total_hits: 0 }
        return await response.json()
      }
      case 'install_mod': {
        const { instanceId, projectId, gameVersion, loader } = args
        const version = await getCompatibleVersion(projectId, gameVersion, loader)
        if (!version || !version.files || version.files.length === 0) {
          return { error: 'No compatible version found' }
        }
        const modsDir = getInstanceModsDir(instanceId)
        const primaryFile = version.files.find((f: any) => f.primary) || version.files[0]
        const fileName = primaryFile.filename
        const destPath = join(modsDir, fileName)
        await downloadFile(primaryFile.url, destPath)
        const mods = readInstanceMods(instanceId)
        if (!mods.find((m: any) => m.id === projectId)) {
          mods.push({
            id: projectId,
            name: projectId,
            description: '',
            version: version.version_number,
            slug: projectId,
            fileName,
            projectId: version.project_id,
            installedAt: Date.now(),
          })
          writeInstanceMods(instanceId, mods)
        }
        return { success: true, version: version.version_number, fileName }
      }
      case 'get_instances': {
        return getAllInstances()
      }
      case 'get_installed_mods': {
        return readInstanceMods(args.instanceId)
      }
      case 'create_instance': {
        return createInstance(args.name, args.version, args.loader)
      }
      case 'launch_instance': {
        return launchInstance(args.instanceId)
      }
      case 'spotify_play': {
        const token = await getSpotifyToken()
        if (!token) return { error: 'Spotify not connected' }
        await net.fetch('https://api.spotify.com/v1/me/player/play', {
          method: 'PUT', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {})
        return { success: true }
      }
      case 'spotify_pause': {
        const token = await getSpotifyToken()
        if (!token) return { error: 'Spotify not connected' }
        await net.fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {})
        return { success: true }
      }
      case 'spotify_next': {
        const token = await getSpotifyToken()
        if (!token) return { error: 'Spotify not connected' }
        await net.fetch('https://api.spotify.com/v1/me/player/next', {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {})
        return { success: true }
      }
      case 'spotify_previous': {
        const token = await getSpotifyToken()
        if (!token) return { error: 'Spotify not connected' }
        await net.fetch('https://api.spotify.com/v1/me/player/previous', {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {})
        return { success: true }
      }
      case 'search_resource_packs': {
        const query = args.query || ''
        const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=20&offset=0&facets=[["project_type:resourcepack"]]`
        const response = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
        if (!response.ok) return { hits: [], total_hits: 0 }
        return await response.json()
      }
      case 'get_mod_details': {
        const url = `https://api.modrinth.com/v2/project/${args.slugOrId}`
        const response = await net.fetch(url, { headers: { 'User-Agent': MODRINTH_UA } })
        if (!response.ok) return null
        return await response.json()
      }
      default:
        return { error: `Unknown function: ${name}` }
    }
  } catch (err: any) {
    return { error: err.message || `Failed to execute ${name}` }
  }
}

ipcMain.handle('gemini:chat-with-tools', async (_event, apiKey: string, messages: Array<{ role: string; parts: Array<any> }>, currentContext?: any) => {
  if (!apiKey) return { error: 'No API key configured. Go to Settings → Connected Apps → Gemini to add one.' }

  try {
    let systemText = GEMINI_SYSTEM_PROMPT
    if (currentContext) {
      systemText += `\n\nCurrent launcher context: ${JSON.stringify(currentContext)}`
    }

    const conversationContents = [...messages]
    const actionsPerformed: string[] = []
    const MAX_ITERATIONS = 5

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await net.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemText }] },
            contents: conversationContents,
            tools: LOOMIE_TOOLS,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 4096,
            },
          }),
        }
      )

      if (!response.ok) {
        const errText = await response.text()
        console.error('[Gemini Tools] API error:', response.status, errText)
        if (response.status === 400) return { error: 'Invalid API key. Check Settings → Connected Apps → Gemini.' }
        if (response.status === 429) return { error: 'Rate limit reached. Wait a moment and try again.' }
        return { error: `API error (${response.status}): ${errText.slice(0, 200)}` }
      }

      const data = await response.json()
      const candidate = data?.candidates?.[0]
      if (!candidate?.content?.parts?.length) {
        return { error: 'No response from Gemini. Try again.' }
      }

      const parts = candidate.content.parts
      const functionCallPart = parts.find((p: any) => p.functionCall)

      if (functionCallPart) {
        const { name, args } = functionCallPart.functionCall
        console.log(`[Gemini Tools] Calling function: ${name}`, args)

        // Add the model's function call to conversation
        conversationContents.push({
          role: 'model',
          parts: [{ functionCall: { name, args } }],
        })

        // Execute the function
        const result = await executeLoomieTool(name, args || {})
        actionsPerformed.push(name)

        // Add function result to conversation
        conversationContents.push({
          role: 'user',
          parts: [{ functionResponse: { name, response: { result } } }],
        })

        // Continue loop — Gemini may call another function or produce text
        continue
      }

      // No function call — extract text response
      const textPart = parts.find((p: any) => p.text)
      const text = textPart?.text
      if (!text) return { error: 'No response from Gemini. Try again.' }

      return {
        text,
        actionsPerformed: actionsPerformed.length > 0 ? actionsPerformed : undefined,
      }
    }

    // If we exhausted iterations, return whatever we have
    return {
      text: 'I performed several actions but reached the maximum number of steps. Please check the results.',
      actionsPerformed: actionsPerformed.length > 0 ? actionsPerformed : undefined,
    }
  } catch (err: any) {
    console.error('[Gemini Tools] Fetch error:', err)
    return { error: err.message || 'Failed to reach Gemini API' }
  }
})
