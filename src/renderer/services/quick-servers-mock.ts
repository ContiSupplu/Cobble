// ─── Quick Servers Mock Service ───────────────────────────────────────────────
// Simulates a backend API for Minecraft server hosting.

// ── Types ─────────────────────────────────────────────────────────────────────

export type ServerTier = 'free' | 'pro' | 'proplus' | 'promax'
export type ServerStatus = 'online' | 'offline' | 'starting' | 'sleeping' | 'queued'
export type ServerSoftware = 'paper' | 'spigot' | 'forge' | 'fabric' | 'quilt' | 'vanilla'

export interface Backup {
  id: string
  createdAt: number
  size: number // MB
  type: 'auto' | 'manual'
}

export interface QuickServer {
  id: string
  name: string
  tier: ServerTier
  status: ServerStatus
  software: ServerSoftware
  mcVersion: string
  ram: number // GB
  storage: { used: number; max: number } // GB
  players: { online: number; max: number; list: string[] }
  domain: string
  port: number
  createdAt: number
  expiresAt: number
  uptimeType: 'ondemand' | '24/7'
  consoleLog: string[]
  backups: Backup[]
}

export interface CreateServerConfig {
  name: string
  tier: ServerTier
  software: ServerSoftware
  mcVersion: string
  ram: number
  duration: number // days
  domain: string
  domainSuffix: string
}

