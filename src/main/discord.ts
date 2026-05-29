/**
 * Discord Rich Presence integration for Cobble Launcher
 *
 * Uses @xhayper/discord-rpc to connect to the local Discord desktop client
 * and display what the user is playing.
 *
 * No OAuth needed — just a Discord Application ID.
 */
import { Client } from '@xhayper/discord-rpc'

// Default Cobble application — users can override with their own
let applicationId = ''
let rpcClient: Client | null = null
let connected = false
let enabled = false
let currentActivity: any = null

/** Whether Discord RPC is currently connected */
export function isDiscordConnected(): boolean {
  return connected
}

/** Whether Discord RPC is enabled by the user */
export function isDiscordEnabled(): boolean {
  return enabled
}

/** Get the current Application ID */
export function getDiscordAppId(): string {
  return applicationId
}

/** Initialize (or reinitialize) the RPC client */
export async function connectDiscord(appId: string): Promise<{ connected: boolean; error?: string }> {
  applicationId = appId

  // Destroy old client if exists
  if (rpcClient) {
    try { rpcClient.destroy() } catch { /* ignore */ }
    rpcClient = null
    connected = false
  }

  if (!appId) return { connected: false, error: 'No Application ID' }

  try {
    rpcClient = new Client({ clientId: appId })

    rpcClient.on('ready', () => {
      console.log('[Discord] Connected to Discord RPC')
      connected = true
      // Restore activity if one was set before connection
      if (currentActivity) {
        setActivity(currentActivity)
      }
    })

    rpcClient.on('disconnected', () => {
      console.log('[Discord] Disconnected from Discord RPC')
      connected = false
    })

    await rpcClient.login()
    enabled = true
    return { connected: true }
  } catch (err: any) {
    console.warn('[Discord] Failed to connect:', err.message)
    rpcClient = null
    connected = false
    return { connected: false, error: err.message || 'Failed to connect to Discord. Is Discord running?' }
  }
}

/** Disconnect and disable */
export function disconnectDiscord(): void {
  enabled = false
  currentActivity = null
  if (rpcClient) {
    try {
      rpcClient.user?.clearActivity()
      rpcClient.destroy()
    } catch { /* ignore */ }
    rpcClient = null
    connected = false
  }
}

/** Set rich presence activity */
async function setActivity(activity: any): Promise<void> {
  if (!rpcClient || !connected) return
  try {
    await rpcClient.user?.setActivity(activity)
  } catch (err: any) {
    console.warn('[Discord] Failed to set activity:', err.message)
  }
}

/**
 * Called when a Minecraft instance is launched
 */
export function setPlayingMinecraft(instanceName: string, version: string, loader: string): void {
  if (!enabled) return

  const loaderStr = loader && loader !== 'vanilla' ? ` + ${loader}` : ''

  currentActivity = {
    details: instanceName,
    state: `Minecraft ${version}${loaderStr}`,
    startTimestamp: new Date(),
    largeImageKey: 'cobble_logo',
    largeImageText: 'Cobble Launcher',
    smallImageKey: 'minecraft_icon',
    smallImageText: `Minecraft ${version}`,
    instance: false,
  }

  setActivity(currentActivity)
}

/**
 * Called when the game process exits
 */
export function clearPlayingMinecraft(): void {
  currentActivity = null
  if (!enabled || !rpcClient || !connected) return

  // Set idle state
  setActivity({
    details: 'In the launcher',
    state: 'Browsing instances',
    largeImageKey: 'cobble_logo',
    largeImageText: 'Cobble Launcher',
    instance: false,
  })
}

/**
 * Called on app quit
 */
export function destroyDiscord(): void {
  if (rpcClient) {
    try { rpcClient.destroy() } catch { /* ignore */ }
    rpcClient = null
    connected = false
  }
}
