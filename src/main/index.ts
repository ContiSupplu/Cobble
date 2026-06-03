import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, net, session, safeStorage, protocol } from 'electron'
import { join, resolve } from 'path'
// Spotify auth is handled inline below
import { setLauncherWindow, launchInstance, killInstance, getLaunchStatus, preloadEssentials, getGameLogBuffer, predownloadForInstance, prewarmInstanceCache } from './launcher'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'fs'
import { getAllInstances, createInstance, deleteInstance, updateInstance, cloneInstance, openInstanceFolder, listInstanceDir, deleteInstanceFile, renameInstanceFile, openInstanceFile, copyFilesToInstance, getInstancePath, getTrashedInstances, recoverInstance, permanentlyDeleteInstance, migrateOrphanInstances, invalidateLaunchReady } from './instances'
import { microsoftLogin, getCachedAccount, clearCachedAccount, restoreSession, getAllAccounts, getActiveUuid, switchAccount, removeAccount, updateDisplayName, updatePrivacyPrefs } from './auth'
import { getAllRegions, loadProxyCredentials } from './proxy-config'
import { connectDiscord, disconnectDiscord, isDiscordConnected, isDiscordEnabled, getDiscordAppId, destroyDiscord } from './discord'
import { createChat, saveChat, loadChat, listChats, deleteChat, renameChat } from './chat-store'
import { setStateProvider, setLoomieHandler, setSpotifyCommandHandler, setTwitchChatHandler, setMediaSearchHandler, setMediaSelectHandler, setBrowserVideoHandler, DynamicIslandState, sendTwitchChat, sendMediaPlay, sendMediaStop, sendTwitchLive } from './dynamic-island-server'
import { autoUpdater } from 'electron-updater'
import { addDefenderExclusion, setHighPerformancePowerPlan, restoreDefaultPowerPlan, applyNetworkOptimizations, restoreNetworkSettings } from './system-optimizations'
import { pingMinecraftServer } from './server-ping'
import { initTwitch, startTwitchAuth, clearTwitchAuth, getTwitchToken, getFollowedStreams, isStreamerLive, startPolling as startTwitchPolling, stopPolling as stopTwitchPolling, connectChat, disconnectChat, sendChatMessage, getConnectedChannel, twitchEvents } from './twitch'
import { downloadFFmpeg, getFFmpegPath, startRecording, stopRecording, startReplayBuffer, saveReplayBuffer, stopReplayBuffer, getRecordingStatus, getGalleryItems, saveGalleryMetadata, recordingEvents } from './recording'
import { trimVideo, concatenateVideos, addTextOverlay, changeSpeed, generateThumbnail } from './video-editor'
import { detectLaunchers, getImportableData, importFromLauncher } from './migration'
import { shareToDiscord, uploadToYouTube, getSocialConfig, addDiscordWebhook, removeDiscordWebhook, setYouTubeTokenPath } from './social'
import { storeAndLink, linkExisting, removeInstanceRefs, migrateExistingMods, getDiskSavings, getStoreStats } from './mod-store'
import { getSyncConfig, saveSyncConfig, createSyncGroup, deleteSyncGroup, addInstanceToGroup, removeInstanceFromGroup, getSyncableItems, syncToInstance, syncFromInstance, getInstanceSyncGroups, getSyncGroupStats } from './file-sync'

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

