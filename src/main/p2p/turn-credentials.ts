/**
 * TURN Credential Provider — Generates ephemeral TURN credentials
 * using the shared secret from coturn's use-auth-secret mode.
 *
 * The credential format follows RFC 5389 / coturn's "TURN REST API":
 *   username = timestamp:randomUser
 *   password = HMAC-SHA1(sharedSecret, username)
 */

import { createHmac, randomBytes } from 'crypto'

// Default configuration — override via environment variables
const TURN_URLS = (process.env.LOOM_TURN_URLS || 'turn:localhost:3478,turns:localhost:5349').split(',')
const TURN_SECRET = process.env.LOOM_TURN_SECRET || 'CHANGE_ME_TO_A_RANDOM_SECRET'
const TURN_TTL = parseInt(process.env.LOOM_TURN_TTL || '86400', 10) // 24 hours

export interface TURNCredentials {
  urls: string[]
  username: string
  credential: string
  credentialType: string
}

/**
 * Generate ephemeral TURN credentials using the shared secret.
 *
 * @returns ICE server configuration ready to pass to WebRTC
 */
export function generateTURNCredentials(): TURNCredentials {
  const unixTimestamp = Math.floor(Date.now() / 1000) + TURN_TTL
  const username = `${unixTimestamp}:${randomBytes(4).toString('hex')}`

  const hmac = createHmac('sha1', TURN_SECRET)
  hmac.update(username)
  const credential = hmac.digest('base64')

  return {
    urls: TURN_URLS.map(u => u.trim()),
    username,
    credential,
    credentialType: 'password',
  }
}

/**
 * Build the full ICE servers array including STUN + TURN.
 */
export function getICEServers(): Array<{ urls: string | string[]; username?: string; credential?: string }> {
  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    // Free public STUN servers (no auth needed)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]

  // Add TURN only if a real secret is configured
  if (TURN_SECRET !== 'CHANGE_ME_TO_A_RANDOM_SECRET') {
    const turn = generateTURNCredentials()
    servers.push({
      urls: turn.urls,
      username: turn.username,
      credential: turn.credential,
    })
  }

  return servers
}
