import { ipcMain } from 'electron'
import { net } from 'electron'

const API_BASE = process.env.QS_API_URL || 'http://localhost:3001/api'

// Helper to make authenticated API calls
async function apiCall(method: string, path: string, body?: any, token?: string): Promise<any> {
  const url = `${API_BASE}${path}`

  return new Promise((resolve, reject) => {
    const request = net.request({
      method,
      url,
    })

    request.setHeader('Content-Type', 'application/json')
    if (token) request.setHeader('Authorization', `Bearer ${token}`)

    let responseData = ''

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString()
      })
      response.on('end', () => {
        try {
          const data = JSON.parse(responseData)
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(data.error || `API error ${response.statusCode}`))
          } else {
            resolve(data)
          }
        } catch {
          reject(new Error('Invalid API response'))
        }
      })
    })

    request.on('error', reject)

    if (body) request.write(JSON.stringify(body))
    request.end()
  })
}

// Store user token in memory (will be set after auth)
let authToken: string | null = null

export function registerQuickServerIPC() {
  // ── Auth ──
  ipcMain.handle('qs:login', async (_, email: string, password: string) => {
    const result = await apiCall('POST', '/auth/login', { email, password })
    authToken = result.token
    return result
  })

  ipcMain.handle('qs:register', async (_, email: string, password: string) => {
    const result = await apiCall('POST', '/auth/register', { email, password })
    authToken = result.token
    return result
  })

  // ── Servers ──
  ipcMain.handle('qs:getServers', async () => {
    return await apiCall('GET', '/servers', undefined, authToken || undefined)
  })

  ipcMain.handle('qs:createServer', async (_, config: any) => {
    return await apiCall('POST', '/servers', config, authToken || undefined)
  })

  ipcMain.handle('qs:deleteServer', async (_, serverId: string) => {
    return await apiCall('DELETE', `/servers/${serverId}`, undefined, authToken || undefined)
  })

  ipcMain.handle('qs:startServer', async (_, serverId: string) => {
    return await apiCall('POST', `/servers/${serverId}/start`, undefined, authToken || undefined)
  })

  ipcMain.handle('qs:stopServer', async (_, serverId: string) => {
    return await apiCall('POST', `/servers/${serverId}/stop`, undefined, authToken || undefined)
  })

  ipcMain.handle('qs:restartServer', async (_, serverId: string) => {
    return await apiCall('POST', `/servers/${serverId}/restart`, undefined, authToken || undefined)
  })

  ipcMain.handle('qs:sendCommand', async (_, serverId: string, command: string) => {
    return await apiCall('POST', `/servers/${serverId}/command`, { command }, authToken || undefined)
  })

  ipcMain.handle('qs:getStats', async (_, serverId: string) => {
    return await apiCall('GET', `/servers/${serverId}/stats`, undefined, authToken || undefined)
  })

  // ── Settings ──
  ipcMain.handle('qs:getSettings', async (_, serverId: string) => {
    return await apiCall('GET', `/servers/${serverId}/settings`, undefined, authToken || undefined)
  })

  ipcMain.handle('qs:saveSettings', async (_, serverId: string, settings: any) => {
    return await apiCall('PUT', `/servers/${serverId}/settings`, settings, authToken || undefined)
  })

  // ── Files ──
  ipcMain.handle('qs:listFiles', async (_, serverId: string, directory: string) => {
    return await apiCall(
      'GET',
      `/servers/${serverId}/files?path=${encodeURIComponent(directory)}`,
      undefined,
      authToken || undefined
    )
  })

  ipcMain.handle('qs:uploadFile', async (_, serverId: string, path: string, content: string) => {
    return await apiCall(
      'POST',
      `/servers/${serverId}/files/upload`,
      { path, content },
      authToken || undefined
    )
  })

  ipcMain.handle('qs:deleteFile', async (_, serverId: string, files: string[]) => {
    return await apiCall('DELETE', `/servers/${serverId}/files`, { files }, authToken || undefined)
  })

  ipcMain.handle('qs:downloadFile', async (_, serverId: string, path: string) => {
    return await apiCall(
      'GET',
      `/servers/${serverId}/files/download?path=${encodeURIComponent(path)}`,
      undefined,
      authToken || undefined
    )
  })

  // ── Backups ──
  ipcMain.handle('qs:createBackup', async (_, serverId: string) => {
    return await apiCall('POST', `/servers/${serverId}/backups`, undefined, authToken || undefined)
  })

  ipcMain.handle('qs:listBackups', async (_, serverId: string) => {
    return await apiCall('GET', `/servers/${serverId}/backups`, undefined, authToken || undefined)
  })

  ipcMain.handle('qs:restoreBackup', async (_, serverId: string, backupId: string) => {
    return await apiCall(
      'POST',
      `/servers/${serverId}/backups/${backupId}/restore`,
      undefined,
      authToken || undefined
    )
  })

  // ── Plugins ──
  ipcMain.handle(
    'qs:installPlugin',
    async (_, serverId: string, projectId: string, versionId: string) => {
      return await apiCall(
        'POST',
        '/plugins/install',
        { serverId, projectId, versionId },
        authToken || undefined
      )
    }
  )

  ipcMain.handle('qs:uninstallPlugin', async (_, serverId: string, pluginName: string) => {
    return await apiCall(
      'DELETE',
      `/plugins/${serverId}/${pluginName}`,
      undefined,
      authToken || undefined
    )
  })

  // ── Payments ──
  ipcMain.handle('qs:createCheckout', async (_, config: any) => {
    return await apiCall('POST', '/payments/checkout/create-session', config, authToken || undefined)
  })

  ipcMain.handle('qs:extendServer', async (_, serverId: string, days: number) => {
    return await apiCall(
      'POST',
      `/payments/servers/${serverId}/extend`,
      { days },
      authToken || undefined
    )
  })

  ipcMain.handle('qs:upgradeServer', async (_, serverId: string, newTier: string) => {
    return await apiCall(
      'POST',
      `/payments/servers/${serverId}/upgrade`,
      { tier: newTier },
      authToken || undefined
    )
  })

  ipcMain.handle('qs:verifyPayment', async (_, sessionId: string) => {
    return await apiCall(
      'GET',
      `/payments/checkout/verify/${sessionId}`,
      undefined,
      authToken || undefined
    )
  })

  console.log('[QuickServers] IPC handlers registered')
}