// Reset crash loop counter on fresh app start — previous crashes
// from old bugs (e.g. mixin errors) shouldn't persist across restarts
storeSet('loom_shield_crash_count', 0)

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
      sandbox: true,
      webSecurity: true,
      webviewTag: false
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

  // Set a secure Content Security Policy — ONLY for our own renderer pages
  // External windows (like Microsoft auth) need their own resources unrestricted
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }

    // Only apply CSP to our own pages (localhost dev server or file:// in production)
    const url = details.url || ''
    const isOurPage = url.startsWith('http://localhost') || url.startsWith('file://') || url.startsWith('media://')

    if (isOurPage) {
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https: http:",
        "media-src 'self' blob: file: media: https: http:",
        "connect-src 'self' https://api.spotify.com https://accounts.spotify.com https://api.modrinth.com https://generativelanguage.googleapis.com https://api.twitch.tv https://id.twitch.tv https://gql.twitch.tv wss://irc-ws.chat.twitch.tv https://login.live.com https://login.microsoftonline.com https://user.auth.xboxlive.com https://xsts.auth.xboxlive.com http://auth.xboxlive.com https://api.minecraftservices.com https://launchermeta.mojang.com https://piston-meta.mojang.com https://piston-data.mojang.com https://resources.download.minecraft.net https://libraries.minecraft.net https://meta.fabricmc.net https://maven.fabricmc.net https://lrclib.net https://www.googleapis.com https://cdn.modrinth.com https://github.com https://raw.githubusercontent.com https://crafatar.com ws://127.0.0.1:47521 https://pipedapi.kavin.rocks https://vid.puffyan.us https://invidious.fdn.fr https://inv.nadeko.net https://i.ytimg.com https://api.curseforge.com",
        "frame-src 'self' https://open.spotify.com"
      ].join('; ');
      headers['Content-Security-Policy'] = [csp];
    }
    // For external pages (login.live.com, etc.), don't inject any CSP — let them load normally

    callback({ responseHeaders: headers })
  })

  // Only grant permissions that are actually needed
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'notifications'];
    callback(allowed.includes(permission));
  })
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    const allowed = ['media', 'notifications'];
    return allowed.includes(permission);
  })
  mainWindow.webContents.session.setDevicePermissionHandler(() => {
    return false; // Deny all device access by default
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ── Intercept webview popups & downloads (Bedrock browser) ──
  // Track webview webContents so we can redirect popup URLs back into them
  const webviewContents = new Set<Electron.WebContents>()

  // Bedrock addon download queue — queued until user clicks "Install All" or launches Bedrock
  const bedrockDownloadQueue: Array<{ filename: string; path: string; type: string; size: number; addedAt: number }> = []
  const registeredSessions = new WeakSet<Electron.Session>()

  app.on('web-contents-created', (_event, contents) => {
    const type = contents.getType()

    if (type === 'webview') {
      webviewContents.add(contents)
      contents.on('destroyed', () => webviewContents.delete(contents))

      // Prevent popups from webview — navigate in-place instead
      contents.setWindowOpenHandler(({ url }) => {
        if (url && url !== 'about:blank') {
          contents.loadURL(url)
        }
        return { action: 'deny' }
      })
    }

    // Intercept downloads from ANY webContents (webview, popup, etc.)
    // Guard: only attach one will-download listener per session to avoid duplicates
    if (!registeredSessions.has(contents.session)) {
      registeredSessions.add(contents.session)
      contents.session.on('will-download', (_e, item) => {
      const filename = item.getFilename()
      const ext = (filename.split('.').pop() || '').toLowerCase()
      const bedrockExts = ['mcaddon', 'mcpack', 'mcworld']

      if (bedrockExts.includes(ext)) {
        // Save to Downloads folder — UWP apps can't access temp due to sandboxing
        const downloadsDir = app.getPath('downloads')
        const savePath = join(downloadsDir, filename)
        item.setSavePath(savePath)

        console.log(`[Bedrock] Downloading addon: ${filename} → ${savePath}`)

        item.on('done', async (_doneEvent, state) => {
          if (state === 'completed') {
            try {
              const fileSize = statSync(savePath).size
              console.log(`[Bedrock] Download complete (${(fileSize / 1024).toFixed(1)} KB): ${savePath}`)

              if (fileSize < 100) {
                console.log('[Bedrock] File too small, likely not a valid addon')
                return
              }

              // Add to queue instead of installing immediately
              const queueItem = { filename, path: savePath, type: ext, size: fileSize, addedAt: Date.now() }
              bedrockDownloadQueue.push(queueItem)
              console.log(`[Bedrock] Added to queue (${bedrockDownloadQueue.length} pending): ${filename}`)

              // Notify renderer about the queued download
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('bedrock:addon-queued', {
                  ...queueItem,
                  queueLength: bedrockDownloadQueue.length
                })
              }
            } catch (err: any) {
              console.log('[Bedrock] Download failed:', err.message)
            }
          } else {
            console.log(`[Bedrock] Download failed: ${state}`)
          }
        })
      }
    })
    } // end session guard
  })

  // ── Ad Blocker ──
  let adBlockEnabled = false
  const adBlockDomains = [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
    'adservice.google.com', 'pagead2.googlesyndication.com',
    'adsense', 'adnxs.com', 'adsrvr.org', 'adcolony.com',
    'facebook.com/tr', 'connect.facebook.net/en_US/fbevents',
    'amazon-adsystem.com', 'ads.yahoo.com',
    'ads.pubmatic.com', 'pubmatic.com', 'rubiconproject.com',
    'openx.net', 'casalemedia.com', 'indexexchange.com',
    'taboola.com', 'outbrain.com', 'revcontent.com',
    'mgid.com', 'zergnet.com', 'content.ad',
    'popads.net', 'popcash.net', 'propellerads.com',
    'exoclick.com', 'juicyads.com', 'trafficjunky.com',
    'ad.doubleclick.net', 'securepubads.g.doubleclick.net',
    'moatads.com', 'serving-sys.com', 'smaato.net',
    'criteo.com', 'criteo.net', 'crwdcntrl.net',
    'bluekai.com', 'scorecardresearch.com', 'quantserve.com',
    'demdex.net', 'krxd.net', 'rlcdn.com',
    'sharethis.com', 'addthis.com', 'outbrain.com',
    'tapad.com', 'bidswitch.net', 'mathtag.com',
    'adsymptotic.com', 'advertising.com', 'contextweb.com',
    'media.net', 'yieldmo.com', 'spotxchange.com',
    'conversantmedia.com', 'lijit.com', 'sovrn.com',
    'gumgum.com', 'sharethrough.com', 'nativo.com'
  ]

  function setupAdBlocker(): void {
    // Apply to default session (shared by all webviews)
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (!adBlockEnabled) {
        callback({ cancel: false })
        return
      }
      const url = details.url.toLowerCase()
      const blocked = adBlockDomains.some(domain => url.includes(domain))
      if (blocked) {
        callback({ cancel: true })
      } else {
        callback({ cancel: false })
      }
    })
  }

  setupAdBlocker()

  ipcMain.handle('bedrock:setAdBlock', (_e, enabled: boolean) => {
    adBlockEnabled = enabled
    console.log(`[Bedrock] Ad blocker ${enabled ? 'enabled' : 'disabled'}`)
    return enabled
  })

  ipcMain.handle('bedrock:getAdBlock', () => {
    return adBlockEnabled
  })

  // ── Bedrock download queue IPC handlers ──
  ipcMain.handle('bedrock:getQueue', () => {
    return bedrockDownloadQueue.map(q => ({ filename: q.filename, type: q.type, size: q.size, addedAt: q.addedAt }))
  })

  ipcMain.handle('bedrock:installQueue', async () => {
    if (bedrockDownloadQueue.length === 0) return { installed: 0, errors: [] }

    // Get Minecraft's data path
    const dataPath = getBedrockDataPath()
    if (!dataPath) {
      console.log('[Bedrock] Cannot install: no com.mojang path found')
      return { installed: 0, errors: ['Minecraft Bedrock data folder not found'] }
    }

    // Copy queue and clear immediately
    const itemsToInstall = [...bedrockDownloadQueue]
    bedrockDownloadQueue.length = 0

    console.log(`[Bedrock] Installing ${itemsToInstall.length} addons via direct extraction to: ${dataPath}`)
    const errors: string[] = []
    let installed = 0

    const { execSync } = require('child_process')
    const { readdirSync, rmSync, renameSync } = require('fs')
    const tmpBase = join(app.getPath('temp'), 'loom-bedrock-install')

    for (let i = 0; i < itemsToInstall.length; i++) {
      const item = itemsToInstall[i]
      try {
        // Check file exists
        if (!existsSync(item.path)) {
          const msg = `File not found: ${item.path}`
          console.log(`[Bedrock] ${msg}`)
          errors.push(`${item.filename}: ${msg}`)
          continue
        }

        console.log(`[Bedrock] Extracting (${i + 1}/${itemsToInstall.length}): ${item.filename}`)

        // Notify renderer of progress
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bedrock:queue-progress', {
            current: i + 1, total: itemsToInstall.length, filename: item.filename
          })
        }

        // Create a clean temp directory for extraction
        const tmpDir = join(tmpBase, `extract-${Date.now()}-${i}`)
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
        mkdirSync(tmpDir, { recursive: true })

        // PowerShell Expand-Archive only accepts .zip — copy with .zip extension
        const zipCopy = join(tmpDir, '_source.zip')
        copyFileSync(item.path, zipCopy)

        // Extract ZIP using PowerShell
        const extractDir = join(tmpDir, '_contents')
        mkdirSync(extractDir, { recursive: true })
        const escapedZip = zipCopy.replace(/'/g, "''")
        const escapedDest = extractDir.replace(/'/g, "''")
        try {
          execSync(
            `powershell -NoProfile -Command "Expand-Archive -Path '${escapedZip}' -DestinationPath '${escapedDest}' -Force"`,
            { timeout: 30000, windowsHide: true }
          )
        } catch (extractErr: any) {
          console.log(`[Bedrock] Extraction failed for ${item.filename}: ${extractErr.message}`)
          errors.push(`${item.filename}: Failed to extract archive`)
          try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
          continue
        }

        // Find and install packs from extracted contents
        const packsInstalled = installExtractedPacks(extractDir, dataPath, item.filename, errors)
        installed += packsInstalled

        // Clean up temp
        try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }

        console.log(`[Bedrock] ${item.filename}: installed ${packsInstalled} pack(s)`)
      } catch (e: any) {
        console.log(`[Bedrock] Install error for ${item.filename}: ${e.message}`)
        errors.push(`${item.filename}: ${e.message}`)
      }
    }

    console.log(`[Bedrock] Queue complete: ${installed} pack(s) installed, ${errors.length} errors`)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bedrock:queue-installed', { installed, errors })
    }

    return { installed, errors }
  })

  // Helper: recursively find and install packs from extracted directory
  function installExtractedPacks(dir: string, dataPath: string, sourceFile: string, errors: string[]): number {
    const { readdirSync, cpSync } = require('fs')
    let count = 0

    // Check if this directory itself is a pack (has manifest.json)
    const manifestPath = join(dir, 'manifest.json')
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        const packType = detectPackType(manifest)
        const packName = manifest.header?.name || sourceFile.replace(/\.[^.]+$/, '')
        const packUuid = manifest.header?.uuid || `pack-${Date.now()}`
        const targetFolder = packType === 'resources' ? 'resource_packs' : 'behavior_packs'
        const destDir = join(dataPath, targetFolder, packUuid)

        if (!existsSync(join(dataPath, targetFolder))) {
          mkdirSync(join(dataPath, targetFolder), { recursive: true })
        }

        // Copy the pack to Minecraft's folder
        cpSync(dir, destDir, { recursive: true, force: true })
        console.log(`[Bedrock] Installed ${packType} pack "${packName}" → ${targetFolder}/${packUuid}`)
        return 1
      } catch (e: any) {
        console.log(`[Bedrock] Failed to process manifest in ${dir}: ${e.message}`)
        errors.push(`${sourceFile}: ${e.message}`)
        return 0
      }
    }

    // Otherwise scan subdirectories for packs (mcaddon contains multiple packs)
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          count += installExtractedPacks(join(dir, entry.name), dataPath, sourceFile, errors)
        } else if (entry.name.endsWith('.mcpack')) {
          // Nested .mcpack inside .mcaddon — extract it too
          const nestedTmp = join(dir, `_nested_${Date.now()}`)
          mkdirSync(nestedTmp, { recursive: true })
          try {
            const escapedNested = join(dir, entry.name).replace(/'/g, "''")
            const escapedNestedTmp = nestedTmp.replace(/'/g, "''")
            require('child_process').execSync(
              `powershell -NoProfile -Command "Expand-Archive -Path '${escapedNested}' -DestinationPath '${escapedNestedTmp}' -Force"`,
              { timeout: 30000, windowsHide: true }
            )
            count += installExtractedPacks(nestedTmp, dataPath, sourceFile, errors)
          } catch (e: any) {
            console.log(`[Bedrock] Failed to extract nested pack ${entry.name}: ${e.message}`)
            errors.push(`${sourceFile}/${entry.name}: Failed to extract`)
          }
          try { require('fs').rmSync(nestedTmp, { recursive: true, force: true }) } catch { /* ignore */ }
        }
      }
    } catch (e: any) {
      console.log(`[Bedrock] Error scanning ${dir}: ${e.message}`)
    }

    return count
  }

  // Helper: determine pack type from manifest
  function detectPackType(manifest: any): 'resources' | 'data' {
    // Check modules array for type
    const modules = manifest.modules || []
    for (const mod of modules) {
      if (mod.type === 'resources' || mod.type === 'client_data') return 'resources'
      if (mod.type === 'data' || mod.type === 'script' || mod.type === 'javascript') return 'data'
    }
    // Default to resources if we can't determine
    return 'resources'
  }

  ipcMain.handle('bedrock:clearQueue', () => {
    const count = bedrockDownloadQueue.length
    bedrockDownloadQueue.length = 0
    console.log(`[Bedrock] Queue cleared (${count} items removed)`)
    return count
  })

  ipcMain.handle('bedrock:removeFromQueue', (_e, index: number) => {
    if (index >= 0 && index < bedrockDownloadQueue.length) {
      const removed = bedrockDownloadQueue.splice(index, 1)
      console.log(`[Bedrock] Removed from queue: ${removed[0]?.filename} (${bedrockDownloadQueue.length} remaining)`)
      return { removed: removed[0]?.filename, remaining: bedrockDownloadQueue.length }
    }
    return { removed: null, remaining: bedrockDownloadQueue.length }
  })
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
// IPC Handlers — World Backups
// ============================================================

import { createBackup, listBackups, restoreBackup, deleteBackup } from './backups'

ipcMain.handle('backup:create', async (_e, instanceId: string) => {
  return createBackup(instanceId)
})

ipcMain.handle('backup:list', (_e, instanceId: string) => {
  return listBackups(instanceId)
})

ipcMain.handle('backup:restore', async (_e, instanceId: string, backupId: string) => {
  return restoreBackup(instanceId, backupId)
})

ipcMain.handle('backup:delete', (_e, instanceId: string, backupId: string) => {
  return deleteBackup(instanceId, backupId)
})

// ============================================================
// IPC Handlers — Modpack Import
// ============================================================

import { importModpack } from './modpack-import'

ipcMain.handle('modpack:import', async (_e, filePath: string) => {
  return importModpack(filePath, (progress) => {
    mainWindow?.webContents.send('modpack:progress', progress)
  })
})

