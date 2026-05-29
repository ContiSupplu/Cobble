import { contextBridge, ipcRenderer } from 'electron'

// ============================================================
// Expose safe APIs to the renderer process via contextBridge
// ============================================================

const electronAPI = {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Theme
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme: string) => ipcRenderer.invoke('theme:set', theme),

  // Persistent store
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),

  // Mojang lookup
  lookupPlayer: (username: string) => ipcRenderer.invoke('mojang:lookupPlayer', username),

  // Auth (Multi-Account)
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getAccount: () => ipcRenderer.invoke('auth:getAccount'),
  getAccounts: () => ipcRenderer.invoke('auth:getAccounts'),
  getActiveUuid: () => ipcRenderer.invoke('auth:getActiveUuid'),
  switchAccount: (uuid: string) => ipcRenderer.invoke('auth:switchAccount', uuid),
  removeAccount: (uuid: string) => ipcRenderer.invoke('auth:removeAccount', uuid),
  updateDisplayName: (uuid: string, displayName: string) => ipcRenderer.invoke('auth:updateDisplayName', uuid, displayName),

  // Incognito
  getIncognitoRegions: () => ipcRenderer.invoke('incognito:getRegions'),
  updateIncognitoPrefs: (uuid: string, region?: string, enabled?: boolean) => ipcRenderer.invoke('incognito:updatePrefs', uuid, region, enabled),

  // Launcher (Phase 2)
  launch: (instanceId: string, serverId?: string) => ipcRenderer.invoke('launch:start', instanceId, serverId),
  killGame: () => ipcRenderer.invoke('launch:kill'),
  getLaunchStatus: () => ipcRenderer.invoke('launch:status'),
  onLaunchLog: (callback: (log: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, log: string) => callback(log)
    ipcRenderer.on('launch:log', handler)
    return () => ipcRenderer.removeListener('launch:log', handler)
  },
  onLaunchStatus: (callback: (status: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: any) => callback(status)
    ipcRenderer.on('launch:statusUpdate', handler)
    return () => ipcRenderer.removeListener('launch:statusUpdate', handler)
  },

  // Skin resolver (direct from Mojang)
  resolveSkinUrl: (uuid: string, size?: number) => ipcRenderer.invoke('skins:resolve', uuid, size),
  resolveBodyUrl: (uuid: string, height?: number) => ipcRenderer.invoke('skins:resolveBody', uuid, height),

  // Changing Room (skin management)
  getCurrentSkin: () => ipcRenderer.invoke('skins:getCurrent'),
  uploadSkin: (filePath: string, variant: 'classic' | 'slim') => ipcRenderer.invoke('skins:upload', filePath, variant),
  uploadSkinUrl: (skinUrl: string, variant: 'classic' | 'slim') => ipcRenderer.invoke('skins:uploadUrl', skinUrl, variant),
  resetSkin: () => ipcRenderer.invoke('skins:reset'),
  pickSkinFile: () => ipcRenderer.invoke('skins:pickFile'),

  // Instances (Phase 2)
  getInstances: () => ipcRenderer.invoke('instances:getAll'),
  createInstance: (config: unknown) => ipcRenderer.invoke('instances:create', config),
  deleteInstance: (id: string) => ipcRenderer.invoke('instances:delete', id),
  getTrashedInstances: () => ipcRenderer.invoke('instances:getTrash'),
  recoverInstance: (id: string) => ipcRenderer.invoke('instances:recover', id),
  permanentlyDeleteInstance: (id: string) => ipcRenderer.invoke('instances:permanentDelete', id),
  cloneInstance: (id: string, newName: string, targetProfileId?: string) => ipcRenderer.invoke('instances:clone', id, newName, targetProfileId),
  updateInstance: (id: string, config: unknown) => ipcRenderer.invoke('instances:update', id, config),
  openInstanceFolder: (id: string) => ipcRenderer.invoke('instances:openFolder', id),
  // File Explorer
  listInstanceDir: (id: string, relativePath: string) => ipcRenderer.invoke('instances:listDir', id, relativePath),
  deleteInstanceFile: (id: string, relativePath: string) => ipcRenderer.invoke('instances:deleteFile', id, relativePath),
  renameInstanceFile: (id: string, relativePath: string, newName: string) => ipcRenderer.invoke('instances:renameFile', id, relativePath, newName),
  openInstanceFile: (id: string, relativePath: string) => ipcRenderer.invoke('instances:openFile', id, relativePath),
  copyFilesToInstance: (id: string, relativeDest: string, filePaths: string[]) => ipcRenderer.invoke('instances:copyFiles', id, relativeDest, filePaths),
  setInstanceIcon: (id: string, imagePath: string) => ipcRenderer.invoke('instances:setIcon', id, imagePath),
  getInstancePath: (id: string) => ipcRenderer.invoke('instances:getPath', id),
  getVersions: (loader: string) => ipcRenderer.invoke('versions:getAll', loader),

  // Stats (Phase 3)
  getPlayerStats: (username: string) => ipcRenderer.invoke('stats:getPlayer', username),
  getStatHistory: (uuid: string, days: number) => ipcRenderer.invoke('stats:getHistory', uuid, days),
  snapshotStats: () => ipcRenderer.invoke('stats:snapshot'),

  // Image proxy (bypass CSP/CORS)
  proxyImage: (url: string) => ipcRenderer.invoke('image:proxy', url),

  // Mods (per-instance)
  searchMods: (query: string, page: number) => ipcRenderer.invoke('mods:search', query, page),
  installMod: (instanceId: string, mod: unknown, gameVersion: string, loader: string) => ipcRenderer.invoke('mods:install', instanceId, mod, gameVersion, loader),
  uninstallMod: (instanceId: string, modId: string) => ipcRenderer.invoke('mods:uninstall', instanceId, modId),
  getInstalledMods: (instanceId: string) => ipcRenderer.invoke('mods:getInstalled', instanceId),
  getProject: (slugOrId: string) => ipcRenderer.invoke('mods:getProject', slugOrId),
  checkModVersion: (projectId: string, gameVersion: string, loader: string) => ipcRenderer.invoke('mods:checkVersion', projectId, gameVersion, loader),
  installPerformanceMods: (instanceId: string, gameVersion: string, loader: string) => ipcRenderer.invoke('mods:installEssentials', instanceId, gameVersion, loader),

  // Resource Packs
  searchResourcePacks: (query: string, page: number) => ipcRenderer.invoke('resourcepacks:search', query, page),
  installResourcePack: (instanceId: string, pack: unknown, gameVersion: string) => ipcRenderer.invoke('resourcepacks:install', instanceId, pack, gameVersion),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Tools (Phase 6)
  setToolConfig: (tool: string, config: unknown) => ipcRenderer.invoke('tools:setConfig', tool, config),
  getToolConfig: (tool: string) => ipcRenderer.invoke('tools:getConfig', tool),
  toggleTool: (tool: string, enabled: boolean) => ipcRenderer.invoke('tools:toggle', tool, enabled),
  killAllTools: () => ipcRenderer.invoke('tools:killAll'),

  // Spotify (Phase 7)
  spotifyLogin: () => ipcRenderer.invoke('spotify:login'),
  spotifyLogout: () => ipcRenderer.invoke('spotify:logout'),
  getSpotifyStatus: () => ipcRenderer.invoke('spotify:status'),
  spotifyPlay: () => ipcRenderer.invoke('spotify:play'),
  spotifyPause: () => ipcRenderer.invoke('spotify:pause'),
  spotifyNext: () => ipcRenderer.invoke('spotify:next'),
  spotifyPrevious: () => ipcRenderer.invoke('spotify:previous'),
  setSpotifyVolume: (volume: number) => ipcRenderer.invoke('spotify:setVolume', volume),
  getSpotifyLyrics: (track: string, artist: string, duration: number) => ipcRenderer.invoke('spotify:lyrics', track, artist, duration),
  setSpotifyConfig: (config: { clientId: string; redirectUri: string }) => ipcRenderer.invoke('spotify:setConfig', config),
  getSpotifyConfig: () => ipcRenderer.invoke('spotify:getConfig'),
  onSpotifyUpdate: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('spotify:update', handler)
    return () => ipcRenderer.removeListener('spotify:update', handler)
  },

  // Preload progress
  onPreloadProgress: (callback: (data: { step: string; progress: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { step: string; progress: number }) => callback(data)
    ipcRenderer.on('preload:progress', handler)
    return () => ipcRenderer.removeListener('preload:progress', handler)
  },

  // Discord Rich Presence
  discordConnect: (appId: string) => ipcRenderer.invoke('discord:connect', appId),
  discordDisconnect: () => ipcRenderer.invoke('discord:disconnect'),
  getDiscordStatus: () => ipcRenderer.invoke('discord:status'),
  getDiscordConfig: () => ipcRenderer.invoke('discord:getConfig'),

  // Gemini AI
  geminiChat: (apiKey: string, messages: Array<{ role: string; parts: Array<{ text: string }> }>) =>
    ipcRenderer.invoke('gemini:chat', apiKey, messages),
  geminiChatVision: (apiKey: string, text: string, imageBase64: string, history: any[]) =>
    ipcRenderer.invoke('gemini:chat-vision', apiKey, text, imageBase64, history),
  geminiChatAudio: (apiKey: string, audioBase64: string, mimeType: string, history: any[]) =>
    ipcRenderer.invoke('gemini:chat-audio', apiKey, audioBase64, mimeType, history),
  geminiChatWithTools: (apiKey: string, messages: any[], context?: any) =>
    ipcRenderer.invoke('gemini:chat-with-tools', apiKey, messages, context),

  // Chat History
  chatCreate: () => ipcRenderer.invoke('chat:create'),
  chatSave: (id: string, messages: any[], title?: string) => ipcRenderer.invoke('chat:save', id, messages, title),
  chatLoad: (id: string) => ipcRenderer.invoke('chat:load', id),
  chatList: () => ipcRenderer.invoke('chat:list'),
  chatDelete: (id: string) => ipcRenderer.invoke('chat:delete', id),
  chatRename: (id: string, title: string) => ipcRenderer.invoke('chat:rename', id, title),

  // Friends
  getFriends: () => ipcRenderer.invoke('friends:getAll'),
  addFriend: (username: string) => ipcRenderer.invoke('friends:add', username),
  removeFriend: (uuid: string) => ipcRenderer.invoke('friends:remove', uuid),
  updateFriendNote: (uuid: string, note: string) => ipcRenderer.invoke('friends:updateNote', uuid, note),

  // Screen Capture
  screenCapture: () => ipcRenderer.invoke('screen:capture'),

  // Performance Optimizations
  applyDefenderExclusion: () => ipcRenderer.invoke('perf:applyDefenderExclusion'),
  setPowerPlan: () => ipcRenderer.invoke('perf:setPowerPlan'),
  restorePowerPlan: () => ipcRenderer.invoke('perf:restorePowerPlan'),
  applyNetworkOptimization: () => ipcRenderer.invoke('perf:applyNetworkOpt'),
  restoreNetworkSettings: () => ipcRenderer.invoke('perf:restoreNetwork'),

  // Network
  pingServer: (host: string, port?: number) => ipcRenderer.invoke('net:pingServer', host, port),

  // Auto-Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getAppVersion: () => ipcRenderer.invoke('updater:getVersion'),
  onUpdateStatus: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for the renderer
export type ElectronAPI = typeof electronAPI
