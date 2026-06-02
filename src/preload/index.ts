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

  // Privacy Mode
  getPrivacyRegions: () => ipcRenderer.invoke('privacy:getRegions'),
  updatePrivacyPrefs: (uuid: string, region?: string, enabled?: boolean) => ipcRenderer.invoke('privacy:updatePrefs', uuid, region, enabled),

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
  resolveBodyUrl: (uuid: string, height?: number, variant?: 'classic' | 'slim') => ipcRenderer.invoke('skins:resolveBody', uuid, height, variant),

  // Changing Room (skin management)
  getCurrentSkin: () => ipcRenderer.invoke('skins:getCurrent'),
  uploadSkin: (filePath: string, variant: 'classic' | 'slim') => ipcRenderer.invoke('skins:upload', filePath, variant),
  uploadSkinUrl: (skinUrl: string, variant: 'classic' | 'slim') => ipcRenderer.invoke('skins:uploadUrl', skinUrl, variant),
  changeSkinVariant: (variant: 'classic' | 'slim') => ipcRenderer.invoke('skins:changeVariant', variant),
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
  prewarmInstance: (id: string) => ipcRenderer.invoke('instances:prewarm', id),
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
  shellOpenPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),

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

  // Modpack
  parseModpackFile: (filePath: string) => ipcRenderer.invoke('modpack:parseFile', filePath),
  installModpack: (filePath: string, instanceId: string) => ipcRenderer.invoke('modpack:install', filePath, instanceId),
  searchModrinthModpacks: (query: string, offset?: number) => ipcRenderer.invoke('modpack:searchModrinth', query, offset),
  getModrinthPackVersions: (projectId: string) => ipcRenderer.invoke('modpack:getModrinthVersions', projectId),
  downloadModrinthPack: (projectId: string, versionId: string) => ipcRenderer.invoke('modpack:downloadModrinth', projectId, versionId),
  onModpackProgress: (cb: (progress: any) => void) => {
    ipcRenderer.on('modpack:progress', (_e, progress) => cb(progress))
    return () => { ipcRenderer.removeAllListeners('modpack:progress') }
  },

  onCrashDetected: (cb: (data: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: any) => cb(data)
    ipcRenderer.on('loomie:crash-detected', handler)
    return () => { ipcRenderer.removeListener('loomie:crash-detected', handler) }
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

  // Windows Defender exclusion prompt (opt-in during launch)
  onDefenderExclusionPrompt: (callback: (data: { paths: string[]; reason: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { paths: string[]; reason: string }) => callback(data)
    ipcRenderer.on('defender:exclusionPrompt', handler)
    return () => ipcRenderer.removeListener('defender:exclusionPrompt', handler)
  },
  respondDefenderExclusion: (approved: boolean) => ipcRenderer.invoke('defender:userResponse', approved),
  resetDefenderChoice: () => ipcRenderer.invoke('defender:resetChoice'),

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

  // Bedrock Edition
  bedrockDetect: () => ipcRenderer.invoke('bedrock:detect'),
  bedrockLaunch: (serverUrl?: string, serverPort?: number) => ipcRenderer.invoke('bedrock:launch', serverUrl, serverPort),
  bedrockWorlds: () => ipcRenderer.invoke('bedrock:worlds'),
  bedrockPacks: (type: string) => ipcRenderer.invoke('bedrock:packs', type),
  bedrockInstallAddon: (filePath: string) => ipcRenderer.invoke('bedrock:installAddon', filePath),
  bedrockOpenFolder: (type: string) => ipcRenderer.invoke('bedrock:openFolder', type),
  bedrockGetQueue: () => ipcRenderer.invoke('bedrock:getQueue'),
  bedrockInstallQueue: () => ipcRenderer.invoke('bedrock:installQueue'),
  bedrockClearQueue: () => ipcRenderer.invoke('bedrock:clearQueue'),
  bedrockRemoveFromQueue: (index: number) => ipcRenderer.invoke('bedrock:removeFromQueue', index),
  bedrockSetAdBlock: (enabled: boolean) => ipcRenderer.invoke('bedrock:setAdBlock', enabled),
  bedrockGetAdBlock: () => ipcRenderer.invoke('bedrock:getAdBlock'),
  onBedrockAddonQueued: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('bedrock:addon-queued', handler)
    return () => ipcRenderer.removeListener('bedrock:addon-queued', handler)
  },
  onBedrockQueueInstalled: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('bedrock:queue-installed', handler)
    return () => ipcRenderer.removeListener('bedrock:queue-installed', handler)
  },

  // Twitch Integration
  twitchAuth: () => ipcRenderer.invoke('twitch:auth'),
  twitchLogout: () => ipcRenderer.invoke('twitch:logout'),
  twitchIsLoggedIn: () => ipcRenderer.invoke('twitch:isLoggedIn'),
  twitchGetFollowedStreams: () => ipcRenderer.invoke('twitch:getFollowedStreams'),
  twitchIsStreamerLive: (channel: string) => ipcRenderer.invoke('twitch:isStreamerLive', channel),
  twitchStartPolling: () => ipcRenderer.invoke('twitch:startPolling'),
  twitchStopPolling: () => ipcRenderer.invoke('twitch:stopPolling'),
  twitchConnectChat: (channel: string) => ipcRenderer.invoke('twitch:connectChat', channel),
  twitchDisconnectChat: () => ipcRenderer.invoke('twitch:disconnectChat'),
  twitchSendChat: (channel: string, message: string) => ipcRenderer.invoke('twitch:sendChat', channel, message),
  onTwitchStreamerLive: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('twitch:streamer-live', handler)
    return () => ipcRenderer.removeListener('twitch:streamer-live', handler)
  },
  onTwitchChatMessage: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('twitch:chat-message', handler)
    return () => ipcRenderer.removeListener('twitch:chat-message', handler)
  },

  // In-Game Media Viewer (Twitch streams + YouTube videos)
  mediaPlayTwitch: (channel: string) => ipcRenderer.invoke('media:playTwitch', channel),
  mediaPlayYoutube: (url: string) => ipcRenderer.invoke('media:playYoutube', url),
  mediaStop: () => ipcRenderer.invoke('media:stop'),
  twitchGetStreamUrl: (channel: string) => ipcRenderer.invoke('twitch:getStreamUrl', channel),
  mediaSearch: (query: string, source: 'youtube' | 'twitch' | 'all') => ipcRenderer.invoke('media:search', query, source),

  // Recording & Gallery
  recordingDownloadFFmpeg: () => ipcRenderer.invoke('recording:downloadFFmpeg'),
  recordingGetFFmpegPath: () => ipcRenderer.invoke('recording:getFFmpegPath'),
  recordingStart: (opts: any) => ipcRenderer.invoke('recording:start', opts),
  recordingStop: () => ipcRenderer.invoke('recording:stop'),
  recordingStartReplayBuffer: (opts: any) => ipcRenderer.invoke('recording:startReplayBuffer', opts),
  recordingSaveReplayBuffer: () => ipcRenderer.invoke('recording:saveReplayBuffer'),
  recordingStopReplayBuffer: () => ipcRenderer.invoke('recording:stopReplayBuffer'),
  recordingGetStatus: () => ipcRenderer.invoke('recording:getStatus'),
  galleryGetItems: () => ipcRenderer.invoke('gallery:getItems'),
  gallerySaveMetadata: (item: any) => ipcRenderer.invoke('gallery:saveMetadata', item),
  onRecordingStatus: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('recording:status', handler)
    return () => ipcRenderer.removeListener('recording:status', handler)
  },
  onRecordingProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('recording:progress', handler)
    return () => ipcRenderer.removeListener('recording:progress', handler)
  },

  // Video Editor
  editorTrim: (input: string, output: string, start: string, end: string) => ipcRenderer.invoke('editor:trim', input, output, start, end),
  editorConcatenate: (inputs: string[], output: string) => ipcRenderer.invoke('editor:concatenate', inputs, output),
  editorTextOverlay: (input: string, output: string, text: string, opts: any) => ipcRenderer.invoke('editor:textOverlay', input, output, text, opts),
  editorChangeSpeed: (input: string, output: string, speed: number) => ipcRenderer.invoke('editor:changeSpeed', input, output, speed),
  editorThumbnail: (video: string, output: string, atTime?: string) => ipcRenderer.invoke('editor:thumbnail', video, output, atTime),

  // Launcher Migration
  migrationDetect: () => ipcRenderer.invoke('migration:detect'),
  migrationGetImportable: (path: string) => ipcRenderer.invoke('migration:getImportable', path),
  migrationImport: (type: string, path: string, opts: any) => ipcRenderer.invoke('migration:import', type, path, opts),

  // Social Sharing
  socialGetConfig: () => ipcRenderer.invoke('social:getConfig'),
  socialAddDiscordWebhook: (url: string) => ipcRenderer.invoke('social:addDiscordWebhook', url),
  socialRemoveDiscordWebhook: (url: string) => ipcRenderer.invoke('social:removeDiscordWebhook', url),
  socialSetYouTubeToken: (path: string) => ipcRenderer.invoke('social:setYouTubeToken', path),
  socialShareToDiscord: (webhookUrl: string, opts: any) => ipcRenderer.invoke('social:shareToDiscord', webhookUrl, opts),
  socialUploadToYouTube: (tokenPath: string, opts: any) => ipcRenderer.invoke('social:uploadToYouTube', tokenPath, opts),

  // Mod Store (Deduplication)
  modStoreStats: () => ipcRenderer.invoke('modstore:stats'),
  modStoreSavings: () => ipcRenderer.invoke('modstore:savings'),
  modStoreMigrate: (instanceId: string) => ipcRenderer.invoke('modstore:migrate', instanceId),

  // File Sync
  syncGetConfig: () => ipcRenderer.invoke('sync:getConfig'),
  syncSaveConfig: (config: any) => ipcRenderer.invoke('sync:saveConfig', config),
  syncCreateGroup: (name: string, items: string[], instanceIds: string[]) => ipcRenderer.invoke('sync:createGroup', name, items, instanceIds),
  syncDeleteGroup: (groupId: string) => ipcRenderer.invoke('sync:deleteGroup', groupId),
  syncAddInstance: (groupId: string, instanceId: string) => ipcRenderer.invoke('sync:addInstance', groupId, instanceId),
  syncRemoveInstance: (groupId: string, instanceId: string) => ipcRenderer.invoke('sync:removeInstance', groupId, instanceId),
  syncGetSyncableItems: () => ipcRenderer.invoke('sync:getSyncableItems'),
  syncGetInstanceGroups: (instanceId: string) => ipcRenderer.invoke('sync:getInstanceGroups', instanceId),
  syncGetGroupStats: (groupId: string) => ipcRenderer.invoke('sync:getGroupStats', groupId),
  syncToInstance: (instanceId: string) => ipcRenderer.invoke('sync:syncToInstance', instanceId),
  syncFromInstance: (instanceId: string) => ipcRenderer.invoke('sync:syncFromInstance', instanceId),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for the renderer
export type ElectronAPI = typeof electronAPI