ipcMain.handle('modpack:browse', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Import Modpack',
    filters: [
      { name: 'Modpacks', extensions: ['zip', 'mrpack'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
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

ipcMain.handle('store:get', (_event, key: string) => {
  if (key === 'geminiApiKey') {
    const raw = storeGet(key) as string;
    if (raw && safeStorage.isEncryptionAvailable()) {
      try { return safeStorage.decryptString(Buffer.from(raw, 'base64')); } catch { return raw; }
    }
    return raw;
  }
  return storeGet(key);
})
ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
  if (key === 'geminiApiKey' && typeof value === 'string' && value) {
    storeSet(key, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : value);
    return;
  }
  storeSet(key, value);
})

// ============================================================
// IPC Handlers — Performance Optimizations
// ============================================================

ipcMain.handle('perf:applyDefenderExclusion', async () => {
  return addDefenderExclusion(true) // User explicitly triggered from Settings > Performance
})

ipcMain.handle('perf:setPowerPlan', () => {
  setHighPerformancePowerPlan(true) // User explicitly triggered from Settings > Performance
})

ipcMain.handle('perf:restorePowerPlan', () => {
  restoreDefaultPowerPlan()
})

ipcMain.handle('perf:applyNetworkOpt', async () => {
  return applyNetworkOptimizations(true) // User explicitly triggered from Settings > Performance
})

ipcMain.handle('perf:restoreNetwork', async () => {
  return restoreNetworkSettings()
})

// Reset the user's Defender exclusion preference (so the prompt appears again on next launch)
ipcMain.handle('defender:resetChoice', () => {
  storeSet('defender_exclusion_choice', undefined)
  console.log('[Defender] User choice reset — prompt will appear on next launch')
  return true
})

ipcMain.handle('net:pingServer', async (_e, host: string, port?: number) => {
  try {
    return await pingMinecraftServer(host, port ?? 25565)
  } catch (err: any) {
    return { error: err.message }
  }
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

// Change skin variant (classic ↔ slim) without uploading a new file
// Downloads the current skin texture and re-uploads with the new variant
ipcMain.handle('skins:changeVariant', async (_event, variant: 'classic' | 'slim') => {
  const account = getCachedAccount()
  if (!account) return { success: false, error: 'Not logged in' }
  try {
    // 1. Get the current skin URL from the profile
    const profileResp = await net.fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${account.accessToken}` }
    })
    if (!profileResp.ok) return { success: false, error: 'Failed to fetch profile' }
    const profileData = await profileResp.json() as { skins?: { url: string; variant: string; state: string }[] }
    const activeSkin = profileData.skins?.find((s: { state: string }) => s.state === 'ACTIVE')
    if (!activeSkin?.url) return { success: false, error: 'No active skin found' }

    // 2. Upload the same skin URL with the new variant
    const uploadResp = await net.fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ variant, url: activeSkin.url }),
    })
    if (!uploadResp.ok) {
      const text = await uploadResp.text()
      return { success: false, error: `Variant change failed: ${uploadResp.status} ${text}` }
    }
    console.log(`[Skins] Changed skin variant to ${variant}`)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Variant change failed' }
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

ipcMain.handle('skins:resolveBody', async (_event, uuid: string, height = 256, variant?: 'classic' | 'slim') => {
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

    // Detect slim from Mojang metadata if not explicitly provided
    const isSlim = variant === 'slim' || (!variant && decoded.textures?.SKIN?.metadata?.model === 'slim')

    const texResp = await net.fetch(skinTextureUrl)
    if (!texResp.ok) return null
    const texBuffer = Buffer.from(await texResp.arrayBuffer())
    const fullImage = nativeImage.createFromBuffer(texBuffer)
    const fullSize = fullImage.getSize()
    if (fullSize.width < 64 || fullSize.height < 32) return null
    const bitmap = fullImage.toBitmap()
    const stride = fullSize.width * 4

    // Slim arms are 3px wide, classic arms are 4px wide
    const armW = isSlim ? 3 : 4

    // Body layout: variable width based on arm model
    // Classic: 4+8+4 = 16px wide, Slim: 3+8+3 = 14px wide
    const bw = armW + 8 + armW, bh = 32
    const body = Buffer.alloc(bw * bh * 4)

    // Base layers
    blitSkinRegion(bitmap, stride, body, bw, 8, 8, 8, 8, armW, 0)        // Head
    blitSkinRegion(bitmap, stride, body, bw, 20, 20, 8, 12, armW, 8)     // Body/torso
    blitSkinRegion(bitmap, stride, body, bw, 44, 20, armW, 12, 0, 8)     // Right arm
    blitSkinRegion(bitmap, stride, body, bw, 4, 20, 4, 12, armW, 20)     // Right leg

    // New format (64x64) has separate left arm/leg
    if (fullSize.height >= 64) {
      blitSkinRegion(bitmap, stride, body, bw, 36, 52, armW, 12, armW + 8, 8) // Left arm
      blitSkinRegion(bitmap, stride, body, bw, 20, 52, 4, 12, armW + 4, 20)   // Left leg
    } else {
      // Old format: mirror right arm/leg
      blitSkinRegion(bitmap, stride, body, bw, 44, 20, armW, 12, armW + 8, 8)
      blitSkinRegion(bitmap, stride, body, bw, 4, 20, 4, 12, armW + 4, 20)
    }

    // Overlay layers
    blitSkinRegion(bitmap, stride, body, bw, 40, 8, 8, 8, armW, 0)       // Head overlay
    if (fullSize.height >= 64) {
      blitSkinRegion(bitmap, stride, body, bw, 20, 36, 8, 12, armW, 8)     // Body overlay
      blitSkinRegion(bitmap, stride, body, bw, 44, 36, armW, 12, 0, 8)     // Right arm overlay
      blitSkinRegion(bitmap, stride, body, bw, 52, 52, armW, 12, armW + 8, 8) // Left arm overlay
      blitSkinRegion(bitmap, stride, body, bw, 4, 36, 4, 12, armW, 20)     // Right leg overlay
      blitSkinRegion(bitmap, stride, body, bw, 4, 52, 4, 12, armW + 4, 20) // Left leg overlay
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

// Pre-warm OS page cache when user selects an instance (before Play click)
ipcMain.handle('instances:prewarm', (_event, id: string) => {
  prewarmInstanceCache(id).catch(() => {})
})

// ── Mod Store (Deduplication) IPC ──
ipcMain.handle('modstore:stats', () => getStoreStats())
ipcMain.handle('modstore:savings', () => getDiskSavings())
ipcMain.handle('modstore:migrate', (_event, instanceId: string) => {
  const modsDir = join(getInstancePath(instanceId), 'mods')
  return migrateExistingMods(modsDir)
})

// ── File Sync IPC ──
ipcMain.handle('sync:getConfig', () => getSyncConfig())
ipcMain.handle('sync:saveConfig', (_event, config: any) => saveSyncConfig(config))
ipcMain.handle('sync:createGroup', (_event, name: string, items: string[], instanceIds: string[]) => createSyncGroup(name, items, instanceIds))
ipcMain.handle('sync:deleteGroup', (_event, groupId: string) => deleteSyncGroup(groupId))
ipcMain.handle('sync:addInstance', (_event, groupId: string, instanceId: string) => addInstanceToGroup(groupId, instanceId))
ipcMain.handle('sync:removeInstance', (_event, groupId: string, instanceId: string) => removeInstanceFromGroup(groupId, instanceId))
ipcMain.handle('sync:getSyncableItems', () => getSyncableItems())
ipcMain.handle('sync:getInstanceGroups', (_event, instanceId: string) => getInstanceSyncGroups(instanceId))
ipcMain.handle('sync:getGroupStats', (_event, groupId: string) => getSyncGroupStats(groupId))
ipcMain.handle('sync:syncToInstance', (_event, instanceId: string) => syncToInstance(instanceId))
ipcMain.handle('sync:syncFromInstance', (_event, instanceId: string) => syncFromInstance(instanceId))
ipcMain.handle('instances:create', async (_event, config: { name: string; version: string; loader: string; createdBy?: string; loaderVersion?: string }) => {
  const instance = await createInstance(config.name, config.version, config.loader, config.createdBy, config.loaderVersion)
  // Fire-and-forget: start downloading game files in background so they're ready at launch
  predownloadForInstance(instance.id, config.version, config.loader, config.loaderVersion).catch(() => {})
  return instance
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
ipcMain.handle('instances:deleteFile', async (_event, id: string, relativePath: string) => {
  const result = await deleteInstanceFile(id, relativePath)
  // Invalidate fast-relaunch cache if mods were modified
  if (relativePath.startsWith('mods')) invalidateLaunchReady(id)
  return result
})
ipcMain.handle('instances:renameFile', (_event, id: string, relativePath: string, newName: string) => {
  return renameInstanceFile(id, relativePath, newName)
})
ipcMain.handle('instances:openFile', (_event, id: string, relativePath: string) => {
  return openInstanceFile(id, relativePath)
})
ipcMain.handle('instances:copyFiles', async (_event, id: string, relativeDest: string, filePaths: string[]) => {
  const result = await copyFilesToInstance(id, relativeDest, filePaths)
  // Invalidate fast-relaunch cache if mods were modified
  if (relativeDest.startsWith('mods')) invalidateLaunchReady(id)
  return result
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
    } else if (cacheKey === 'neoforge') {
      // Fetch NeoForge-supported MC versions from Maven metadata
      try {
        const res = await net.fetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml')
        if (res.ok) {
          const xml = await res.text()
          const versionMatches = xml.match(/<version>([^<]+)<\/version>/g) || []
          const allNeoVersions = versionMatches.map((m: string) => m.replace(/<\/?version>/g, ''))
          // Extract MC versions from NeoForge version numbers
          // NeoForge 21.1.77 -> MC 1.21.1, NeoForge 20.6.119 -> MC 1.20.6
          const mcVersions = new Set<string>()
          for (const v of allNeoVersions) {
            const parts = v.split('.')
            if (parts.length >= 2) {
              const major = parts[0]
              const minor = parts[1]
              mcVersions.add(`1.${major}.${minor}`)
            }
          }
          // Get vanilla releases and filter by NeoForge support
          const mojRes = await net.fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')
          if (mojRes.ok) {
            const mojData = await mojRes.json() as { versions: { id: string; type: string }[] }
            const allReleases = mojData.versions.filter((v) => v.type === 'release').map((v) => v.id)
            versions = allReleases.filter((v) => mcVersions.has(v))
          }
        }
      } catch {
        // fallback: return empty
      }
    } else if (cacheKey === 'quilt') {
      // Fetch Quilt-supported MC versions from Quilt Meta
      try {
        const res = await net.fetch('https://meta.quiltmc.org/v3/versions/game')
        if (res.ok) {
          const data = await res.json() as { version: string; stable: boolean }[]
          versions = data
            .filter((v) => v.stable)
            .map((v) => v.version)
        }
      } catch {
        // fallback: return empty
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
// IPC Handlers — Modpack Import
// ============================================================

ipcMain.handle('modpack:parseFile', async (_event, filePath: string) => {
  try {
    const { parseModpackFile } = require('./modpack-installer')
    return await parseModpackFile(filePath)
  } catch (err: any) {
    console.error('[Modpack] Parse error:', err)
    return { error: err.message }
  }
})

ipcMain.handle('modpack:install', async (_event, filePath: string, instanceId: string) => {
  try {
    const { parseModpackFile, installModrinthPack, installCurseForgePack } = require('./modpack-installer')
    const info = await parseModpackFile(filePath)
    const { getInstancePath } = require('./instances')
    const instancePath = getInstancePath(instanceId)
    
    const onProgress = (progress: any) => {
      mainWindow?.webContents.send('modpack:progress', progress)
    }
    
    if (info.source === 'modrinth') {
      await installModrinthPack(filePath, instancePath, onProgress)
    } else {
      const apiKey = configStore['curseforge_api_key'] as string || null
      await installCurseForgePack(filePath, instancePath, apiKey, onProgress)
    }
    
    return { success: true, info }
  } catch (err: any) {
    console.error('[Modpack] Install error:', err)
    return { error: err.message }
  }
})

ipcMain.handle('modpack:searchModrinth', async (_event, query: string, offset: number = 0) => {
  try {
    const { searchModrinthModpacks } = require('./modpack-installer')
    return await searchModrinthModpacks(query, offset)
  } catch (err: any) {
    console.error('[Modpack] Search error:', err)
    return { hits: [], total_hits: 0, offset: 0, limit: 20 }
  }
})

ipcMain.handle('modpack:getModrinthVersions', async (_event, projectId: string) => {
  try {
    const { getModrinthPackVersions } = require('./modpack-installer')
    return await getModrinthPackVersions(projectId)
  } catch (err: any) {
    console.error('[Modpack] Versions error:', err)
    return []
  }
})

ipcMain.handle('modpack:downloadModrinth', async (_event, projectId: string, versionId: string) => {
  try {
    const { downloadModrinthPack } = require('./modpack-installer')
    const tempDir = join(app.getPath('temp'), 'loom-modpacks')
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
    const filePath = await downloadModrinthPack(projectId, versionId, tempDir)
    return { filePath }
  } catch (err: any) {
    console.error('[Modpack] Download error:', err)
    return { error: err.message }
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
let spotifyRefreshToken: string | null = null
let spotifyTokenExpiry = 0
let spotifyTokenLoaded = false

/** Lazy-load the refresh token from the store (safeStorage may not be ready at module load) */
function loadSpotifyRefreshToken(): string | null {
  if (spotifyTokenLoaded) return spotifyRefreshToken
  spotifyTokenLoaded = true
  try {
    const raw = storeGet('spotify_refresh_token') as string
    if (!raw) return null
    spotifyRefreshToken = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(raw, 'base64'))
      : raw
    return spotifyRefreshToken
  } catch {
    return null
  }
}

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
  spotifyTokenLoaded = true
  return true
})

ipcMain.handle('spotify:getConfig', () => {
  return getSpotifyConfig()
})

async function refreshSpotifyToken(): Promise<boolean> {
  const { clientId } = getSpotifyConfig()
  const token = loadSpotifyRefreshToken()
  if (!token || !clientId) return false
  try {
    const response = await net.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: clientId,
      }).toString(),
    })
    if (!response.ok) return false
    const data = await response.json()
    spotifyAccessToken = data.access_token
    if (data.refresh_token) {
      spotifyRefreshToken = data.refresh_token
      storeSet('spotify_refresh_token', safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(data.refresh_token).toString('base64') : data.refresh_token)
    }
    spotifyTokenExpiry = Date.now() + data.expires_in * 1000
    console.log('[Spotify] Token refreshed successfully')
    return true
  } catch {
    return false
  }
}

async function getSpotifyToken(): Promise<string | null> {
  if (spotifyAccessToken && Date.now() < spotifyTokenExpiry - 60000) {
    return spotifyAccessToken
  }
  if (loadSpotifyRefreshToken()) {
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
        storeSet('spotify_refresh_token', safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(data.refresh_token).toString('base64') : data.refresh_token)
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
    twitch: {
      connected: !!(getTwitchToken()),
      channel: getConnectedChannel() || null,
      viewerCount: null,
    },
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
    const rawGeminiKey = storeGet('geminiApiKey') as string
    let apiKey = rawGeminiKey
    if (rawGeminiKey && safeStorage.isEncryptionAvailable()) {
      try { apiKey = safeStorage.decryptString(Buffer.from(rawGeminiKey, 'base64')) } catch { apiKey = rawGeminiKey }
    }
    if (!apiKey) {
      reply('Error: No Gemini API key found in Loom Launcher settings.')
      return
    }

    const systemText = GEMINI_SYSTEM_PROMPT
    const contents = [{ role: 'user', parts: [{ text }] }]

    const result = await callGeminiAPI(apiKey, {
      system_instruction: { parts: [{ text: systemText }] },
      contents,
      tools: LOOMIE_TOOLS,
    })

    if (!result.ok) {
      reply('Loomie is having trouble connecting to the network.')
      return
    }
    const response = { ok: true }

    const data = result.data
    const content = data?.candidates?.[0]?.content
    
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
// IPC Handlers — Privacy Mode
// ============================================================

ipcMain.handle('privacy:getRegions', () => {
  return getAllRegions()
})

ipcMain.handle('privacy:updatePrefs', (_event, uuid: string, region?: string, enabled?: boolean) => {
  updatePrivacyPrefs(uuid, region, enabled)
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
import { installPerformanceMods, blacklistPerfMod } from './performance-mods'
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
  // Only allow http and https protocols
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(url);
    } else {
      console.warn('[Security] Blocked openExternal for protocol:', parsed.protocol);
    }
  } catch {
    console.warn('[Security] Blocked openExternal for invalid URL:', url);
  }
})

ipcMain.handle('shell:openPath', (_event, filePath: string) => {
  // Open a file with the system's default application
  if (existsSync(filePath)) {
    shell.openPath(filePath)
  }
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

// Register custom protocols (must be before app.whenReady)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  },
  {
    scheme: 'loom',
    privileges: { standard: true, secure: true }
  }
])

// Register loom:// as the default protocol handler for invite deep links
if (process.defaultApp) {
  app.setAsDefaultProtocolClient('loom', process.execPath, [resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient('loom')
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // Handle loom:// deep link from second instance
    const deepLink = argv.find(arg => arg.startsWith('loom://'))
    if (deepLink && mainWindow) {
      mainWindow.webContents.send('p2p:deepLink', deepLink)
    }
  })

  app.whenReady().then(async () => {
    // Register media:// protocol handler — serves local files for video playback
    protocol.handle('media', (request) => {
      // media://C:/path/to/file.mp4 → serve that file
      let filePath = decodeURIComponent(request.url.replace('media://', ''))
      // Remove leading slash on Windows paths (media:///C:/foo → C:/foo)
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.substring(1)
      }
      return net.fetch('file:///' + filePath.replace(/\\/g, '/'))
    })

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
    // Register P2P multiplayer IPC handlers
    const { registerP2PHandlers } = await import('./p2p/ipc-handlers')
    registerP2PHandlers()
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
// IPC Handlers — Bedrock Edition
// ============================================================

import { detectBedrock, launchBedrock, getBedrockWorlds, getBedrockPacks, installAddon, openBedrockFolder, getBedrockDataPath } from './bedrock'

ipcMain.handle('bedrock:detect', async () => {
  try { return await detectBedrock() } catch (e: any) { return { installed: false, version: null, error: e.message } }
})
ipcMain.handle('bedrock:launch', async (_e, serverUrl?: string, serverPort?: number) => {
  try { await launchBedrock(serverUrl, serverPort); return { success: true } } catch (e: any) { return { error: e.message } }
})
ipcMain.handle('bedrock:worlds', async () => {
  try { return await getBedrockWorlds() } catch (e: any) { return [] }
})
ipcMain.handle('bedrock:packs', async (_e, type: string) => {
  try { return await getBedrockPacks(type as any) } catch (e: any) { return [] }
})
ipcMain.handle('bedrock:installAddon', async (_e, filePath: string) => {
  try { return await installAddon(filePath) } catch (e: any) { return { success: false, message: e.message } }
})
ipcMain.handle('bedrock:openFolder', async (_e, type: string) => {
  try { await openBedrockFolder(type as any); return { success: true } } catch (e: any) { return { error: e.message } }
})

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
You can perform actions in the Loom Launcher. When someone asks you to do something (skip a song, download a mod, create an instance, etc.), use the available tools. Always confirm what you did afterward.

## Auto-Diagnosis & Troubleshooting
When the user reports a crash, error, or any issue — follow this exact workflow:

### Step 1: Gather Information
- ALWAYS call get_game_logs first (use lines=200 for crash cases)
- Call get_instances to find the active instance
- Call get_installed_mods on the active instance to see what's installed

### Step 2: Analyze the Logs
Look for these common patterns:
- **"Mixin apply failed"** or **"Mixin transformation failed"** → Two mods are modifying the same game code. Identify BOTH mods from the stack trace and remove the less important one.
- **"java.lang.NoSuchMethodError"** or **"java.lang.NoSuchFieldError"** → A mod was built for a different Minecraft version. Find the mod name in the error and remove it.
- **"DuplicateModsFoundException"** or **"Duplicate mod"** → Two versions of the same mod exist. Use list_mod_files to find duplicates and remove the older one.
- **"Incompatible mod set"** or **"breaks"** → Fabric Loader detected conflicting mods. The error message lists exactly which mods conflict — remove all listed conflicts.
- **"java.lang.OutOfMemoryError"** → Tell the user to increase RAM allocation in instance settings. Recommend 6-8 GB for modded.
- **"Module java.base does not export"** → Java version mismatch. Tell the user to check their Java version in settings.
- **"Failed to load class"** or **"ClassNotFoundException"** → A dependency is missing. Look for the mod that needs it and install_dependency.
- **"Registry entry not found"** or **"Unknown registry key"** → A mod references content from another mod that isn't installed. Install the dependency.
- **"Rendering error"** or **"GL error"** or shader-related crashes → Often caused by Iris/Sodium conflicts with other rendering mods. Remove the conflicting renderer.
- **"Connection refused"** or **"Connection timed out"** → Server-side issue, not a mod problem. Tell the user the server might be down.
- **"Invalid or corrupt jarfile"** → The mod file is corrupted. Remove it and reinstall.
- **"Could not find required mod"** → A mod requires another mod that isn't installed. Install the missing dependency.

### Step 3: Fix Everything
- Use remove_mod with just the mod name/slug — it auto-finds the jar file
- Use install_dependency to install missing dependencies
- Fix ALL issues at once. If there are 5 broken mods, remove all 5 in sequence.
- After removing, verify by calling list_mod_files to confirm they're gone.

### Step 4: Report
- Tell the user exactly what you found, what you fixed, and why
- Suggest relaunching the game
- If the same crash could recur, explain what to avoid

CRITICAL RULES:
- NEVER ask the user for filenames. The remove_mod tool finds files automatically by name.
- Fix ALL issues at once, not just the first one.
- When mods conflict (e.g. Sodium vs Embeddium, or Iris vs Oculus), remove the one that was added as a performance optimization, NOT the one from the modpack.
- Performance mods Loom installs automatically: sodium, embeddium, iris, scalablelux, lithium, starlight, lazydfu, modmenu, fabric-api, enhanced-block-entities, moreculling, cull-less-leaves, sodium-extra, krypton, dynamic-fps, debugify, noisium, modernfix, notenoughcrashes, clumps, immediatelyfast, entityculling, ferritecore, badoptimizations, cloth-config
- If a perf mod conflicts with a modpack mod, ALWAYS remove the perf mod.
- Always take action to fix issues. Don't just describe what's wrong — fix it.
- If you can't identify the problem from logs, ask the user to describe what happened (what they clicked, when it crashed, any error messages on screen).`

// ── Gemini API Helper with Retry + Fallback ──
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'] as const
const MAX_RETRIES = 2
const RETRY_DELAYS = [1000, 2500] // ms between retries

async function callGeminiAPI(
  apiKey: string,
  body: Record<string, any>,
  modelOverride?: string
): Promise<{ ok: boolean; data?: any; status?: number; error?: string }> {
  const models = modelOverride ? [modelOverride] : [...GEMINI_MODELS]

  for (const model of models) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
        const response = await net.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
        })

        if (response.ok) {
          const data = await response.json()
          if (model !== GEMINI_MODELS[0]) {
            console.log(`[Gemini] Used fallback model: ${model}`)
          }
          return { ok: true, data }
        }

        // Don't retry auth errors
        if (response.status === 400) {
          return { ok: false, status: 400, error: 'Invalid API key. Check Settings → Connected Apps → Gemini.' }
        }

        // Retry on 503 (overloaded) and 429 (rate limit)
        if ((response.status === 503 || response.status === 429) && attempt < MAX_RETRIES) {
          console.warn(`[Gemini] ${model} returned ${response.status}, retrying in ${RETRY_DELAYS[attempt]}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`)
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
          continue
        }

        // If all retries exhausted for this model, try fallback
        if ((response.status === 503 || response.status === 429)) {
          console.warn(`[Gemini] ${model} exhausted retries (status ${response.status}), trying next model...`)
          break // Move to next model
        }

        // Other errors — return immediately
        const errText = await response.text()
        return { ok: false, status: response.status, error: `API error (${response.status}): ${errText.slice(0, 200)}` }
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          console.warn(`[Gemini] Network error on ${model}, retrying...`, err.message)
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
          continue
        }
        // Network failure, try next model
        console.warn(`[Gemini] ${model} network failed, trying next model...`)
        break
      }
    }
  }

  return { ok: false, error: 'Gemini is currently unavailable. All models are experiencing high demand — please try again in a moment.' }
}

ipcMain.handle('gemini:chat', async (_event, apiKey: string, messages: Array<{ role: string; parts: Array<{ text: string }> }>) => {
  if (!apiKey) return { error: 'No API key configured. Go to Settings → Connected Apps → Gemini to add one.' }

  try {
    const result = await callGeminiAPI(apiKey, {
      system_instruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT }] },
      contents: messages,
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    })

    if (!result.ok) return { error: result.error }

    const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text
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

    const result = await callGeminiAPI(apiKey, {
      system_instruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT + '\n\nThe user has shared a screenshot of the Loom Launcher. Describe what you see and answer their question about it. The launcher has pages: Library (game instances), Browse (mods), Players (lookup), Settings, and Gemini AI (this chat).' }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    })

    if (!result.ok) return { error: result.error }

    const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text
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

    const result = await callGeminiAPI(apiKey, {
      system_instruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT + '\n\nIMPORTANT: The user is speaking via voice. First, transcribe exactly what they said in quotes. Then respond concisely (1-3 sentences). Format: "[transcription]"\n\nYour response here.' }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
    })

    if (!result.ok) return { error: result.error || 'API error' }

    const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text
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
    },
    {
      name: 'get_game_logs',
      description: 'Get the most recent game log output. Use this to diagnose crashes and errors.',
      parameters: { type: 'OBJECT', properties: { lines: { type: 'NUMBER', description: 'Number of recent lines to return (default 100, max 200)' } } }
    },
    {
      name: 'remove_mod',
      description: 'Remove a mod from an instance by its name/slug. Automatically finds and deletes the matching jar file(s). Use when a mod is incompatible or causing crashes.',
      parameters: { type: 'OBJECT', properties: { instanceId: { type: 'STRING', description: 'Instance ID' }, modName: { type: 'STRING', description: 'The mod name or slug to remove (e.g. "sodium", "iris", "embeddium", "scalablelux"). Case insensitive.' } }, required: ['instanceId', 'modName'] }
    },
    {
      name: 'list_mod_files',
      description: 'List all mod jar files in an instance mods folder. Useful for finding exact filenames.',
      parameters: { type: 'OBJECT', properties: { instanceId: { type: 'STRING', description: 'Instance ID' } }, required: ['instanceId'] }
    },
    {
      name: 'install_dependency',
      description: 'Install a specific mod dependency by its Modrinth slug. Use to fix missing dependency errors.',
      parameters: { type: 'OBJECT', properties: { instanceId: { type: 'STRING', description: 'Instance ID' }, slug: { type: 'STRING', description: 'Modrinth mod slug (e.g. "cloth-config")' }, gameVersion: { type: 'STRING', description: 'Minecraft version' }, loader: { type: 'STRING', description: 'Mod loader (fabric, forge, neoforge, quilt)' } }, required: ['instanceId', 'slug', 'gameVersion', 'loader'] }
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
        return await getAllInstances()
      }
      case 'get_installed_mods': {
        return readInstanceMods(args.instanceId)
      }
      case 'create_instance': {
        const inst = await createInstance(args.name, args.version, args.loader)
        predownloadForInstance(inst.id, args.version, args.loader).catch(() => {})
        return inst
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
      case 'get_game_logs': {
        const buffer = getGameLogBuffer()
        const count = Math.min(Math.max(args.lines || 100, 1), 200)
        const lines = buffer.slice(-count)
        return { lines: lines.join('\n'), count: lines.length }
      }
      case 'remove_mod': {
        const { instanceId, modName } = args
        const modsDir = getInstanceModsDir(instanceId)
        const slug = (modName || '').toLowerCase().trim()
        if (!slug) return { error: 'No mod name provided' }
        // Scan mods folder for jars matching the slug
        const allFiles = existsSync(modsDir) ? readdirSync(modsDir).filter(f => f.endsWith('.jar')) : []
        const matches = allFiles.filter(f => {
          const lower = f.toLowerCase()
          return lower.startsWith(slug + '-') || lower.startsWith(slug + '_') || lower === slug + '.jar' || lower.includes(slug)
        })
        if (matches.length === 0) {
          return { error: `No mod files matching '${slug}' found in mods folder. Available files: ${allFiles.slice(0, 20).join(', ')}` }
        }
        const removed: string[] = []
        for (const file of matches) {
          const filePath = join(modsDir, file)
          if (existsSync(filePath)) {
            unlinkSync(filePath)
            removed.push(file)
          }
        }
        let mods = readInstanceMods(instanceId)
        mods = mods.filter((m: any) => !removed.includes(m.fileName))
        writeInstanceMods(instanceId, mods)
        // Blacklist so the perf mod installer doesn't re-add it
        blacklistPerfMod(instanceId, slug)
        return { success: true, message: `Removed ${removed.length} file(s): ${removed.join(', ')}` }
      }
      case 'list_mod_files': {
        const modsDir = getInstanceModsDir(args.instanceId)
        const files = existsSync(modsDir) ? readdirSync(modsDir).filter(f => f.endsWith('.jar')) : []
        return { files, count: files.length }
      }
      case 'install_dependency': {
        const { instanceId, slug, gameVersion, loader } = args
        const projectUrl = `https://api.modrinth.com/v2/project/${slug}`
        const projectRes = await net.fetch(projectUrl, { headers: { 'User-Agent': MODRINTH_UA } })
        if (!projectRes.ok) return { error: `Mod '${slug}' not found on Modrinth` }
        const projectInfo = await projectRes.json()
        const version = await getCompatibleVersion(slug, gameVersion, loader)
        if (!version || !version.files || version.files.length === 0) {
          return { error: `No compatible version of '${slug}' found for ${gameVersion} (${loader})` }
        }
        const modsDir = getInstanceModsDir(instanceId)
        const primaryFile = version.files.find((f: any) => f.primary) || version.files[0]
        const destPath = join(modsDir, primaryFile.filename)
        await downloadFile(primaryFile.url, destPath)
        const mods = readInstanceMods(instanceId)
        if (!mods.find((m: any) => m.id === slug || m.slug === slug)) {
          mods.push({
            id: slug,
            name: projectInfo.title,
            description: projectInfo.description || '',
            version: version.version_number,
            icon_url: projectInfo.icon_url,
            slug: slug,
            fileName: primaryFile.filename,
            projectId: version.project_id,
            isDependency: true,
            installedAt: Date.now(),
          })
          writeInstanceMods(instanceId, mods)
        }
        return { success: true, message: `Installed ${projectInfo.title} (${version.version_number})`, fileName: primaryFile.filename }
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
      const result = await callGeminiAPI(apiKey, {
        system_instruction: { parts: [{ text: systemText }] },
        contents: conversationContents,
        tools: LOOMIE_TOOLS,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      })

      if (!result.ok) {
        if (result.status === 400) return { error: 'Invalid API key. Check Settings → Connected Apps → Gemini.' }
        return { error: result.error || 'Failed to reach Gemini API' }
      }

      const data = result.data
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

// ============================================================
// Twitch Integration
// ============================================================

ipcMain.handle('twitch:auth', () => startTwitchAuth(mainWindow))
ipcMain.handle('twitch:logout', () => clearTwitchAuth())
ipcMain.handle('twitch:getToken', () => getTwitchToken())
ipcMain.handle('twitch:isLoggedIn', async () => {
  const token = await getTwitchToken()
  return !!token
})
ipcMain.handle('twitch:getFollowedStreams', () => getFollowedStreams())
ipcMain.handle('twitch:isStreamerLive', (_e, channel: string) => isStreamerLive(channel))
ipcMain.handle('twitch:startPolling', () => startTwitchPolling())
ipcMain.handle('twitch:stopPolling', () => stopTwitchPolling())
ipcMain.handle('twitch:connectChat', (_e, channel: string) => connectChat(channel))
ipcMain.handle('twitch:disconnectChat', () => disconnectChat())
ipcMain.handle('twitch:sendChat', (_e, channel: string, message: string) => sendChatMessage(channel, message))

// Forward Twitch events to renderer
twitchEvents.on('streamer-live', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('twitch:streamer-live', data)
  }
  // Also forward to in-game Dynamic Island
  sendTwitchLive({ channel: data.userName || data.userLogin, game: data.gameName || '', viewers: data.viewerCount || 0 })
})
twitchEvents.on('chat-message', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('twitch:chat-message', data)
  }
  // Forward chat to in-game Dynamic Island
  sendTwitchChat({ username: data.username, message: data.message, color: data.color || '#FFFFFF', badges: data.badges || [] })
})

