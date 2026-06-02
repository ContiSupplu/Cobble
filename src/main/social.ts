/**
 * Social Sharing for Loom Launcher
 *
 * Features:
 * - Share recordings/screenshots to Discord via webhook
 * - Upload videos to YouTube via YouTube Data API v3
 * - Persistent social config storage
 */
import { app, net, safeStorage } from 'electron'
import { join } from 'path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  createReadStream,
} from 'fs'
import { basename, extname } from 'path'

// ============================================================
// Types
// ============================================================

export interface DiscordShareOptions {
  filePath: string
  title: string
  description?: string
}

export interface YouTubeUploadOptions {
  filePath: string
  title: string
  description?: string
  privacy?: 'public' | 'unlisted' | 'private'
  tags?: string[]
  categoryId?: string   // YouTube category (20 = Gaming)
}

export interface YouTubeUploadResult {
  videoId: string
  url: string
  title: string
}

export interface SocialConfig {
  discordWebhookUrls: Array<{
    id: string
    name: string
    url: string
  }>
  youtubeTokenPath?: string
}

// ============================================================
// Constants
// ============================================================

const SOCIAL_CONFIG_PATH = () =>
  join(app.getPath('userData'), 'social-config.json')

const DISCORD_MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB (free tier limit)
const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3'

// ============================================================
// Config Persistence
// ============================================================

function loadSocialConfig(): SocialConfig {
  try {
    const path = SOCIAL_CONFIG_PATH()
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8')
      let json: string
      // Try to decrypt (new encrypted format), fall back to plaintext (migration)
      try {
        json = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(raw, 'base64'))
          : raw
      } catch {
        json = raw // Fallback for unencrypted legacy config
      }
      return JSON.parse(json)
    }
  } catch (err) {
    console.error('[Social] Failed to load config:', err)
  }
  return { discordWebhookUrls: [] }
}

function saveSocialConfig(config: SocialConfig): void {
  try {
    const path = SOCIAL_CONFIG_PATH()
    const dir = join(path, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const json = JSON.stringify(config, null, 2)
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json).toString('base64')
      : json
    writeFileSync(path, encrypted, 'utf-8')
  } catch (err) {
    console.error('[Social] Failed to save config:', err)
  }
}

/**
 * Get the current social config
 */
export function getSocialConfig(): SocialConfig {
  return loadSocialConfig()
}

/**
 * Add a Discord webhook URL to the config
 */
export function addDiscordWebhook(
  name: string,
  url: string
): SocialConfig {
  const config = loadSocialConfig()

  const id = generateId()
  config.discordWebhookUrls.push({ id, name, url })
  saveSocialConfig(config)

  console.log(`[Social] Added Discord webhook: ${name}`)
  return config
}

/**
 * Remove a Discord webhook URL by ID
 */
export function removeDiscordWebhook(id: string): SocialConfig {
  const config = loadSocialConfig()
  config.discordWebhookUrls = config.discordWebhookUrls.filter(
    (w) => w.id !== id
  )
  saveSocialConfig(config)
  console.log(`[Social] Removed Discord webhook: ${id}`)
  return config
}

/**
 * Set the YouTube token file path
 */
export function setYouTubeTokenPath(tokenPath: string): void {
  const config = loadSocialConfig()
  config.youtubeTokenPath = tokenPath
  saveSocialConfig(config)
}

// ============================================================
// Helpers
// ============================================================

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

// ============================================================
// Discord Webhook
// ============================================================

/**
 * Share a file to Discord via webhook.
 * Supports files up to 25 MB (Discord free tier limit).
 *
 * @param webhookUrl  Discord webhook URL
 * @param options     File path, title, and optional description
 */
export async function shareToDiscord(
  webhookUrl: string,
  options: DiscordShareOptions
): Promise<{ success: boolean; error?: string }> {
  const { filePath, title, description } = options

  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` }
  }

  // Validate webhook URL
  if (
    !webhookUrl.startsWith('https://discord.com/api/webhooks/') &&
    !webhookUrl.startsWith('https://discordapp.com/api/webhooks/')
  ) {
    return { success: false, error: 'Invalid Discord webhook URL' }
  }

  const stat = statSync(filePath)
  if (stat.size > DISCORD_MAX_FILE_SIZE) {
    return {
      success: false,
      error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB). Discord limit is 25MB.`,
    }
  }

  try {
    console.log(`[Social] Sharing to Discord: ${title}`)

    const fileName = basename(filePath)
    const fileData = readFileSync(filePath)
    const boundary = `----LoomBoundary${Date.now()}`

    // Build multipart form data
    const embedJson = JSON.stringify({
      embeds: [
        {
          title,
          description: description || '',
          color: 0x0a84ff, // Loom accent color
          footer: { text: 'Shared from Loom Launcher' },
          timestamp: new Date().toISOString(),
        },
      ],
    })

    // Construct multipart body manually
    const parts: Buffer[] = []

    // JSON payload part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="payload_json"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${embedJson}\r\n`
    ))

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files[0]"; filename="${fileName}"\r\n` +
      `Content-Type: ${getMimeType(filePath)}\r\n\r\n`
    ))
    parts.push(fileData)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const body = Buffer.concat(parts)

    const response = await net.fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`[Social] Discord webhook failed: ${response.status} ${text}`)
      return {
        success: false,
        error: `Discord API error: ${response.status}`,
      }
    }

    console.log(`[Social] Successfully shared to Discord: ${title}`)
    return { success: true }
  } catch (err: any) {
    console.error('[Social] Discord share failed:', err)
    return { success: false, error: err.message || 'Unknown error' }
  }
}

