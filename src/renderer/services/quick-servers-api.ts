// Quick Servers API Service — calls through Electron IPC to the backend
// This will replace quick-servers-mock.ts when backend is connected

import type { QuickServer, CreateServerConfig, Backup, ServerTier } from './quick-servers-mock'

const ipc = (window as any).electron?.ipcRenderer || {
  invoke: async (channel: string, ...args: any[]) => {
    console.warn(`[QS-API] IPC not available, channel: ${channel}`, args)
    return null
  },
}

// ── Servers ──

export async function getServers(): Promise<QuickServer[]> {
  return (await ipc.invoke('qs:getServers')) || []
}

export async function createServer(config: CreateServerConfig): Promise<QuickServer> {
  return await ipc.invoke('qs:createServer', config)
}

export async function deleteServer(id: string): Promise<void> {
  await ipc.invoke('qs:deleteServer', id)
}

export async function startServer(id: string): Promise<void> {
  await ipc.invoke('qs:startServer', id)
}

export async function stopServer(id: string): Promise<void> {
  await ipc.invoke('qs:stopServer', id)
}

export async function restartServer(id: string): Promise<void> {
  await ipc.invoke('qs:restartServer', id)
}

export async function sendCommand(id: string, command: string): Promise<string> {
  const result = await ipc.invoke('qs:sendCommand', id, command)
  return result?.response || ''
}

export async function getServerStats(
  id: string
): Promise<{ cpu: number; ram: number; disk: number }> {
  return (await ipc.invoke('qs:getStats', id)) || { cpu: 0, ram: 0, disk: 0 }
}

// ── Settings ──

export async function getSettings(id: string): Promise<Record<string, any>> {
  return (await ipc.invoke('qs:getSettings', id)) || {}
}

export async function saveSettings(id: string, settings: Record<string, any>): Promise<void> {
  await ipc.invoke('qs:saveSettings', id, settings)
}

// ── Files ──

export async function listFiles(id: string, directory: string): Promise<any[]> {
  return (await ipc.invoke('qs:listFiles', id, directory)) || []
}

export async function uploadFile(id: string, path: string, content: string): Promise<void> {
  await ipc.invoke('qs:uploadFile', id, path, content)
}

export async function deleteFile(id: string, files: string[]): Promise<void> {
  await ipc.invoke('qs:deleteFile', id, files)
}

export async function downloadFile(id: string, path: string): Promise<string> {
  return (await ipc.invoke('qs:downloadFile', id, path)) || ''
}

// ── Backups ──

export async function createBackup(id: string): Promise<Backup> {
  return await ipc.invoke('qs:createBackup', id)
}

export async function listBackups(id: string): Promise<Backup[]> {
  return (await ipc.invoke('qs:listBackups', id)) || []
}

export async function restoreBackup(id: string, backupId: string): Promise<void> {
  await ipc.invoke('qs:restoreBackup', id, backupId)
}

// ── Plugins ──

export async function installPlugin(
  serverId: string,
  projectId: string,
  versionId: string
): Promise<void> {
  await ipc.invoke('qs:installPlugin', serverId, projectId, versionId)
}

export async function uninstallPlugin(serverId: string, pluginName: string): Promise<void> {
  await ipc.invoke('qs:uninstallPlugin', serverId, pluginName)
}

// ── Payments ──

export async function createCheckout(config: any): Promise<{ url: string; sessionId: string }> {
  return await ipc.invoke('qs:createCheckout', config)
}

export async function extendServer(id: string, days: number): Promise<void> {
  await ipc.invoke('qs:extendServer', id, days)
}

export async function upgradeServer(id: string, newTier: ServerTier): Promise<void> {
  await ipc.invoke('qs:upgradeServer', id, newTier)
}

export async function verifyPayment(sessionId: string): Promise<any> {
  return await ipc.invoke('qs:verifyPayment', sessionId)
}

// ── Auth ──

export async function login(email: string, password: string): Promise<{ token: string }> {
  return await ipc.invoke('qs:login', email, password)
}

export async function register(email: string, password: string): Promise<{ token: string }> {
  return await ipc.invoke('qs:register', email, password)
}