// Handle chat messages sent from the in-game mod
setTwitchChatHandler((message: string) => {
  const channel = getConnectedChannel()
  if (channel && message) {
    sendChatMessage(channel, message)
  }
})

// Initialize Twitch on startup
try { initTwitch() } catch (e: any) { console.log('[Twitch] Init skipped:', e.message) }
try { loadProxyCredentials() } catch (e: any) { console.log('[Proxy] Creds load skipped:', e.message) }

// Wire in-game media search: mod sends search query, we call APIs and reply with results
setMediaSearchHandler(async (query: string, source: string, reply: (results: any[]) => void) => {
  console.log(`[Media] Search handler called: query="${query}" source="${source}"`)
  const results: any[] = []
  if (source === 'youtube' || source === 'all') {
    const ytResults = await searchYouTube(query)
    console.log(`[Media] YouTube returned ${ytResults.length} results`)
    results.push(...ytResults)
  }
  if (source === 'twitch' || source === 'all') {
    const twResults = await searchTwitch(query)
    console.log(`[Media] Twitch returned ${twResults.length} results`)
    results.push(...twResults)
  }
  console.log(`[Media] Total results: ${results.length}`)

  // Download thumbnails in parallel and attach as base64
  // (Java-side HTTP fails inside Minecraft's JVM, so we do it here)
  const thumbPromises = results.map(async (r) => {
    if (!r.thumbnail) return
    try {
      // Use simple ytimg URL for YouTube thumbnails (more reliable than signed URLs)
      let thumbUrl = r.thumbnail
      if (r.source === 'youtube' && r.id) {
        thumbUrl = `https://i.ytimg.com/vi/${r.id}/mqdefault.jpg`
        r.thumbnail = thumbUrl // Normalize for cache key
      }
      const res = await net.fetch(thumbUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' }
      })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        r.thumbnailBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`
      }
    } catch { /* ignore individual failures */ }
  })
  await Promise.allSettled(thumbPromises)
  const withThumbs = results.filter(r => r.thumbnailBase64).length
  console.log(`[Media] Downloaded ${withThumbs}/${results.length} thumbnails`)

  reply(results)
})

// When the mod selects a search result, start playback
setMediaSelectHandler(async (result: any) => {
  if (!result?.url || !result?.source) return
  if (result.source === 'twitch') {
    // Resolve HLS URL and send to mod
    const channel = result.url.split('/').pop() || result.channel
    const hlsUrl = await getTwitchStreamHlsUrl(channel)
    if (hlsUrl) {
      sendMediaPlay(hlsUrl, 'twitch', result.title || channel)
    }
  } else if (result.source === 'youtube') {
    // Send YouTube URL directly — WATERMeDIA uses VLC which handles YouTube natively
    // NOTE: YouTube support was removed in WATERMeDIA 2.1.37, direct URL may not work
    // Fallback: use Invidious to get a direct video URL
    try {
      const videoId = result.id || result.url.match(/v=([^&]+)/)?.[1]
      if (videoId) {
        // Try to get a direct stream URL from Invidious
        const instances = ['https://vid.puffyan.us', 'https://invidious.fdn.fr', 'https://inv.nadeko.net']
        let directUrl = result.url
        for (const instance of instances) {
          try {
            const res = await net.fetch(`${instance}/api/v1/videos/${videoId}`, {
              headers: { 'Accept': 'application/json' }
            })
            if (res.ok) {
              const data = await res.json() as any
              let bestUrl: string | null = null
              let bestQuality = ''
              const combined = (data.formatStreams || [])
                .filter((f: any) => f.container === 'mp4' && f.qualityLabel)
                .sort((a: any, b: any) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0))
              if (combined.length > 0) {
                bestUrl = combined[0].url
                bestQuality = combined[0].qualityLabel
              }
              // Try adaptive 1080p if combined is < 1080p
              if ((parseInt(bestQuality) || 0) < 1080) {
                const hd = (data.adaptiveFormats || [])
                  .filter((f: any) => f.type?.startsWith('video/mp4') && f.qualityLabel?.includes('1080'))
                  .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
                if (hd.length > 0 && hd[0].url) {
                  bestUrl = hd[0].url
                  bestQuality = hd[0].qualityLabel || '1080p'
                }
              }
              console.log(`[Media] Invidious: selected quality ${bestQuality || 'unknown'}`)
              if (bestUrl) {
                directUrl = bestUrl
              }
              break
            }
          } catch { continue }
        }
        sendMediaPlay(directUrl, 'youtube', result.title || 'YouTube Video')
      }
    } catch (err) {
      console.error('[Media] YouTube URL resolution failed:', err)
      sendMediaPlay(result.url, 'youtube', result.title || 'YouTube Video')
    }
  }
})

// ============================================================
// In-Game Browser Video Selection Handler
// ============================================================
// When the MCEF browser detects a YouTube/Twitch video, resolve and play it

setBrowserVideoHandler(async (source: string, id: string, url: string) => {
  console.log(`[Media] Browser video: source=${source} id=${id}`)
  if (source === 'youtube') {
    // Resolve via Invidious for best quality
    const instances = ['https://vid.puffyan.us', 'https://invidious.fdn.fr', 'https://inv.nadeko.net']
    let directUrl = url || `https://www.youtube.com/watch?v=${id}`
    let title = 'YouTube Video'

    // Get title
    try {
      const oembedRes = await net.fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`)
      if (oembedRes.ok) {
        const data = await oembedRes.json() as any
        title = data?.title || title
      }
    } catch { /* ignore */ }

    // Resolve direct URL
    for (const instance of instances) {
      try {
        const res = await net.fetch(`${instance}/api/v1/videos/${id}`, {
          headers: { 'Accept': 'application/json' }
        })
        if (res.ok) {
          const data = await res.json() as any
          let bestUrl: string | null = null
          let bestQuality = ''
          const combined = (data.formatStreams || [])
            .filter((f: any) => f.container === 'mp4' && f.qualityLabel)
            .sort((a: any, b: any) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0))
          if (combined.length > 0) {
            bestUrl = combined[0].url
            bestQuality = combined[0].qualityLabel
          }
          if ((parseInt(bestQuality) || 0) < 1080) {
            const hd = (data.adaptiveFormats || [])
              .filter((f: any) => f.type?.startsWith('video/mp4') && f.qualityLabel?.includes('1080'))
              .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
            if (hd.length > 0 && hd[0].url) {
              bestUrl = hd[0].url
              bestQuality = hd[0].qualityLabel || '1080p'
            }
          }
          console.log(`[Media] Browser: Invidious quality ${bestQuality || 'unknown'}`)
          if (bestUrl) directUrl = bestUrl
          if (data.title) title = data.title
          break
        }
      } catch { continue }
    }

    sendMediaPlay(directUrl, 'youtube', title)
  } else if (source === 'twitch') {
    // Resolve Twitch HLS URL
    const hlsUrl = await getTwitchStreamHlsUrl(id)
    if (hlsUrl) {
      sendMediaPlay(hlsUrl, 'twitch', id)
    } else {
      console.log(`[Media] Browser: Failed to resolve Twitch stream for ${id}`)
    }
  }
})

// ============================================================
// In-Game Media Viewer (Twitch + YouTube)
// ============================================================

const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // Public Twitch GQL client ID (no auth required)

/** Resolve a Twitch channel name to an HLS m3u8 stream URL */
async function getTwitchStreamHlsUrl(channel: string): Promise<string | null> {
  try {
    // Fetch access token from Twitch GQL
    const gqlRes = await net.fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          streamPlaybackAccessToken(channelName:"${channel.toLowerCase()}", params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}) {
            value
            signature
          }
        }`
      })
    })

    if (!gqlRes.ok) return null
    const result = await gqlRes.json() as any
    const token = result?.data?.streamPlaybackAccessToken
    if (!token?.value || !token?.signature) return null

    // Build usher HLS URL
    const params = new URLSearchParams({
      token: token.value,
      sig: token.signature,
      allow_source: 'true',
      allow_audio_only: 'true',
      fast_bread: 'true',
      p: String(Math.floor(Math.random() * 999999)),
    })

    return `https://usher.ttvnw.net/api/channel/hls/${channel.toLowerCase()}.m3u8?${params.toString()}`
  } catch (err) {
    console.error('[Media] Failed to get Twitch HLS URL:', err)
    return null
  }
}