export interface TierLimits {
  ramOptions: number[]
  maxPlayers: number
  maxStorage: number // GB
  softwareOptions: ServerSoftware[]
  durationOptions: number[] // days
  features: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function ts(): string {
  const d = new Date()
  return (
    d.toTimeString().slice(0, 8)
  )
}

// ── Startup Log Lines ─────────────────────────────────────────────────────────

const STARTUP_LOG: string[] = [
  `[${ts()}] [Server thread/INFO]: Starting minecraft server version 1.21.1`,
  `[${ts()}] [Server thread/INFO]: Loading properties`,
  `[${ts()}] [Server thread/INFO]: Default game type: SURVIVAL`,
  `[${ts()}] [Server thread/INFO]: Generating keypair`,
  `[${ts()}] [Server thread/INFO]: Starting Minecraft server on *:25565`,
  `[${ts()}] [Server thread/INFO]: Preparing level "world"`,
  `[${ts()}] [Server thread/INFO]: Preparing start region for dimension minecraft:overworld`,
  `[${ts()}] [Server thread/INFO]: Preparing spawn area: 0%`,
  `[${ts()}] [Server thread/INFO]: Preparing spawn area: 47%`,
  `[${ts()}] [Server thread/INFO]: Preparing spawn area: 100%`,
  `[${ts()}] [Server thread/INFO]: Time elapsed: 3247 ms`,
  `[${ts()}] [Server thread/INFO]: Done (4.312s)! For help, type "help"`,
]

// ── Pricing Tables ────────────────────────────────────────────────────────────

type PriceKey = `${number}-${number}` // ram-days

const PRO_PRICES: Record<PriceKey, number> = {
  '3-7': 2.50,  '3-14': 4.50,  '3-30': 8.00,  '3-60': 14.00,
  '4-7': 3.50,  '4-14': 6.00,  '4-30': 10.00, '4-60': 18.00,
  '6-7': 5.00,  '6-14': 8.50,  '6-30': 15.00, '6-60': 26.00,
  '8-7': 6.50,  '8-14': 11.00, '8-30': 19.00, '8-60': 34.00,
  '10-7': 8.00, '10-14': 14.00,'10-30': 24.00,'10-60': 42.00,
}

const PROPLUS_PRICES: Record<PriceKey, number> = {
  '8-7': 8.00,   '8-14': 14.00,  '8-30': 24.00,  '8-60': 42.00,
  '12-7': 12.00, '12-14': 20.00, '12-30': 35.00, '12-60': 62.00,
  '16-7': 15.00, '16-14': 26.00, '16-30': 45.00, '16-60': 80.00,
}

const PROMAX_PRICES: Record<number, number> = {
  16: 40,
  24: 55,
  32: 75,
}

// ── Domain Suffixes ───────────────────────────────────────────────────────────

const DOMAIN_SUFFIXES: Record<ServerTier, string[]> = {
  free: ['loomquickserverhosting.us'],
  pro: ['loomquickserverhosting.us', 'mcpop.us', 'quickmc.us', 'servmc.us'],
  proplus: ['loomquickserverhosting.us', 'mcpop.us', 'quickmc.us', 'servmc.us'],
  promax: ['loomquickserverhosting.us', 'mcpop.us', 'quickmc.us', 'servmc.us', 'deepslate.us'],
}

// ── Tier Limits ───────────────────────────────────────────────────────────────

const TIER_LIMITS: Record<ServerTier, TierLimits> = {
  free: {
    ramOptions: [2],
    maxPlayers: 10,
    maxStorage: 5,
    softwareOptions: ['paper', 'spigot', 'vanilla'],
    durationOptions: [7],
    features: ['Basic DDoS protection', 'Shared CPU', 'Community support'],
  },
  pro: {
    ramOptions: [3, 4, 6, 8, 10],
    maxPlayers: 15,
    maxStorage: 15,
    softwareOptions: ['paper', 'spigot', 'forge', 'fabric', 'quilt', 'vanilla'],
    durationOptions: [7, 14, 30, 60],
    features: ['Enhanced DDoS protection', 'Shared CPU (priority)', 'Custom domain', 'Auto backups', 'Email support'],
  },
  proplus: {
    ramOptions: [8, 12, 16],
    maxPlayers: 999, // unlimited
    maxStorage: 50,
    softwareOptions: ['paper', 'spigot', 'forge', 'fabric', 'quilt', 'vanilla'],
    durationOptions: [7, 14, 30, 60],
    features: ['Advanced DDoS protection', 'Dedicated CPU core', 'Custom domain', 'Scheduled backups', 'Priority support', '24/7 uptime option'],
  },
  promax: {
    ramOptions: [16, 24, 32],
    maxPlayers: 999,
    maxStorage: 100,
    softwareOptions: ['paper', 'spigot', 'forge', 'fabric', 'quilt', 'vanilla'],
    durationOptions: [30], // monthly
    features: ['Enterprise DDoS protection', 'Dedicated CPU cores', 'Premium domains', 'Unlimited backups', 'Direct support line', '24/7 uptime', 'SLA guarantee'],
  },
}

// ── Mock Data Store ───────────────────────────────────────────────────────────

const now = Date.now()
const DAY = 86_400_000

let servers: QuickServer[] = []

// ── Command Responses ─────────────────────────────────────────────────────────

const COMMAND_RESPONSES: Record<string, string[]> = {
  help: [
    '[INFO]: --- Showing help page 1 of 4 ---',
    '[INFO]: /ban <player> - Bans a player',
    '[INFO]: /gamemode <mode> <player> - Sets a player\'s game mode',
    '[INFO]: /give <player> <item> [amount] - Gives an item to a player',
    '[INFO]: /kick <player> [reason] - Kicks a player',
    '[INFO]: /list - Lists all online players',
    '[INFO]: /op <player> - Makes a player an operator',
    '[INFO]: /say <message> - Broadcasts a message',
    '[INFO]: /stop - Stops the server',
    '[INFO]: /time set <value> - Sets the world time',
    '[INFO]: /weather <type> - Sets the weather',
  ],
  list: [
    '[INFO]: There are {online} of a max of {max} players online:',
    '[INFO]: {players}',
  ],
  time: [
    '[INFO]: Set the time to 0',
  ],
  weather: [
    '[INFO]: Set the weather to clear',
  ],
  seed: [
    '[INFO]: Seed: [-4882676212024782021]',
  ],
  difficulty: [
    '[INFO]: The difficulty is set to Normal',
  ],
  whitelist: [
    '[INFO]: Whitelist is turned off',
  ],
  tps: [
    '[INFO]: TPS from last 1m, 5m, 15m: 20.0, 19.98, 19.97',
  ],
  say: [
    '[INFO]: [Server] {args}',
  ],
}

function getCommandResponse(command: string, server: QuickServer): string[] {
  const parts = command.trim().split(/\s+/)
  const cmd = parts[0].replace(/^\//, '').toLowerCase()
  const args = parts.slice(1).join(' ')

  if (COMMAND_RESPONSES[cmd]) {
    return COMMAND_RESPONSES[cmd].map(line =>
      line
        .replace('{online}', String(server.players.online))
        .replace('{max}', String(server.players.max))
        .replace('{players}', server.players.list.join(', ') || 'No players online')
        .replace('{args}', args || '')
    )
  }

  return [`[WARN]: Unknown command "${cmd}". Type "help" for help.`]
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getServers(): Promise<QuickServer[]> {
  await delay(300 + Math.random() * 400)
  return [...servers]
}

export async function createServer(config: CreateServerConfig): Promise<QuickServer> {
  await delay(1500 + Math.random() * 1000)

  const limits = TIER_LIMITS[config.tier]
  const newServer: QuickServer = {
    id: uid(),
    name: config.name,
    tier: config.tier,
    status: 'starting',
    software: config.software,
    mcVersion: config.mcVersion,
    ram: config.ram,
    storage: { used: 0, max: limits.maxStorage },
    players: { online: 0, max: limits.maxPlayers, list: [] },
    domain: `${config.domain}.${config.domainSuffix}`,
    port: 25565,
    createdAt: Date.now(),
    expiresAt: Date.now() + config.duration * DAY,
    uptimeType: config.tier === 'promax' ? '24/7' : 'ondemand',
    consoleLog: [
      `[${ts()}] [Server thread/INFO]: Provisioning new ${config.tier.toUpperCase()} server...`,
      `[${ts()}] [Server thread/INFO]: Allocating ${config.ram}GB RAM...`,
      `[${ts()}] [Server thread/INFO]: Installing ${config.software} ${config.mcVersion}...`,
      ...STARTUP_LOG,
    ],
    backups: [],
  }

  servers = [...servers, newServer]

  // Simulate transition to online after a delay
  setTimeout(() => {
    servers = servers.map(s =>
      s.id === newServer.id ? { ...s, status: 'online' } : s
    )
  }, 3000)

  return newServer
}

export async function deleteServer(id: string): Promise<void> {
  await delay(500 + Math.random() * 300)
  servers = servers.filter(s => s.id !== id)
}

export async function startServer(id: string): Promise<void> {
  await delay(800 + Math.random() * 500)
  servers = servers.map(s => {
    if (s.id !== id) return s
    return {
      ...s,
      status: 'starting' as ServerStatus,
      consoleLog: [
        ...s.consoleLog,
        `[${ts()}] [Server thread/INFO]: Server starting...`,
        ...STARTUP_LOG,
      ],
    }
  })

  // Transition to online
  setTimeout(() => {
    servers = servers.map(s =>
      s.id === id ? { ...s, status: 'online' as ServerStatus } : s
    )
  }, 2500)
}

export async function stopServer(id: string): Promise<void> {
  await delay(600 + Math.random() * 300)
  servers = servers.map(s => {
    if (s.id !== id) return s
    return {
      ...s,
      status: 'offline' as ServerStatus,
      players: { ...s.players, online: 0, list: [] },
      consoleLog: [
        ...s.consoleLog,
        `[${ts()}] [Server thread/INFO]: Stopping the server`,
        `[${ts()}] [Server thread/INFO]: Saving players`,
        `[${ts()}] [Server thread/INFO]: Saving worlds`,
        `[${ts()}] [Server thread/INFO]: Saving chunks for level 'ServerLevel[world]'`,
        `[${ts()}] [Server thread/INFO]: ThreadedAnvilChunkStorage: All dimensions are saved`,
        `[${ts()}] [Server thread/INFO]: Server stopped.`,
      ],
    }
  })
}

export async function restartServer(id: string): Promise<void> {
  await stopServer(id)
  await delay(1000)
  await startServer(id)
}

export async function sendCommand(id: string, command: string): Promise<string> {
  await delay(100 + Math.random() * 200)

  const server = servers.find(s => s.id === id)
  if (!server) throw new Error('Server not found')
  if (server.status !== 'online') throw new Error('Server is not online')

  const responseLines = getCommandResponse(command, server)
  const timestampedLines = responseLines.map(line => `[${ts()}] [Server thread/${line.startsWith('[WARN]') ? 'WARN' : line.startsWith('[ERROR]') ? 'ERROR' : 'INFO'}]: ${line.replace(/^\[(INFO|WARN|ERROR)\]:\s*/, '')}`)

  const inputLine = `[${ts()}] [Server thread/INFO]: > ${command}`

  servers = servers.map(s => {
    if (s.id !== id) return s
    return {
      ...s,
      consoleLog: [...s.consoleLog, inputLine, ...timestampedLines],
    }
  })

  return [inputLine, ...timestampedLines].join('\n')
}

export async function getPrice(tier: ServerTier, ram: number, duration: number): Promise<number> {
  await delay(50)

  if (tier === 'free') return 0

  const key: PriceKey = `${ram}-${duration}`

  if (tier === 'pro') return PRO_PRICES[key] ?? 0
  if (tier === 'proplus') return PROPLUS_PRICES[key] ?? 0
  if (tier === 'promax') return PROMAX_PRICES[ram] ?? 0

  return 0
}

export function getTierLimits(tier: ServerTier): TierLimits {
  return TIER_LIMITS[tier]
}

export function getDomainSuffixes(tier: ServerTier): string[] {
  return DOMAIN_SUFFIXES[tier]
}

export async function createBackup(id: string): Promise<Backup> {
  await delay(1200 + Math.random() * 800)
  const backup: Backup = {
    id: uid(),
    createdAt: Date.now(),
    size: Math.round(200 + Math.random() * 400),
    type: 'manual',
  }
  servers = servers.map(s => {
    if (s.id !== id) return s
    return { ...s, backups: [...s.backups, backup] }
  })
  return backup
}

export async function restoreBackup(serverId: string, backupId: string): Promise<void> {
  await delay(2000 + Math.random() * 1000)
  // Simulate restore — no actual data change in mock
  const server = servers.find(s => s.id === serverId)
  if (!server) throw new Error('Server not found')

  servers = servers.map(s => {
    if (s.id !== serverId) return s
    return {
      ...s,
      consoleLog: [
        ...s.consoleLog,
        `[${ts()}] [Server thread/INFO]: Backup ${backupId.slice(0, 6)} restored successfully.`,
      ],
    }
  })
}