// ============================================================
// YouTube Upload
// ============================================================

/**
 * Load YouTube OAuth2 tokens from a token file.
 * Expected format: { access_token, refresh_token, token_type, expiry_date }
 */
function loadYouTubeTokens(tokenPath: string): {
  accessToken: string
  refreshToken: string
  expiryDate: number
} | null {
  try {
    if (!existsSync(tokenPath)) return null
    const data = JSON.parse(readFileSync(tokenPath, 'utf-8'))
    return {
      accessToken: data.access_token || data.accessToken || '',
      refreshToken: data.refresh_token || data.refreshToken || '',
      expiryDate: data.expiry_date || data.expiryDate || 0,
    }
  } catch (err) {
    console.error('[Social] Failed to load YouTube tokens:', err)
    return null
  }
}

/**
 * Upload a video to YouTube using the YouTube Data API v3.
 * Uses resumable upload protocol for reliability.
 *
 * @param tokenPath  Path to YouTube OAuth2 token JSON file
 * @param options    Upload options (file, title, description, privacy)
 */
export async function uploadToYouTube(
  tokenPath: string,
  options: YouTubeUploadOptions
): Promise<YouTubeUploadResult> {
  const { filePath, title, description, privacy, tags, categoryId } = options

  if (!existsSync(filePath)) {
    throw new Error(`Video file not found: ${filePath}`)
  }

  const tokens = loadYouTubeTokens(tokenPath)
  if (!tokens || !tokens.accessToken) {
    throw new Error('YouTube authentication required. No valid token found.')
  }

  const stat = statSync(filePath)
  const mimeType = getMimeType(filePath)

  console.log(
    `[Social] Uploading to YouTube: "${title}" (${Math.round(stat.size / 1024 / 1024)}MB)`
  )

  try {
    // Step 1: Initiate resumable upload
    const metadata = {
      snippet: {
        title,
        description: description || '',
        tags: tags || [],
        categoryId: categoryId || '20', // Gaming
      },
      status: {
        privacyStatus: privacy || 'private',
        selfDeclaredMadeForKids: false,
      },
    }

    const initResponse = await net.fetch(
      `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': stat.size.toString(),
          'X-Upload-Content-Type': mimeType,
        },
        body: JSON.stringify(metadata),
      }
    )

    if (!initResponse.ok) {
      const errorText = await initResponse.text()
      throw new Error(
        `YouTube upload initiation failed (${initResponse.status}): ${errorText}`
      )
    }

    const uploadUrl = initResponse.headers.get('location')
    if (!uploadUrl) {
      throw new Error('YouTube did not return a resumable upload URL')
    }

    // Step 2: Upload the file content
    const fileData = readFileSync(filePath)

    const uploadResponse = await net.fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': stat.size.toString(),
      },
      body: fileData,
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      throw new Error(
        `YouTube upload failed (${uploadResponse.status}): ${errorText}`
      )
    }

    const result = await uploadResponse.json()
    const videoId = result.id
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`

    console.log(`[Social] YouTube upload complete: ${videoUrl}`)

    return {
      videoId,
      url: videoUrl,
      title: result.snippet?.title || title,
    }
  } catch (err: any) {
    console.error('[Social] YouTube upload failed:', err)
    throw err
  }
}

/**
 * Check if YouTube credentials are configured and valid
 */
export function isYouTubeConfigured(): boolean {
  const config = loadSocialConfig()
  if (!config.youtubeTokenPath) return false
  const tokens = loadYouTubeTokens(config.youtubeTokenPath)
  return tokens !== null && !!tokens.accessToken
}

/**
 * Get the number of configured Discord webhooks
 */
export function getDiscordWebhookCount(): number {
  const config = loadSocialConfig()
  return config.discordWebhookUrls.length
}