// Play a Twitch stream in-game
ipcMain.handle('media:playTwitch', async (_e, channel: string) => {
  try {
    const hlsUrl = await getTwitchStreamHlsUrl(channel)
    if (!hlsUrl) return { success: false, error: 'Could not resolve stream URL' }

    // Connect to chat for this channel
    await connectChat(channel)

    // Send to in-game mod via DI server
    sendMediaPlay(hlsUrl, 'twitch', channel)

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// Play a YouTube video in-game (WATERMeDIA resolves YouTube URLs natively)
ipcMain.handle('media:playYoutube', async (_e, url: string) => {
  try {
    // Extract video title from URL for display (optional, best-effort)
    let title = 'YouTube Video'
    try {
      const oembedRes = await net.fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
      if (oembedRes.ok) {
        const data = await oembedRes.json() as any
        title = data?.title || title
      }
    } catch { /* ignore */ }

    // Send YouTube URL directly to mod — WATERMeDIA resolves it
    sendMediaPlay(url, 'youtube', title)

    return { success: true, title }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// Stop in-game media
ipcMain.handle('media:stop', async () => {
  sendMediaStop()
  return { success: true }
})

// Get Twitch HLS URL (for launcher UI use)
ipcMain.handle('twitch:getStreamUrl', async (_e, channel: string) => {
  return getTwitchStreamHlsUrl(channel)
})

// ── In-Game Media Search (YouTube + Twitch) ──────────────────

interface MediaSearchResult {
  id: string
  title: string
  source: 'youtube' | 'twitch'
  thumbnail: string
  duration?: string    // YouTube: "12:34", Twitch: "LIVE"
  channel?: string
  viewers?: number     // Twitch only
  url: string
}

/** Search YouTube via Piped API (dynamically fetches working instances) */
async function searchYouTube(query: string): Promise<MediaSearchResult[]> {
  // Strategy 1: Try Piped with dynamically fetched instance list
  const pipedResults = await searchYouTubePiped(query)
  if (pipedResults.length > 0) return pipedResults

  // Strategy 2: Scrape YouTube search page directly
  const scrapeResults = await searchYouTubeScrape(query)
  if (scrapeResults.length > 0) return scrapeResults

  console.error('[Media] YouTube search: all strategies failed')
  return []
}

/** Fetch working Piped API instances dynamically */
async function getPipedInstances(): Promise<string[]> {
  try {
    const res = await net.fetch('https://raw.githubusercontent.com/TeamPiped/Piped/master/piped-instances.json', {
      headers: { 'Accept': 'application/json' }
    })
    if (res.ok) {
      const list = await res.json() as any[]
      return list
        .filter((i: any) => i.api_url && !i.api_url.includes('localhost'))
        .map((i: any) => i.api_url.replace(/\/$/, ''))
        .slice(0, 6)
    }
  } catch (err: any) {
    console.log(`[Media] Failed to fetch Piped instance list: ${err.message}`)
  }
  // Hardcoded fallbacks
  return [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.r4fo.com',
    'https://watchapi.whatever.social',
  ]
}

async function searchYouTubePiped(query: string): Promise<MediaSearchResult[]> {
  const instances = await getPipedInstances()
  for (const instance of instances) {
    try {
      console.log(`[Media] Trying Piped: ${instance}`)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await net.fetch(`${instance}/search?q=${encodeURIComponent(query)}&filter=videos`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      })
      clearTimeout(timeout)
      if (res.ok) {
        const data = await res.json() as any
        const items = data.items || data
        if (Array.isArray(items) && items.length > 0) {
          console.log(`[Media] Piped returned ${items.length} results from ${instance}`)
          return items.slice(0, 20).map((v: any) => ({
            id: v.url?.replace('/watch?v=', '') || v.videoId || '',
            title: v.title || 'Untitled',
            source: 'youtube' as const,
            thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.url?.replace('/watch?v=', '')}/mqdefault.jpg`,
            duration: v.duration ? formatPipedDuration(v.duration) : '0:00',
            channel: v.uploaderName || v.uploader || '',
            url: `https://www.youtube.com${v.url || '/watch?v=' + v.videoId}`,
          }))
        }
      } else {
        console.log(`[Media] Piped ${instance} returned ${res.status}`)
      }
    } catch (err: any) {
      console.log(`[Media] Piped ${instance} failed: ${err.message}`)
    }
  }
  return []
}

/** Scrape YouTube search results directly from youtube.com */
async function searchYouTubeScrape(query: string): Promise<MediaSearchResult[]> {
  try {
    console.log(`[Media] Trying YouTube scrape for: ${query}`)
    const res = await net.fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      }
    })
    if (!res.ok) {
      console.log(`[Media] YouTube scrape returned ${res.status}`)
      return []
    }
    const html = await res.text()
    console.log(`[Media] YouTube scrape: got ${html.length} bytes of HTML`)

    // Extract ytInitialData JSON from the page
    // Use greedy [\s\S]+ (matches any char including newlines) anchored to ;</script>
    // so it captures the entire JSON object, not stopping at a nested }
    const match = html.match(/var\s+ytInitialData\s*=\s*([\s\S]+?);\s*<\/script>/)
      || html.match(/ytInitialData\s*=\s*'(.*?)';/s)
      || html.match(/ytInitialData\s*=\s*({.*?});\s*(?:var|<\/script>|window)/s)
    if (!match) {
      // Debug: show a snippet around where we'd expect ytInitialData
      const idx = html.indexOf('ytInitialData')
      console.log(`[Media] YouTube scrape: could not find ytInitialData (indexOf=${idx})`)
      if (idx >= 0) {
        console.log(`[Media] YouTube scrape context: ...${html.substring(idx, idx + 200)}...`)
      }
      return []
    }

    let rawJson = match[1]
    // If the match captured a quoted string (YouTube sometimes wraps in single quotes), unescape it
    if (rawJson.startsWith("'") || rawJson.startsWith('"')) {
      rawJson = rawJson.slice(1, -1)
    }

    let data: any
    try {
      data = JSON.parse(rawJson)
    } catch (parseErr: any) {
      console.log(`[Media] YouTube scrape: JSON.parse failed: ${parseErr.message}`)
      console.log(`[Media] YouTube scrape: JSON snippet: ${rawJson.substring(0, 300)}...`)
      return []
    }

    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents

    if (!Array.isArray(contents)) {
      // Log available keys for debugging
      const topKeys = Object.keys(data?.contents || {}).join(', ')
      console.log(`[Media] YouTube scrape: unexpected data structure (top keys: ${topKeys})`)
      return []
    }

    console.log(`[Media] YouTube scrape: found ${contents.length} content items to process`)

    const results: MediaSearchResult[] = []
    for (const item of contents) {
      const video = item.videoRenderer
      if (!video?.videoId) continue

      const title = video.title?.runs?.[0]?.text || 'Untitled'
      const channel = video.ownerText?.runs?.[0]?.text || ''
      const duration = video.lengthText?.simpleText || ''
      const thumbnail = video.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`

      results.push({
        id: video.videoId,
        title,
        source: 'youtube',
        thumbnail,
        duration: duration || '0:00',
        channel,
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
      })

      if (results.length >= 20) break
    }

    console.log(`[Media] YouTube scrape returned ${results.length} results`)
    return results
  } catch (err: any) {
    console.error(`[Media] YouTube scrape failed: ${err.message}`)
    return []
  }
}

/** Piped returns duration as seconds (number) */
function formatPipedDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0:00'
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/** Search Twitch live streams via public GQL endpoint */
async function searchTwitch(query: string): Promise<MediaSearchResult[]> {
  try {
    console.log(`[Media] Searching Twitch GQL for: ${query}`)

    // Generate a persistent device ID for this session
    const deviceId = require('crypto').randomBytes(16).toString('hex')

    // Strategy 1: Try SearchResultsPage_SearchResults persisted query (used by Twitch web)
    const gqlBody = JSON.stringify([{
      operationName: 'SearchResultsPage_SearchResults',
      variables: {
        query,
        options: { targets: [{ index: 'STREAM' }] },
        requestID: deviceId.substring(0, 32)
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: '6ea6e6f66006485e41dbe3ebd69d5674c5b22896ce7b595d7fce6411a3571571'
        }
      }
    }])

    const res = await net.fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Content-Type': 'application/json',
        'Device-ID': deviceId,
        'X-Device-Id': deviceId,
      },
      body: gqlBody,
    })

    if (!res.ok) {
      console.log(`[Media] Twitch GQL returned ${res.status}`)
      // Fallback to simple query
      return searchTwitchFallback(query)
    }

    const data = await res.json() as any
    const responseData = Array.isArray(data) ? data[0] : data
    const items = responseData?.data?.searchFor?.streams?.edges
      || responseData?.data?.searchStreams?.edges
      || []
    console.log(`[Media] Twitch GQL returned ${items.length} results`)

    if (items.length === 0) {
      // Log response structure for debugging
      const keys = Object.keys(responseData?.data || {}).join(', ')
      console.log(`[Media] Twitch GQL response keys: ${keys}`)
      // Try fallback
      return searchTwitchFallback(query)
    }

    return items.map((edge: any) => {
      const node = edge.node || edge.item || edge
      const login = node?.broadcaster?.login || node?.login || ''
      const displayName = node?.broadcaster?.displayName || node?.displayName || login
      return {
        id: node?.id || '',
        title: node?.title || displayName,
        source: 'twitch' as const,
        thumbnail: node?.previewImageURL || '',
        duration: 'LIVE',
        channel: displayName,
        viewers: node?.viewersCount || node?.stream?.viewersCount || 0,
        url: `https://twitch.tv/${login}`,
      }
    })
  } catch (err) {
    console.error('[Media] Twitch GQL search failed:', err)
    return searchTwitchFallback(query)
  }
}

/** Fallback: simple GQL searchStreams query */
async function searchTwitchFallback(query: string): Promise<MediaSearchResult[]> {
  try {
    console.log(`[Media] Trying Twitch fallback search for: ${query}`)
    const deviceId = require('crypto').randomBytes(16).toString('hex')

    const gqlBody = JSON.stringify({
      query: `query { searchStreams(query: "${query.replace(/"/g, '\\"')}", first: 20) { edges { node { id broadcaster { login displayName } title game { name } viewersCount previewImageURL(width: 440, height: 248) } } } }`,
    })

    const res = await net.fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Content-Type': 'application/json',
        'Device-ID': deviceId,
        'X-Device-Id': deviceId,
      },
      body: gqlBody,
    })

    if (!res.ok) {
      console.log(`[Media] Twitch fallback returned ${res.status}`)
      return []
    }

    const data = await res.json() as any
    const edges = data?.data?.searchStreams?.edges || []
    console.log(`[Media] Twitch fallback returned ${edges.length} results`)

    return edges.map((edge: any) => {
      const node = edge.node
      const login = node?.broadcaster?.login || ''
      const displayName = node?.broadcaster?.displayName || login
      return {
        id: node?.id || '',
        title: node?.title || displayName,
        source: 'twitch' as const,
        thumbnail: node?.previewImageURL || '',
        duration: 'LIVE',
        channel: displayName,
        viewers: node?.viewersCount || 0,
        url: `https://twitch.tv/${login}`,
      }
    })
  } catch (err) {
    console.error('[Media] Twitch fallback search failed:', err)
    return []
  }
}

// IPC handler for renderer-side search
ipcMain.handle('media:search', async (_e, query: string, source: 'youtube' | 'twitch' | 'all') => {
  console.log(`[Media] IPC search: query="${query}" source="${source}"`)
  const results: MediaSearchResult[] = []
  if (source === 'youtube' || source === 'all') {
    const ytResults = await searchYouTube(query)
    console.log(`[Media] IPC YouTube returned ${ytResults.length} results`)
    results.push(...ytResults)
  }
  if (source === 'twitch' || source === 'all') {
    const twResults = await searchTwitch(query)
    console.log(`[Media] IPC Twitch returned ${twResults.length} results`)
    results.push(...twResults)
  }
  console.log(`[Media] IPC total results: ${results.length}`)
  return results
})

// ============================================================
// Recording & Gallery
// ============================================================

ipcMain.handle('recording:downloadFFmpeg', () => downloadFFmpeg())
ipcMain.handle('recording:getFFmpegPath', () => getFFmpegPath())
ipcMain.handle('recording:start', (_e, opts) => startRecording(opts))
ipcMain.handle('recording:stop', () => stopRecording())
ipcMain.handle('recording:startReplayBuffer', (_e, opts) => startReplayBuffer(opts))
ipcMain.handle('recording:saveReplayBuffer', () => saveReplayBuffer())
ipcMain.handle('recording:stopReplayBuffer', () => stopReplayBuffer())
ipcMain.handle('recording:getStatus', () => getRecordingStatus())
ipcMain.handle('gallery:getItems', () => getGalleryItems())
ipcMain.handle('gallery:saveMetadata', (_e, item) => saveGalleryMetadata(item))

// Forward recording events to renderer
recordingEvents.on('status', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording:status', data)
  }
})
recordingEvents.on('progress', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording:progress', data)
  }
})

// ============================================================
// Video Editor
// ============================================================

ipcMain.handle('editor:trim', (_e, input, output, start, end) => trimVideo(input, output, start, end))
ipcMain.handle('editor:concatenate', (_e, inputs, output) => concatenateVideos(inputs, output))
ipcMain.handle('editor:textOverlay', (_e, input, output, text, opts) => addTextOverlay(input, output, text, opts))
ipcMain.handle('editor:changeSpeed', (_e, input, output, speed) => changeSpeed(input, output, speed))
ipcMain.handle('editor:thumbnail', (_e, video, output, atTime) => generateThumbnail(video, output, atTime))

// ============================================================
// Launcher Migration
// ============================================================

ipcMain.handle('migration:detect', () => detectLaunchers())
ipcMain.handle('migration:getImportable', (_e, path) => getImportableData(path))
ipcMain.handle('migration:import', (_e, type, path, opts) => importFromLauncher(type, path, opts))

// ============================================================
// Social Sharing
// ============================================================

ipcMain.handle('social:getConfig', () => getSocialConfig())
ipcMain.handle('social:addDiscordWebhook', (_e, url) => addDiscordWebhook(url))
ipcMain.handle('social:removeDiscordWebhook', (_e, url) => removeDiscordWebhook(url))
ipcMain.handle('social:setYouTubeToken', (_e, path) => setYouTubeTokenPath(path))
ipcMain.handle('social:shareToDiscord', (_e, webhookUrl, opts) => shareToDiscord(webhookUrl, opts))
ipcMain.handle('social:uploadToYouTube', (_e, tokenPath, opts) => uploadToYouTube(tokenPath, opts))
